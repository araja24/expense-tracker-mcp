-- ============================================================================
-- Expense tracker — core schema.
--
-- Every table is scoped to auth.uid() by RLS. That is what lets the web app
-- (supabase-js in the browser) and the MCP server (supabase-js with the user's
-- access token) share one schema with one set of rules: neither path can reach
-- another user's rows, and neither needs a service-role key.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- categories
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60),
  color       text not null default '#2563EB' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon        text not null default 'tag',
  created_at  timestamptz not null default now()
);

-- Category names are unique per user, case-insensitively: "Dining" and "dining"
-- are the same bucket. The AI relies on this to avoid creating near-duplicates.
create unique index categories_user_name_key
  on public.categories (user_id, lower(btrim(name)));

create index categories_user_idx on public.categories (user_id);

-- ------------------------------------------------------------------ expenses
create table public.expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete set null,
  description  text not null check (length(btrim(description)) between 1 and 200),
  -- numeric(12,2), not float: money must not drift.
  amount       numeric(12, 2) not null check (amount > 0),
  expense_date date not null default current_date,
  source       text not null default 'manual' check (source in ('manual', 'ai')),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index expenses_user_date_idx on public.expenses (user_id, expense_date desc);
create index expenses_user_category_idx on public.expenses (user_id, category_id);

-- ------------------------------------------------------------------- budgets
create table public.budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- null category_id = the overall budget for that month.
  category_id  uuid references public.categories (id) on delete cascade,
  month        smallint not null check (month between 1 and 12),
  year         smallint not null check (year between 2000 and 2100),
  amount       numeric(12, 2) not null check (amount > 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- One budget per (user, category, month). Two partial unique indexes are needed
-- because NULL category_id (the overall budget) never equals itself.
create unique index budgets_user_category_period_key
  on public.budgets (user_id, category_id, year, month)
  where category_id is not null;

create unique index budgets_user_overall_period_key
  on public.budgets (user_id, year, month)
  where category_id is null;

-- ------------------------------------------------------- profiles (settings)
create table public.profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  display_name       text,
  currency           text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  -- Payday-aligned months: a budget "month" can start on any day 1..28.
  month_start_day    smallint not null default 1 check (month_start_day between 1 and 28),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ============================================================================
-- Triggers
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();

create trigger budgets_touch_updated_at
  before update on public.budgets
  for each row execute function public.touch_updated_at();

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A category can only be attached to an expense by its owner. RLS stops
-- cross-user *reads*, but without this an attacker who guessed a category id
-- could still write it onto their own expense row.
create or replace function public.assert_category_owned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is not null
     and not exists (
       select 1 from public.categories c
       where c.id = new.category_id and c.user_id = new.user_id
     )
  then
    raise exception 'category % does not belong to user %', new.category_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger expenses_assert_category_owned
  before insert or update of category_id, user_id on public.expenses
  for each row execute function public.assert_category_owned();

create trigger budgets_assert_category_owned
  before insert or update of category_id, user_id on public.budgets
  for each row execute function public.assert_category_owned();

-- ============================================================================
-- New-user bootstrap: a profile plus a starter set of categories, so the very
-- first "I bought coffee" from the assistant has somewhere sensible to land.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;

  insert into public.categories (user_id, name, color, icon) values
    (new.id, 'Groceries', '#2563EB', 'shopping-cart'),
    (new.id, 'Dining',    '#F97316', 'utensils'),
    (new.id, 'Transport', '#8B5CF6', 'car'),
    (new.id, 'Shopping',  '#EC4899', 'shopping-bag'),
    (new.id, 'Utilities', '#14B8A6', 'zap')
  on conflict do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row Level Security — the shared rulebook for the app and the MCP server.
-- ============================================================================

alter table public.categories enable row level security;
alter table public.expenses   enable row level security;
alter table public.budgets    enable row level security;
alter table public.profiles   enable row level security;

create policy categories_select on public.categories for select using (auth.uid() = user_id);
create policy categories_insert on public.categories for insert with check (auth.uid() = user_id);
create policy categories_update on public.categories for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy categories_delete on public.categories for delete using (auth.uid() = user_id);

create policy expenses_select on public.expenses for select using (auth.uid() = user_id);
create policy expenses_insert on public.expenses for insert with check (auth.uid() = user_id);
create policy expenses_update on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy expenses_delete on public.expenses for delete using (auth.uid() = user_id);

create policy budgets_select on public.budgets for select using (auth.uid() = user_id);
create policy budgets_insert on public.budgets for insert with check (auth.uid() = user_id);
create policy budgets_update on public.budgets for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy budgets_delete on public.budgets for delete using (auth.uid() = user_id);

create policy profiles_select on public.profiles for select using (auth.uid() = user_id);
create policy profiles_insert on public.profiles for insert with check (auth.uid() = user_id);
create policy profiles_update on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
