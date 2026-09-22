-- ============================================================================
-- OAuth 2.1 bookkeeping for the remote MCP server.
--
-- The MCP server acts as its own Authorization Server (MCP clients need
-- dynamic client registration and PKCE, which Supabase Auth does not offer to
-- third-party clients) while Supabase Auth remains the identity provider — the
-- user logs in with the same Google/email account they use in the app.
--
-- These tables are deliberately NOT in the `public` schema, so PostgREST never
-- exposes them. The MCP server reaches them over a direct Postgres connection
-- as the dedicated `mcp_oauth_rw` role created at the bottom of this file,
-- which has rights to this schema and nothing else. That is why the server
-- still does not need — and must not be given — a service-role key: all
-- expense data goes through supabase-js with the end user's own access token,
-- under the same RLS as the web app.
-- ============================================================================

create schema if not exists mcp_oauth;

-- Clients registered dynamically per RFC 7591 (Claude and other MCP clients
-- register themselves on first connect).
create table mcp_oauth.clients (
  client_id                  text primary key,
  client_name                text,
  redirect_uris              text[] not null,
  token_endpoint_auth_method text not null default 'none',
  grant_types                text[] not null default array['authorization_code', 'refresh_token'],
  scope                      text not null default 'expenses:read expenses:write',
  created_at                 timestamptz not null default now()
);

-- Short-lived authorization codes. `supabase_refresh_token` carries the
-- Supabase session minted when the user logged in during /authorize; /token
-- swaps the code for our own access token and keeps that session server-side.
create table mcp_oauth.auth_codes (
  code                   text primary key,
  client_id              text not null references mcp_oauth.clients (client_id) on delete cascade,
  user_id                uuid not null,
  redirect_uri           text not null,
  code_challenge         text not null,
  code_challenge_method  text not null check (code_challenge_method = 'S256'),
  scope                  text not null,
  supabase_refresh_token text not null,
  expires_at             timestamptz not null,
  consumed_at            timestamptz,
  created_at             timestamptz not null default now()
);

create index auth_codes_expiry_idx on mcp_oauth.auth_codes (expires_at);

-- One row per issued grant. We store hashes, never the tokens themselves:
-- a dump of this table must not be usable to impersonate anyone.
create table mcp_oauth.tokens (
  id                       uuid primary key default gen_random_uuid(),
  client_id                text not null references mcp_oauth.clients (client_id) on delete cascade,
  user_id                  uuid not null,
  access_token_hash        text not null unique,
  refresh_token_hash       text unique,
  scope                    text not null,
  -- The Supabase refresh token for this user's session. Rotated by GoTrue on
  -- every refresh, so it is updated in place as the server uses it.
  supabase_refresh_token   text not null,
  access_token_expires_at  timestamptz not null,
  refresh_token_expires_at timestamptz,
  revoked_at               timestamptz,
  last_used_at             timestamptz,
  created_at               timestamptz not null default now()
);

create index tokens_user_idx on mcp_oauth.tokens (user_id);
create index tokens_expiry_idx on mcp_oauth.tokens (access_token_expires_at);

-- Pending /authorize requests, parked while the user completes the Supabase
-- login in the browser. Keyed by an opaque, unguessable id.
create table mcp_oauth.pending_authorizations (
  id                    text primary key,
  client_id             text not null references mcp_oauth.clients (client_id) on delete cascade,
  redirect_uri          text not null,
  state                 text,
  code_challenge        text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  scope                 text not null,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now()
);

-- Housekeeping: called opportunistically by the server, and safe to schedule
-- with pg_cron if you prefer.
create or replace function mcp_oauth.purge_expired()
returns void
language sql
as $$
  delete from mcp_oauth.auth_codes where expires_at < now() - interval '1 day';
  delete from mcp_oauth.pending_authorizations where expires_at < now() - interval '1 day';
  delete from mcp_oauth.tokens
    where revoked_at is not null and revoked_at < now() - interval '30 days';
  delete from mcp_oauth.tokens
    where refresh_token_expires_at is not null
      and refresh_token_expires_at < now() - interval '30 days';
$$;

-- ---------------------------------------------------------------------------
-- The role the MCP server connects as. Run this block once, substituting a
-- strong password, then put the connection string in the server's DATABASE_URL:
--
--   postgresql://mcp_oauth_rw:<password>@<host>:5432/postgres
--
-- Kept commented out because a migration must not contain a literal password.
-- ---------------------------------------------------------------------------
-- create role mcp_oauth_rw with login password 'replace-me';
-- grant usage on schema mcp_oauth to mcp_oauth_rw;
-- grant select, insert, update, delete on all tables in schema mcp_oauth to mcp_oauth_rw;
-- grant execute on all functions in schema mcp_oauth to mcp_oauth_rw;
-- alter default privileges in schema mcp_oauth
--   grant select, insert, update, delete on tables to mcp_oauth_rw;
