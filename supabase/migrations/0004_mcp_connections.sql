-- ============================================================================
-- Letting the web app show and revoke connected MCP clients.
--
-- The grants live in `mcp_oauth`, which PostgREST does not expose and the
-- browser cannot reach. Rather than stand up a REST endpoint on the MCP server
-- (a second auth surface to get right, plus CORS), these two SECURITY DEFINER
-- functions read that schema on the caller's behalf and filter by auth.uid(),
-- so supabase-js can call them like any other RPC.
--
-- SECURITY DEFINER means these run as the owner, so two things matter: the
-- search_path is pinned (otherwise a caller could shadow the table names), and
-- execute is granted only to `authenticated`, never to `anon`.
-- ============================================================================

create or replace function public.list_mcp_connections()
returns table (
  client_id     text,
  client_name   text,
  scope         text,
  connected_at  timestamptz,
  last_used_at  timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public, mcp_oauth
as $$
  select
    t.client_id,
    coalesce(nullif(btrim(c.client_name), ''), 'MCP client') as client_name,
    -- Refreshing rotates the grant into a new row, so the live scope is the
    -- one on the newest token, not an aggregate.
    (array_agg(t.scope order by t.created_at desc))[1] as scope,
    -- ...while "connected" is when this client first linked, and "last used"
    -- is the most recent call across every token it has held.
    min(t.created_at) as connected_at,
    max(t.last_used_at) as last_used_at
  from mcp_oauth.tokens t
  join mcp_oauth.clients c on c.client_id = t.client_id
  where t.user_id = auth.uid()
    and t.revoked_at is null
    and (t.refresh_token_expires_at is null or t.refresh_token_expires_at > now())
  group by t.client_id, c.client_name
  order by max(t.last_used_at) desc nulls last, min(t.created_at) desc;
$$;

create or replace function public.revoke_mcp_connection(target_client_id text)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, mcp_oauth
as $$
declare
  affected integer;
begin
  -- auth.uid() is null for an anonymous caller; without this the update below
  -- would match no rows silently rather than refusing.
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  update mcp_oauth.tokens
     set revoked_at = now()
   where user_id = auth.uid()
     and client_id = target_client_id
     and revoked_at is null;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Anonymous callers have no business here, and the default grant is to public.
revoke execute on function public.list_mcp_connections() from public, anon;
revoke execute on function public.revoke_mcp_connection(text) from public, anon;

grant execute on function public.list_mcp_connections() to authenticated;
grant execute on function public.revoke_mcp_connection(text) to authenticated;
