-- ============================================================================
-- Reporting functions.
--
-- Summaries and budget status live in the database rather than in the frontend
-- or the MCP server, so "what did I spend in September" gives the same answer
-- whichever path asks. These run as the *invoker*, so RLS still applies and
-- every function implicitly sees only the caller's rows.
-- ============================================================================

-- Totals and per-category breakdown over an optional date window.
-- Both bounds null = all time.
create or replace function public.expense_summary(
  from_date date default null,
  to_date   date default null
)
returns table (
  category_id    uuid,
  category_name  text,
  category_color text,
  total           numeric,
  expense_count   bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    coalesce(c.name, 'Uncategorized'),
    coalesce(c.color, '#A1A1AA'),
    sum(e.amount)::numeric,
    count(*)::bigint
  from public.expenses e
  left join public.categories c on c.id = e.category_id
  where e.user_id = auth.uid()
    and (from_date is null or e.expense_date >= from_date)
    and (to_date   is null or e.expense_date <= to_date)
  group by c.id, c.name, c.color
  order by sum(e.amount) desc;
$$;

-- Month-by-month totals for the trailing N months, including months with no
-- spend (the dashboard chart needs a continuous axis, not a sparse one).
create or replace function public.monthly_totals(months_back integer default 6)
returns table (
  period date,
  total  numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with span as (
    select generate_series(
      date_trunc('month', current_date) - make_interval(months => greatest(months_back, 1) - 1),
      date_trunc('month', current_date),
      interval '1 month'
    )::date as period
  )
  select
    span.period,
    coalesce(sum(e.amount), 0)::numeric
  from span
  left join public.expenses e
    on e.user_id = auth.uid()
   and date_trunc('month', e.expense_date)::date = span.period
  group by span.period
  order by span.period;
$$;

-- Spend vs. budget for one month, overall and per category.
-- The row with a null category_id is the overall budget.
create or replace function public.budget_status(
  target_year  smallint default null,
  target_month smallint default null
)
returns table (
  category_id    uuid,
  category_name  text,
  category_color text,
  budget         numeric,
  spent          numeric,
  remaining      numeric,
  pct_used       numeric,
  exceeded       boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with period as (
    select
      coalesce(target_year,  extract(year  from current_date)::smallint) as y,
      coalesce(target_month, extract(month from current_date)::smallint) as m
  ),
  window_bounds as (
    select
      make_date(y::int, m::int, 1) as start_date,
      (make_date(y::int, m::int, 1) + interval '1 month - 1 day')::date as end_date,
      y, m
    from period
  ),
  spend as (
    select e.category_id, sum(e.amount) as spent
    from public.expenses e, window_bounds w
    where e.user_id = auth.uid()
      and e.expense_date between w.start_date and w.end_date
    group by e.category_id
  ),
  overall as (
    select coalesce(sum(spent), 0) as spent from spend
  )
  select
    b.category_id,
    coalesce(c.name, 'Overall'),
    coalesce(c.color, '#18181B'),
    b.amount::numeric,
    coalesce(
      case when b.category_id is null
           then (select spent from overall)
           else (select s.spent from spend s where s.category_id = b.category_id)
      end, 0)::numeric as spent,
    (b.amount - coalesce(
      case when b.category_id is null
           then (select spent from overall)
           else (select s.spent from spend s where s.category_id = b.category_id)
      end, 0))::numeric as remaining,
    round(
      coalesce(
        case when b.category_id is null
             then (select spent from overall)
             else (select s.spent from spend s where s.category_id = b.category_id)
        end, 0) / nullif(b.amount, 0) * 100, 1)::numeric as pct_used,
    coalesce(
      case when b.category_id is null
           then (select spent from overall)
           else (select s.spent from spend s where s.category_id = b.category_id)
      end, 0) > b.amount as exceeded
  from public.budgets b
  left join public.categories c on c.id = b.category_id
  cross join window_bounds w
  where b.user_id = auth.uid()
    and b.year = w.y
    and b.month = w.m
  -- Overall budget first, then the biggest category budgets.
  order by (b.category_id is not null), b.amount desc;
$$;

grant execute on function public.expense_summary(date, date)            to authenticated;
grant execute on function public.monthly_totals(integer)                to authenticated;
grant execute on function public.budget_status(smallint, smallint)      to authenticated;
