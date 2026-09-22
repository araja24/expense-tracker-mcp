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
 * Any origin is allowed on purpose. A browser-based MCP client — claude.ai
 * among them — calls the discovery, token and /mcp endpoints from its own
 * origin, and an allowlist of our own app's URL would reject every one of
 * them. This is safe because the server carries no cookies or session state:
 * authority comes only from a bearer token, so a hostile page calling these
 * endpoints has exactly the access of someone calling them with curl, which is
 * none. `credentials` stays off, which is what keeps that true.
 */
app.use(
  cors({
    origin: '*',
    credentials: false,
    // Clients cannot read these off a cross-origin response unless exposed:
    // the session id for subsequent requests, and the challenge that tells
    // them where to authenticate.
    exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Mcp-Protocol-Version']
  })
);
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
