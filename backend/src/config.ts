import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * The public origin this server is reachable at. It is the OAuth issuer and
 * the resource identifier, so it has to be the real external URL — not
 * localhost — once deployed.
 */
/*
 * Hosts often expose a service's address as a bare hostname rather than a URL
 * (Render's `fromService` property is one), so a scheme-less value is accepted
 * and assumed to be https — which is the only thing it could legitimately be
 * off localhost anyway.
 */
function toOrigin(value: string): URL {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  return new URL(withScheme);
}

const publicUrl = toOrigin(optional('PUBLIC_URL', 'http://localhost:8787'));

const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname);

/*
 * Misconfiguration here does not fail where you would notice it: the server
 * starts, serves discovery documents full of the wrong URLs, and the client
 * gives up several redirects later with nothing useful in any log. These
 * checks move that to startup.
 */
if (publicUrl.protocol !== 'https:' && !isLocal) {
  throw new Error(
    `PUBLIC_URL must use https when it is not localhost (got "${publicUrl.href}"). ` +
      'OAuth clients refuse plaintext issuers, and hosted clients such as Claude will not connect.'
  );
}

if (publicUrl.pathname !== '/') {
  throw new Error(
    `PUBLIC_URL must be an origin with no path (got "${publicUrl.href}"). ` +
      'The /mcp endpoint and the well-known documents are derived from it.'
  );
}

/**
 * A service-role key bypasses RLS entirely. This server is built so that every
 * read and write happens as the end user; handing it a service-role key would
 * silently discard that guarantee, so refuse to start rather than run with it.
 */
function assertNotServiceRole(key: string): string {
  try {
    const payload = key.split('.')[1];
    if (!payload) return key;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: string;
    };
    if (claims.role && claims.role !== 'anon') {
      throw new Error(
        `SUPABASE_ANON_KEY looks like a "${claims.role}" key, not the anon key. ` +
          'This server must never hold a service-role key: it would bypass Row Level Security ' +
          'and give the MCP server access to every user\'s data.'
      );
    }
  } catch (cause) {
    // Only re-raise our own refusal; an unparseable key is not our business
    // (Supabase has shipped more than one key format).
    if (cause instanceof Error && cause.message.startsWith('SUPABASE_ANON_KEY')) throw cause;
  }
  return key;
}

export const config = {
  port: Number(optional('PORT', '8787')),
  publicUrl,

  supabase: {
    url: required('SUPABASE_URL'),
    /**
     * The anon key only. Every read and write in this server goes through a
     * client carrying the end user's access token, so RLS applies exactly as
     * it does in the browser. A service-role key would bypass all of it and
     * must never be set here.
     */
    anonKey: assertNotServiceRole(required('SUPABASE_ANON_KEY'))
  },

  /**
   * Direct Postgres connection used solely for the `mcp_oauth` schema
   * (registered clients, auth codes, issued tokens). See
   * supabase/migrations/0003_mcp_oauth.sql for the restricted role to use.
   */
  databaseUrl: required('DATABASE_URL'),

  /** Where the user is sent after connecting, and which origins may call us. */
  appUrl: optional('APP_URL', 'http://localhost:5173'),
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean),

  token: {
    /** Short-lived by design; clients refresh silently. */
    accessTokenTtlSeconds: Number(optional('ACCESS_TOKEN_TTL_SECONDS', '3600')),
    refreshTokenTtlSeconds: Number(optional('REFRESH_TOKEN_TTL_SECONDS', String(60 * 60 * 24 * 30))),
    authCodeTtlSeconds: Number(optional('AUTH_CODE_TTL_SECONDS', '300'))
  },

  scopes: ['expenses:read', 'expenses:write'] as const
};

export type Config = typeof config;
