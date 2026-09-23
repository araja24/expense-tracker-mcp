-- ============================================================================
-- The mcp_oauth schema is not exposed via PostgREST and is reachable only
-- through the restricted mcp_oauth_rw role over a direct Postgres connection
-- (see 0003_mcp_oauth.sql) — access is already controlled at the schema/role
-- level, not per-row. Row Level Security got enabled on these tables anyway
-- (most likely via Supabase's dashboard "Enable RLS" prompt, which flags any
-- table without it), and with no policies defined that blocks every
-- non-owner role, including mcp_oauth_rw itself: dynamic client registration
-- started failing with "new row violates row-level security policy".
-- ============================================================================

alter table mcp_oauth.clients disable row level security;
alter table mcp_oauth.auth_codes disable row level security;
alter table mcp_oauth.tokens disable row level security;
alter table mcp_oauth.pending_authorizations disable row level security;
