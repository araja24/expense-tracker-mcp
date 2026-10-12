-- ============================================================================
-- Bank statement import (through the assistant over MCP).
--
-- external_id is a stable fingerprint of the statement line an expense came
-- from. Re-importing an overlapping statement then skips what is already
-- there instead of doubling it.
-- ============================================================================

alter table public.expenses
  add column external_id text
    check (external_id is null or length(external_id) between 1 and 64);

-- A full (not partial) unique constraint, so a PostgREST upsert can target it
-- with on_conflict. NULLs stay distinct, so manual and ai rows never collide.
alter table public.expenses
  add constraint expenses_user_external_id_key unique (user_id, external_id);

alter table public.expenses drop constraint expenses_source_check;
alter table public.expenses
  add constraint expenses_source_check check (source in ('manual', 'ai', 'import'));
