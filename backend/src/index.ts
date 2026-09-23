import { existsSync } from 'node:fs';
import path from 'node:path';

import express from 'express';
import cors from 'cors';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

import { config } from './config.js';
import { oauthProvider } from './auth/provider.js';
import { loginRouter } from './auth/login.js';
import { buildMcpServer } from './mcp/server.js';
import { pool, query } from './db.js';

const app = express();

/*
 * Render (like any managed host) terminates TLS at a proxy and passes the
 * caller's address in X-Forwarded-For. Without this, rate limiting keys every
 * request on the proxy's own address — one shared bucket for the whole
 * internet — and express-rate-limit refuses to guess, logging
 * ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on each request. One hop: Render's proxy.
 */
app.set('trust proxy', 1);

/*
 * Any origin is allowed on purpose. A browser-based MCP client — claude.ai
 * among them — calls the discovery, token and /mcp endpoints from its own
 * origin, and an allowlist of our own app's URL would reject every one of
 * them. This is safe because the server carries no cookies or session state:
 * authority comes only from a bearer token, so a hostile page calling these
 * endpoints has exactly the access of someone calling them with curl, which is
 * none. `credentials` stays off, which is what keeps that true.
 */
const apiCors = cors({
  origin: '*',
  credentials: false,
  // Clients cannot read these off a cross-origin response unless exposed:
  // the session id for subsequent requests, and the challenge that tells
  // them where to authenticate.
  exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version']
});

/*
 * Scoped to the protocol endpoints rather than the whole app. The same process
 * now serves the web app, and the reasoning above — no cookies, bearer-only —
 * is what makes the wildcard safe; it does not extend to the app's own pages,
 * so they are left same-origin.
 */
const CORS_PATHS = ['/mcp', '/authorize', '/token', '/register', '/revoke'];

app.use((req, res, next) => {
  if (CORS_PATHS.includes(req.path) || req.path.startsWith('/.well-known/')) {
    apiCors(req, res, next);
    return;
  }
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', name: 'tally-expense-tracker', version: '0.1.0' });
});

// OAuth 2.1: discovery metadata, dynamic client registration, /authorize,
// /token and /revoke — all backed by SupabaseOAuthProvider.
app.use(
  mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: config.publicUrl,
    resourceServerUrl: new URL('/mcp', config.publicUrl),
    resourceName: 'Tally expense tracker',
    scopesSupported: [...config.scopes],
    serviceDocumentationUrl: new URL(config.appUrl)
  })
);

// The hosted sign-in page that the /authorize step redirects to.
app.use(loginRouter);

const bearerAuth = requireBearerAuth({
  verifier: oauthProvider,
  requiredScopes: ['expenses:read'],
  resourceMetadataUrl: new URL('/.well-known/oauth-protected-resource/mcp', config.publicUrl).href
});

/**
 * One transport and one McpServer per request, in stateless mode.
 *
 * The server is built from the request's auth info, so a user's Supabase
 * session is never shared between requests and nothing has to be evicted when
 * a grant is revoked — the next request simply fails verification.
 */
app.post('/mcp', bearerAuth, async (req, res) => {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({ error: 'invalid_token' });
    return;
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildMcpServer(auth);

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (cause) {
    console.error('[mcp] request failed', cause);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null
      });
    }
  }
});

// Stateless mode has no server-initiated stream and no session to delete.
const notAllowed = (_req: express.Request, res: express.Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed — this server is stateless; use POST.' },
    id: null
  });
};

app.get('/mcp', bearerAuth, notAllowed);
app.delete('/mcp', bearerAuth, notAllowed);

/*
 * The web app, served by this same process — one origin, one deploy, so there
 * is no second service whose URL has to be wired in anywhere.
 *
 * Everything above is registered first and wins: /health, the discovery
 * documents, the OAuth endpoints, /connect and /mcp. Only what is left over
 * reaches the app, which is why the consent page had to move off /login.
 *
 * `npm run build` copies frontend/dist here. It is absent when running from
 * src/ with tsx, where Vite serves the app on its own port instead.
 */
const webRoot = path.join(import.meta.dirname, 'public');
const indexHtml = path.join(webRoot, 'index.html');
const assetsDir = path.join(webRoot, 'assets');

if (existsSync(indexHtml)) {
  app.use(
    express.static(webRoot, {
      // index.html is served by the fallback below, so that a deploy changing
      // only the HTML is still picked up on the next navigation.
      index: false,
      setHeaders: (res, filePath) => {
        // Vite fingerprints what it emits into assets/, so those filenames
        // never change meaning. Anything else — tally.svg and friends — is a
        // stable name with changing content and has to be revalidated.
        res.setHeader(
          'Cache-Control',
          filePath.startsWith(assetsDir) ? 'public, max-age=31536000, immutable' : 'no-cache'
        );
      }
    })
  );

  /*
   * React Router owns the paths, so any unmatched GET has to return the app
   * shell rather than a 404 — otherwise opening /transactions directly, or
   * refreshing it, fails. Other methods fall through to a genuine 404.
   *
   * /.well-known is excluded deliberately. Clients discovering this server try
   * several documents there (RFC 8414 allows inserting the resource path), and
   * they have to be able to tell a missing one apart from a hit — answering
   * every probe with 200 and a page of HTML means parsing it as JSON and
   * failing, instead of moving on to the next candidate.
   */
  app.use((req, res, next) => {
    const isPageRequest = req.method === 'GET' || req.method === 'HEAD';
    if (!isPageRequest || req.path.startsWith('/.well-known/')) {
      next();
      return;
    }
    res.set('Cache-Control', 'no-cache').sendFile(indexHtml);
  });
} else {
  console.warn(
    `[tally] no web app at ${webRoot} — serving the API only. ` +
      'Run `npm run build` to bundle the frontend into this process.'
  );
}

const server = app.listen(config.port, () => {
  console.log(`[tally] listening on ${config.publicUrl.href} (port ${config.port})`);
  console.log(`[tally] MCP endpoint: ${new URL('/mcp', config.publicUrl).href}`);
});

// Expired codes and pending authorizations pile up otherwise; nothing here is
// urgent enough to need pg_cron.
const purgeTimer = setInterval(
  () => {
    void query('select mcp_oauth.purge_expired()').catch(cause =>
      console.error('[tally] purge failed', cause)
    );
  },
  60 * 60 * 1000
);
purgeTimer.unref();

async function shutdown(signal: string) {
  console.log(`[tally] ${signal} received, shutting down`);
  clearInterval(purgeTimer);
  server.close();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
