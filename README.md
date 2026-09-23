# Tally — expense tracker

An expense tracker you use normally through a web app, **or** talk to through your
AI assistant over MCP ("I bought coffee and a metro pass today") and have it show
up automatically — same data, same rules, either path.

```
frontend/   Vite + React + TypeScript + Tailwind, built to the Tally mockups
backend/    Remote MCP server (Node + TypeScript, Streamable HTTP, OAuth 2.1),
            which also serves the built frontend — one deploy, one origin
supabase/   Postgres schema, RLS policies and reporting functions
```

## Why there is no REST API layer

Supabase *is* the backend. The frontend talks to it directly with `supabase-js`,
and so does the MCP server — scoped to the authenticated user's token. Both paths
hit the same tables under the same Row Level Security policies, so there is one
source of truth and one set of business rules, not two implementations drifting
apart.

The MCP server never holds a service-role key. It reaches expense data only with
the end user's own access token, which means a bug there cannot see more than
that user could see in the browser.

---

## Setup

### 1. Supabase

Create a project, then run the migrations in order in the SQL editor:

| File | What it creates |
|---|---|
| `supabase/migrations/0001_init.sql` | Tables, RLS policies, new-user bootstrap |
| `supabase/migrations/0002_reporting.sql` | `expense_summary`, `monthly_totals`, `budget_status` |
| `supabase/migrations/0003_mcp_oauth.sql` | The `mcp_oauth` schema for the MCP server's OAuth bookkeeping |
| `supabase/migrations/0004_mcp_connections.sql` | Lets Settings list and disconnect connected MCP clients |

**Google sign-in** (the primary login) needs an OAuth client registered in the
Google Cloud Console, with its client ID and secret added under
*Authentication → Providers → Google* in Supabase. Add both redirect URLs: your
origin, and its `/connect` page (the MCP consent screen). In a deploy those are
the same host — see [Deploying to Render](#deploying-to-render).

**The MCP server's database role.** `0003` ends with a commented block creating
`mcp_oauth_rw`. Uncomment it, set a real password, and run it. That role can
reach the `mcp_oauth` schema and nothing else — it is why the server does not
need a service-role key.

### 2. Backend (MCP server)

```bash
cd backend
cp .env.example .env    # fill in SUPABASE_URL, SUPABASE_ANON_KEY, DATABASE_URL
npm install
npm run dev             # http://localhost:8787
```

### 3. Frontend

```bash
cd frontend
cp .env.example .env.local   # fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev                  # http://localhost:5173
```

In development these stay two processes, so that Vite can do hot reloading — the
app on 5173, the API on 8787, with `APP_URL` and `VITE_MCP_SERVER_URL` pointing
them at each other. A deploy is a single service instead, the backend serving the
built app from its own origin; `npm run build` in `backend/` is what stitches
them together. To exercise that locally, build and run it:

```bash
npm run build --prefix frontend
npm run build --prefix backend    # copies frontend/dist -> backend/dist/public
cd backend && node dist/index.js  # app and /mcp both on http://localhost:8787
```

---

## Deploying to Render

`render.yaml` in the repo root describes **one** service, `tally`, serving both
the MCP endpoint and the web app. In Render: **New → Blueprint**, pick this repo,
and it reads that file.

The build spans both packages: the frontend is built first, then the backend's
build copies `frontend/dist` into `backend/dist/public`
([`scripts/bundle-web.mjs`](backend/scripts/bundle-web.mjs)), so the deploy is
one self-contained tree started with `node backend/dist/index.js` and
health-checked at `/health`.

Express registers the API first, so it always wins; whatever is left over is
served as the web app, with any unmatched GET returning `index.html` because
React Router owns the paths:

| Path | Handled by |
|---|---|
| `/health` | health check |
| `/.well-known/*` | OAuth discovery documents |
| `/authorize`, `/token`, `/register`, `/revoke` | OAuth endpoints |
| `/connect`, `/connect/complete` | the MCP consent screen |
| `/mcp` | the MCP endpoint itself |
| everything else | the web app (`index.html` fallback) |

This is why the consent screen lives at `/connect` rather than `/login`: the web
app's own sign-in page owns `/login`, and on one origin they cannot both have it.

### Nothing has to be told its own address

Splitting this across two services used to mean each needed the other's URL —
and Render only assigns those once the services exist, so the references were
either hardcoded or resolved to the private hostname rather than the public one.
On one origin the question disappears. There is no `APP_URL` and no
`VITE_MCP_SERVER_HOST`: the app reads `/mcp` off `window.location.origin`, and
the server derives everything from `RENDER_EXTERNAL_URL`, which Render always
sets to the real URL — so the discovery documents are correct on the first
deploy whatever hostname it hands out. Set `PUBLIC_URL` only if you later put a
custom domain in front.

Deploying the blueprint prompts for five secrets, none of them in git:

| Variable | Used | Value |
|---|---|---|
| `SUPABASE_URL` | runtime | your project URL |
| `SUPABASE_ANON_KEY` | runtime | the **anon** key — a service-role key is refused at startup |
| `DATABASE_URL` | runtime | session pooler string for `mcp_oauth_rw` (below) |
| `VITE_SUPABASE_URL` | build | same project URL — Vite only exposes `VITE_`-prefixed variables, hence the repetition |
| `VITE_SUPABASE_ANON_KEY` | build | the **anon** key — this one is meant to be public; RLS is what protects the data |

### The database role

Run `supabase/create_mcp_role.sql`, then build `DATABASE_URL` from the **Session
pooler** details (port 5432), substituting the role name for `postgres` in the
username:

```
postgresql://mcp_oauth_rw.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Percent-encode special characters in the password (`@` → `%40`, `#` → `%23`,
`/` → `%2F`, `:` → `%3A`), or generate one without them.

### After the first deploy

In Supabase → Authentication → URL Configuration, set **Site URL** to the
service's URL and add two **Redirect URLs**:

```
https://<your-render-url>/
https://<your-render-url>/connect
```

The first is where the web app's own sign-in returns, the second where the MCP
consent screen does. Both sign the user in through Supabase, and Supabase will
not redirect back to an origin it has not been told about.

Then verify before pointing a client at it:

```bash
curl https://<your-render-url>/health
curl https://<your-render-url>/.well-known/oauth-protected-resource/mcp
curl -I https://<your-render-url>/transactions    # 200 text/html, not 404
```

The second must report your actual Render URL in `resource` and
`authorization_servers` — not localhost, and not a guessed hostname. The third
confirms the web app is being served and its deep links survive a refresh.

> **On the free plan** the service sleeps after inactivity, so the first request
> after a quiet spell waits ~30s for a cold start. That now applies to the web
> app too, not just the MCP endpoint — the tradeoff for one origin is that the
> app is behind the same Node process instead of a CDN. Clients sometimes read
> the delay as a failed connection.

---

## Connecting an assistant

### Local testing without deploying

Claude's Custom Connectors cannot reach `localhost`, so for local work put a
tunnel in front of the server and set `PUBLIC_URL` to the https URL it gives
you:

```bash
cloudflared tunnel --url http://localhost:8787    # or: ngrok http 8787
```

The same two rules as a deploy apply: `PUBLIC_URL` must match the tunnel URL,
and that URL's `/connect` path must be in Supabase's Redirect URLs. The MCP
Inspector talks to `http://localhost:8787/mcp` directly and needs neither.

### Adding the connector

1. In Claude: **Settings → Connectors → Add → Add custom connector**.
2. Paste `https://<your-host>/mcp`. The client registers itself (RFC 7591) and
   starts the OAuth flow.
3. Sign in with the same account you use in the web app. From then on every
   tool call runs as you, under the same RLS.

There is no separate account, no API key to paste, and no token to keep safe.
Connected clients are listed under **Settings → Connect your AI assistant** in
the app, and can be cut off from there.

### What the assistant can do

| Tool | Purpose |
|---|---|
| `add_expense` | description, amount, category (optional — matched or created), date (defaults today) |
| `add_expenses_bulk` | several at once, for "I bought X, Y and Z" |
| `update_expense` | change amount / description / category / date |
| `delete_expense` | remove by id |
| `list_expenses` | filter by category, date range, amount, text; paginated |
| `get_summary` | all-time totals and category breakdown |
| `get_monthly_summary` | totals for one month |
| `list_categories` | what already exists, so the AI reuses buckets |
| `add_category` | create one explicitly |
| `rename_category` / `delete_category` | maintenance |
| `set_budget` | set or update a monthly budget (overall or per category) |
| `get_budget_status` | spent vs. budget, flagging anything exceeded |
| `export_expenses_csv` | CSV of the matching expenses |

**Prompt:** `log_expense` — pre-filled with the user's categories and budget
position, so they can say what they bought without thinking about categories.

**Resources:** `tally://categories` and `tally://budget-status` — live context, so
the assistant reuses existing categories and can mention a budget it is about to
blow through.

---

## How the OAuth flow works

Supabase Auth is the identity provider, but it is not an OAuth authorization
server for third-party clients — MCP clients need dynamic registration and PKCE.
So the MCP server acts as its own authorization server in front of it:

1. The client registers itself at `/register` and sends the user to `/authorize`.
2. The server parks the request and redirects to its own `/connect` page, where
   the user signs in against Supabase directly — the server never sees a password.
3. That Supabase session is exchanged for an authorization code, then for an
   access token (PKCE-verified) belonging to this server.
4. On every MCP request the server verifies its own token, refreshes the user's
   Supabase session, and builds a `supabase-js` client with *that* access token.

Tokens are stored as SHA-256 hashes, refresh tokens rotate on use, and a replayed
authorization code revokes the whole grant.

---

## Notes and caveats

- **Use the session pooler for `DATABASE_URL`, not the direct host.**
  `db.<ref>.supabase.co` now resolves to IPv6-only, so it fails with
  `ENOTFOUND` on IPv4 networks and every OAuth call returns a 500. Copy the
  **Session pooler** string from Dashboard → Connect instead — it looks like
  `aws-N-<region>.pooler.supabase.com:5432` with the username
  `<role>.<project-ref>`.
- **`month_start_day` is stored but not yet applied.** The settings screen lets
  you set a payday-aligned month, and the column exists, but `budget_status` and
  the monthly summaries still use calendar months. Honouring it means shifting the
  window in `0002_reporting.sql` and in `monthBounds`.
- **The mockups showed API tokens for the chat connection; this implements OAuth
  2.1 instead**, per the plan — it is what MCP clients actually speak, and it
  avoids a second credential to manage. The Settings panel keeps the mockup's
  shape but shows the server URL and a setup prompt rather than a token list.
- **`export_expenses_csv` caps at 500 rows.** A bigger export belongs in the app's
  own Export CSV button, which has no cap, rather than in a chat transcript.
- The app has a dark theme defined but no toggle wired up yet; it follows the
  `.dark` class if you add one.
- **The UI is transcribed from the design mockups**, not assembled from stock
  components: `src/components/tally.tsx` holds the building blocks (panels,
  buttons, category pills, meters) at the sizes and colours the mockups specify,
  and `src/components/charts.tsx` draws the spending bars and category donut by
  hand. Radix primitives remain underneath the dialog, select and menu, themed
  to match. Category pill tints are derived from each category's stored hex in
  `src/lib/category-style.ts`, since categories are user-defined.
- The **"Weekly email summary"** toggle on Settings is from the mockup but has
  nothing behind it; it says so when you flip it. The mockup's "Auto-categorise
  bank expenses" row is left out entirely — there is no bank integration.
