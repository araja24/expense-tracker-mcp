-- ============================================================================
-- The login role the MCP server connects as.
--
-- Run this once, after 0003_mcp_oauth.sql, replacing the password. Keeping the
-- server off the `postgres` superuser is the whole point: this role can reach
-- the OAuth bookkeeping and nothing else, so even a total compromise of the
-- MCP server cannot read anyone's expenses directly — it can only act through
-- a user's own access token, under RLS.
-- ============================================================================

-- Use a long random password. If it contains characters outside [A-Za-z0-9],
-- percent-encode them when you paste it into DATABASE_URL (@ -> %40, # -> %23,
-- / -> %2F, : -> %3A). Generating one without those characters avoids the
-- whole problem.
create role mcp_oauth_rw with login password 'REPLACE-WITH-A-LONG-RANDOM-PASSWORD';

grant usage on schema mcp_oauth to mcp_oauth_rw;
grant select, insert, update, delete on all tables in schema mcp_oauth to mcp_oauth_rw;
grant execute on all functions in schema mcp_oauth to mcp_oauth_rw;

-- Anything added to the schema later is covered too.
alter default privileges in schema mcp_oauth
  grant select, insert, update, delete on tables to mcp_oauth_rw;
alter default privileges in schema mcp_oauth
  grant execute on functions to mcp_oauth_rw;

-- Belt and braces: this role has no business in the application schema.
revoke all on schema public from mcp_oauth_rw;

-- ---------------------------------------------------------------------------
-- Verify. Both of these should come back false.
-- ---------------------------------------------------------------------------
select
  has_schema_privilege('mcp_oauth_rw', 'mcp_oauth', 'usage') as can_reach_oauth_schema,
  has_table_privilege('mcp_oauth_rw', 'public.expenses', 'select') as can_read_expenses,
  has_table_privilege('mcp_oauth_rw', 'public.categories', 'select') as can_read_categories;

-- ---------------------------------------------------------------------------
-- Then connect through the SESSION POOLER, with the role name in place of
-- `postgres` — the pooler expects <role>.<project-ref> as the username:
--
--   postgresql://mcp_oauth_rw.zlhxyyataznsqbjumsgo:<password>@aws-0-us-west-2.pooler.supabase.com:5432/postgres
--
-- Port 5432 is session mode, which is what this server needs. Port 6543 is
-- transaction mode and does not support everything a normal client expects.
-- ---------------------------------------------------------------------------
