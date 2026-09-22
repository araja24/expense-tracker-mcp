-- ============================================================================
-- Diagnostics. Paste into the Supabase SQL editor (it runs as a superuser, so
-- RLS does not hide anything here) to see what actually exists.
-- ============================================================================

-- 1. Who has signed up, and did the bootstrap trigger run for them?
select
  u.id,
  u.email,
  u.created_at,
  u.last_sign_in_at,
  u.email_confirmed_at is not null as email_confirmed,
  (select count(*) from public.profiles   p where p.user_id = u.id) as profiles,
  (select count(*) from public.categories c where c.user_id = u.id) as categories,
  (select count(*) from public.expenses   e where e.user_id = u.id) as expenses,
  (select count(*) from public.budgets    b where b.user_id = u.id) as budgets
from auth.users u
order by u.created_at desc;

-- 2. Is the bootstrap trigger actually installed?
select tgname, tgenabled
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

-- 3. Row counts across the board.
select 'profiles' as table_name, count(*) from public.profiles
union all select 'categories', count(*) from public.categories
union all select 'expenses',   count(*) from public.expenses
union all select 'budgets',    count(*) from public.budgets;

-- ---------------------------------------------------------------------------
-- Backfill. The on_auth_user_created trigger only fires for accounts created
-- AFTER migration 0001 ran, so anyone who signed up before it has no profile
-- and no starter categories — the app then shows an empty shell with no way to
-- categorise anything. This gives those accounts the same starting point.
-- Safe to run more than once.
-- ---------------------------------------------------------------------------

insert into public.profiles (user_id, display_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', split_part(u.email, '@', 1))
from auth.users u
on conflict (user_id) do nothing;

insert into public.categories (user_id, name, color, icon)
select u.id, seed.name, seed.color, seed.icon
from auth.users u
cross join (values
  ('Groceries', '#2563EB', 'shopping-cart'),
  ('Dining',    '#F97316', 'utensils'),
  ('Transport', '#8B5CF6', 'car'),
  ('Shopping',  '#EC4899', 'shopping-bag'),
  ('Utilities', '#14B8A6', 'zap')
) as seed(name, color, icon)
-- Only seed accounts that have no categories at all, so a user who has
-- renamed or deleted the defaults does not get them back.
where not exists (select 1 from public.categories c where c.user_id = u.id)
on conflict do nothing;
