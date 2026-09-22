# Expense Tracker — Plan

An expense tracker you can use normally through a web app, **or** talk to through
your AI assistant via MCP ("I bought coffee and a metro pass today") and have it
show up automatically — same data, same rules, either path.

## Stack

| Layer | Choice |
|---|---|
| Frontend | `frontend/` — Vite + React + latest TypeScript |
| Styling / UI | Tailwind (latest) + **shadcn/ui** components + **shadcn charts** (Recharts under the hood), custom theme |
| Backend / DB | Supabase (Postgres + Auth + Row Level Security) |
| MCP server | `backend/` — Node + latest TypeScript, Streamable HTTP transport, deployed as a **remote MCP server** |
| Auth (app) | Supabase Auth — Google OAuth (primary) + email/password or magic link as fallback |
| Auth (MCP) | OAuth 2.1, per Anthropic's [remote MCP server docs](https://platform.claude.com/docs/en/agents-and-tools/remote-mcp-servers) — the MCP server exchanges the OAuth token for the same Supabase user session, so RLS applies identically whether the write comes from the app or from the AI |

**Why no separate REST API layer:** Supabase *is* the backend. The frontend talks
to Supabase directly with `supabase-js` (RLS-protected). The MCP server also
talks to Supabase directly with `supabase-js`, scoped to the authenticated
user's token — so there's one source of truth and one set of business rules
(enforced via Postgres RLS + a couple of DB functions/triggers), not two
implementations to keep in sync.

**Why shadcn:** yes, use it. It's unstyled-by-default and fully ownable, so we
theme it to a custom look (colors, radius, type scale) instead of the default
look — good fit for "custom styled to our liking." Use **shadcn's chart
components** (Recharts wrapper) for the spending summary / category
breakdown / budget-vs-actual visuals instead of hand-rolling charts.

---

## Data model (Postgres / Supabase)

```
users              -- handled by Supabase Auth

categories
  id, user_id, name, color, icon, created_at

expenses
  id, user_id, category_id (nullable → "Uncategorized"),
  description, amount, expense_date, source ('manual' | 'ai'),
  created_at, updated_at

budgets
  id, user_id, category_id (nullable = overall budget),
  month, year, amount, created_at
```

RLS: every table scoped to `auth.uid() = user_id`. This is what makes "manual
via app" and "via AI through MCP" safe to share one schema — neither path can
touch another user's data, and the MCP server never needs a service-role key.

---

## Core features (work the same with or without AI)

- Add / update / delete an expense (description + amount, date, category)
- View all expenses (list, sortable/filterable)
- View a summary of all expenses (totals, by category)
- View a summary for a specific month of the current year
- Categories, with filter-by-category on the expenses list
- Monthly budgets (overall and/or per category), with a warning banner/toast
  when spend exceeds budget
- Export expenses to CSV (respecting active filters)

---

## MCP server (`backend/`)

### Tools

| Tool | Purpose |
|---|---|
| `add_expense` | description, amount, category (optional — AI can guess/create), date (optional, defaults today) |
| `add_expenses_bulk` | same as above but a list, for "I bought X, Y, and Z" in one message |
| `update_expense` | change amount/description/category/date on an existing expense |
| `delete_expense` | remove an expense by id |
| `list_expenses` | filter by category, date range, min/max amount; paginated |
| `get_summary` | all-time totals, breakdown by category |
| `get_monthly_summary` | totals + category breakdown for a given month (current year) |
| `list_categories` | current categories, so the AI knows what already exists |
| `add_category` | create a new category on the fly (AI can auto-create when nothing fits) |
| `rename_category` / `delete_category` | maintenance |
| `set_budget` | set/update a budget for a month (overall or per category) |
| `get_budget_status` | spent vs. budget for the current or given month, flags if exceeded |
| `export_expenses_csv` | returns CSV content (respects filters) for the AI to hand back or save |

### MCP Prompts

- `log_expense` — a ready-made prompt template (surfaced in-app as "Copy prompt
  for your AI") that's pre-filled with the user's current categories and
  budget context, so the user can just say what they bought without knowing
  or listing categories themselves. This is the thing that removes the
  "thinking about categories" friction the user described.

### MCP Resources

- `categories` — live list, so the assistant always has current categories in
  context without calling a tool first
- `budget-status` — current month's budget vs. spend, so the assistant can
  proactively mention "you're close to your budget" while logging an expense

### Auth flow

1. App shows a "Connect your AI" screen with the remote MCP server URL.
2. User adds the connector in Claude (or another MCP client); OAuth flow logs
   them into their existing Supabase account — same Google (or email) login
   they use in the app, no separate account to manage.
3. Every tool call runs with that user's token → RLS enforces the same rules
   as the app.

Setup note: enabling Google sign-in means registering an OAuth client in
Google Cloud Console and adding the client ID/secret to the Supabase Auth
provider settings.

---

## Frontend (`frontend/`)

- **Dashboard**: monthly summary, budget progress bar (shadcn chart), recent
  expenses
- **Expenses list**: table, category filter, search, edit/delete inline, "add
  expense" form (shadcn form + dialog)
- **Categories**: manage list, color/icon per category
- **Budgets**: set per-month (overall + per-category), visual warning state
  when over budget
- **Export**: CSV download button, respects current filters
- **Connect AI**: shows the MCP server URL + one-click "copy setup prompt"
  from the `log_expense` MCP prompt

---

## Build order

1. Supabase schema + RLS policies + auth
2. Frontend: manual CRUD, list, summary, monthly summary, categories, budgets
   + warnings, CSV export (fully usable app with no AI involved)
3. MCP server: implement tools 1:1 against the same Supabase schema, deploy
   as a remote MCP server, wire up OAuth
4. MCP prompts + resources for the low-friction "just tell me what you
   bought" experience
5. Polish: shadcn chart tuning, custom theme pass, budget-warning UX