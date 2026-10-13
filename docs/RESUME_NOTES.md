# Resume Notes — Tally (expense-tracker-mcp)

Read-only analysis of this repo. Every claim cites a file. Numbers that are not provable from the repo are written as `[placeholders]` and listed in section 8.

**Authorship.** `git config user.name` = Abdur Rahman Raja. `git shortlog -sne --all` shows two name variants ("Abdur Rahman" ×7, "Abdur Rahman Raja" ×2) on the same email, so all 9 commits are yours. Solo project, no other contributors. Commit range: 2026-09-22 → 2026-10-12.

**Size (tracked files, excluding lockfiles and the 931 KB design-mockup HTML):** ~4,060 lines TypeScript (backend + tests), ~4,280 lines TSX (frontend), ~680 lines SQL (6 migrations + 2 helper scripts), ~220 lines CSS.

---

## 1. Project summary

Tally is a full-stack expense tracker that can be used through a React web app **or** by talking to an AI assistant (Claude) over the Model Context Protocol. Both paths hit the same Postgres tables under the same Row Level Security rules. I built the web app, a remote MCP server that acts as its own OAuth 2.1 authorization server, the Postgres schema and reporting functions, and a bank-statement importer, and deployed it as a single service on Render.

---

## 2. Tech stack (only what is actually used)

| Category | Technologies | Evidence |
|---|---|---|
| Languages | TypeScript, SQL (PL/pgSQL), JavaScript (ESM build script), HTML/CSS | `backend/src`, `frontend/src`, `supabase/migrations`, `backend/scripts/bundle-web.mjs` |
| Backend | Node.js 22, Express 5, Model Context Protocol SDK (Streamable HTTP transport), Zod 4, `pg`, `cors` | `backend/package.json`, `render.yaml` |
| Auth | OAuth 2.1 (authorization code + PKCE S256), Dynamic Client Registration (RFC 7591), OAuth discovery metadata, Supabase Auth (Google OAuth, email/password, magic link) | `backend/src/auth/provider.ts`, `login.ts` |
| Data | PostgreSQL (Supabase), Row Level Security, `SECURITY DEFINER` / `SECURITY INVOKER` functions, triggers, partial unique indexes, `supabase-js` / PostgREST RPC | `supabase/migrations/0001–0006` |
| Frontend | React 19, React Router 7, Vite 8, Tailwind CSS 4, Radix UI primitives, react-hook-form + Zod, date-fns, sonner, hand-drawn SVG charts | `frontend/package.json`, `frontend/src/components/charts.tsx` |
| Cloud / Infra | Render (Blueprint, free web service), Supabase (managed Postgres + Auth), session-pooler Postgres connection | `render.yaml`, `README.md` |
| Build / DevOps | Multi-package build pipeline (frontend → copy into backend `dist/public`), health check, env-var-driven config, graceful shutdown | `render.yaml`, `backend/scripts/bundle-web.mjs`, `backend/src/index.ts` |
| Testing | `node:test` via `tsx --test`, 18 test cases in 2 files | `backend/src/lib/bank-csv.test.ts`, `backend/src/mcp/import-batches.test.ts` |
| Tooling | TypeScript (project refs, `tsc -b`), oxlint, tsx | `frontend/package.json`, `frontend/.oxlintrc.json` |

---

## 3. Evidence table (resume-worthy items only)

| # | Finding | Category | Why it matters | File path(s) |
|---|---|---|---|---|
| 1 | Implemented a full OAuth 2.1 authorization server (DCR, PKCE, authorization codes, access/refresh tokens, revocation, discovery docs) on top of the MCP SDK's `OAuthServerProvider` interface, with Supabase as the identity provider | Backend / Security | Non-trivial protocol work; most tutorials stop at API keys. Shows you read RFCs and handled real client interop | `backend/src/auth/provider.ts`, `backend/src/index.ts` (`mcpAuthRouter`, `requireBearerAuth`) |
| 2 | Token hygiene: SHA-256-hashed tokens at rest, refresh-token rotation, scope-narrowing-only refresh, single-use auth codes where **replay revokes the whole grant**, expired-row purge job | Security | Concrete, defensible security decisions you can explain | `provider.ts` (`hashToken`, `exchangeAuthorizationCode`, `exchangeRefreshToken`), `0003_mcp_oauth.sql` (`purge_expired`), `index.ts` (hourly `purgeTimer`) |
| 3 | "MCP path has no more authority than the browser path": server never holds a service-role key; every tool call runs as the user via their own Supabase access token under RLS; startup **refuses** a non-anon key by decoding the JWT `role` claim | Security / Architecture | Least-privilege design with a guardrail that fails closed | `backend/src/lib/supabase.ts`, `backend/src/config.ts` (`assertNotServiceRole`) |
| 4 | Least-privilege DB role `mcp_oauth_rw`: can reach only the `mcp_oauth` schema (not exposed by PostgREST), `revoke all on schema public` | Security / Data | Limits blast radius of a server compromise | `supabase/create_mcp_role.sql`, `0003_mcp_oauth.sql` |
| 5 | Row Level Security on all 4 user tables (15 policies) plus a `SECURITY DEFINER` trigger that blocks writing another user's category id onto your own row (RLS alone does not stop that) | Data / Security | Shows understanding of an RLS gap, not just "enabled RLS" | `0001_init.sql` (`assert_category_owned`) |
| 6 | Reporting logic in SQL: `expense_summary`, `monthly_totals` (gap-filled month series via `generate_series`), `budget_status` as `SECURITY INVOKER` functions so the app and the AI get identical numbers and RLS still applies | Data | Single source of truth for business rules across two clients | `0002_reporting.sql`, `backend/src/lib/expenses.ts`, `frontend/src/lib/api.ts` |
| 7 | Bank statement parser: hand-written RFC 4180 CSV reader, integer-cent arithmetic, regex classification of Interac/Visa lines, **netting** of purchases against reversals, corrections, returns and fee/discount pairs, merchant-name cleaning, stable content-hash ids (cyrb53) with an occurrence counter so identical lines stay distinct | Algorithms | Real problem-solving on messy data; pure function, unit-tested | `backend/src/lib/bank-csv.ts`, `bank-csv.test.ts` (14 cases) |
| 8 | Idempotent re-import: `external_id` fingerprint + `UNIQUE (user_id, external_id)` + `upsert … ignoreDuplicates`, chunked 200 rows at a time; pre-filtered by date-range lookup | Data / Reliability | Overlapping statements don't double-count; applies the idempotency pattern correctly | `0006_bank_import.sql`, `expenses.ts` (`existingExternalIds`, `importExpenses`) |
| 9 | Two-step, human-in-the-loop import protocol: `parse_bank_statement` stages a batch (in-memory, per-user, 30-min TTL, 5-batch and 5,000-row caps), returns a per-merchant summary, then `import_transactions` **validates everything before writing anything** (all-or-nothing) | Systems / API design | Designed a tool protocol around LLM limits (token cost, hallucinated category names) | `backend/src/mcp/import-batches.ts`, `backend/src/mcp/server.ts` (`batchSummary`, `import_transactions`), `import-batches.test.ts` |
| 10 | MCP surface: 17 tools, 2 prompts, 2 resources, with read-only/destructive/idempotent annotations, Zod input schemas, budget-warning feedback in write responses | API design | Complete, well-annotated MCP server | `backend/src/mcp/server.ts` |
| 11 | Stateless MCP transport: one `McpServer` + transport per request built from the request's auth info, so no session sharing and revocation takes effect on the next call | Systems | Deliberate concurrency/security trade-off | `backend/src/index.ts` (`POST /mcp`) |
| 12 | Consolidated two services into one origin: Express serves the SPA with immutable caching for fingerprinted assets, `no-cache` for the HTML, SPA fallback that deliberately excludes `/.well-known/*` so OAuth discovery probes can tell a miss from a hit | Infra / Debugging | Evidence of root-causing a deploy problem and changing architecture to remove it | `backend/src/index.ts`, `backend/scripts/bundle-web.mjs`, `render.yaml`, commit `0ff541e` |
| 13 | Config that fails at startup, not three redirects later: https enforcement, origin-without-path check, `RENDER_EXTERNAL_URL` fallback so the issuer URL is right on first deploy | DevOps / Reliability | Operational maturity | `backend/src/config.ts`, `render.yaml` |
| 14 | Production-debugging fixes: `trust proxy` for rate-limit keying behind Render, scoped wildcard CORS with justification and `exposedHeaders`, IPv6-only direct DB host → session pooler, login page that was invalidating the very Supabase session it handed over (fixed by not calling `signOut`) | Debugging | Real, documented bugs with root causes | `backend/src/index.ts`, `README.md` (Notes), `auth/login.ts`, commit `8550a12` |
| 15 | `SECURITY DEFINER` RPCs let the browser list/revoke MCP connections from a schema PostgREST can't see, with pinned `search_path`, explicit `revoke … from public, anon`, and an `auth.uid()` null guard | Security / Data | Avoided building a second auth surface | `0004_mcp_connections.sql`, `frontend/src/lib/api.ts` (`fetchMcpConnections`) |
| 16 | Money correctness: `numeric(12,2)` in DB, integer cents in the parser, `ILIKE` wildcard escaping in search | Data | Small details that show care | `0001_init.sql`, `bank-csv.ts`, `expenses.ts:376` |
| 17 | Frontend: auth hook + protected routes, error boundary, month switcher, dashboard/budgets/transactions/settings pages, CSV export, hand-built SVG bar/donut charts, category pill colours derived from stored hex | Frontend | Complete product UI, not a stub | `frontend/src/pages/*`, `components/charts.tsx`, `lib/category-style.ts`, `lib/csv.ts` |

Items I deliberately left out as trivial: "uses Express," "has .gitignore," env-example files, Radix wrappers in `components/ui/`.

---

## 4. Resume bullets

Strongest first. `[brackets]` = not provable from the repo; see section 8.

### Version A — Backend / systems roles

1. **Architected a remote MCP server that doubles as an OAuth 2.1 authorization server** (dynamic client registration, PKCE S256, refresh-token rotation, revocation, discovery metadata) in TypeScript/Express, letting AI assistants act on a user's data under their own identity.
2. **Designed a no-service-key security model**: the server executes every tool call with the end user's Supabase access token under Postgres Row Level Security, stores only SHA-256 token hashes, revokes the full grant on auth-code replay, and refuses to boot if given a service-role key.
3. **Built a bank-statement importer** (custom RFC 4180 parser, integer-cent arithmetic, regex classification) that nets purchases against reversals, returns and fee discounts, and assigns content-hash IDs so re-importing overlapping statements is idempotent via a unique constraint and `upsert`.
4. **Exposed 17 MCP tools, 2 prompts and 2 resources** with Zod-validated inputs and read-only/destructive/idempotent annotations; designed a two-phase, all-or-nothing import protocol (stage → summarize → validate → write) to keep LLM token use and hallucinated categories in check.
5. **Moved business rules into Postgres**: 6 migrations, 4 RLS-protected tables with 15 policies, a trigger closing a cross-tenant category-id write gap, and `SECURITY INVOKER` reporting functions so the web app and the assistant return identical budget and summary numbers.
6. **Implemented a stateless per-request MCP transport** with bearer-token verification that refreshes the upstream Supabase session and rotates its refresh token on each call, so revocation takes effect on the next request.
7. **Wrote 18 unit tests** (`node:test`) covering CSV parsing edge cases, reversal netting, merchant cleaning, ID stability, and per-user batch isolation and expiry.
8. **Built the React 19 / Vite / Tailwind 4 web client** (dashboard, budgets, transactions, settings, CSV export, hand-drawn SVG charts) on the same Supabase backend, with no separate REST layer to drift out of sync.

### Version B — Cloud / infra / DevOps roles

1. **Consolidated a two-service deployment into one Render service** (Express serving the Vite build, immutable caching for hashed assets, SPA fallback that preserves OAuth `/.well-known` discovery), eliminating cross-service URL wiring that had caused repeated hostname bugs.
2. **Authored a Render Blueprint and multi-package build pipeline** (`npm ci` + build frontend → bundle into backend `dist/public` → start with health check at `/health`), with secrets prompted rather than committed, and a cross-platform copy script that works on Windows and Linux.
3. **Hardened configuration to fail fast at startup**: https-only issuer enforcement, origin-without-path validation, `RENDER_EXTERNAL_URL` fallback so OAuth metadata is correct on the first deploy, and rejection of service-role keys by decoding the JWT.
4. **Implemented least-privilege database access**: a dedicated `mcp_oauth_rw` Postgres role with rights to a single non-exposed schema, `revoke all` on `public`, and `SECURITY DEFINER` RPCs with pinned `search_path` and explicit grants for the browser-facing connection list/revoke.
5. **Diagnosed and fixed production-only failures**: IPv6-only Supabase direct host (moved to session pooler), proxy-misattributed client IPs (`trust proxy`), CORS header exposure for browser MCP clients, and a login handshake that invalidated its own session.
6. **Added operational hygiene**: graceful `SIGTERM`/`SIGINT` shutdown draining the Postgres pool, hourly expired-grant purge, structured `[tally]` error logging on DB and session-refresh failures, and TTLs/caps on in-memory import batches.
7. **Designed the multi-tenant data layer on managed Postgres (Supabase)**: RLS on every table, per-user unique indexes, partial indexes for nullable budget keys, and SQL reporting functions shared by web and AI clients.
8. **Served [X users / Y requests] with [uptime/latency]** — *placeholder; only include if you have real numbers (see Q2–Q4).*

---

## 5. ATS keywords

TypeScript, JavaScript, Node.js, Express, React, React Router, Vite, Tailwind CSS, Radix UI, PostgreSQL, SQL, PL/pgSQL, Supabase, Row Level Security, PostgREST, supabase-js, node-postgres, Model Context Protocol, MCP, OAuth 2.1, PKCE, Dynamic Client Registration, RFC 7591, JWT, Zod, react-hook-form, date-fns, CORS, Render, Render Blueprint, REST, Streamable HTTP, Google OAuth, Magic Link, SHA-256, idempotency, upsert, multi-tenant, least privilege, health check, graceful shutdown, node:test, tsx, oxlint, ESM, cache-control, SPA

---

## 6. Interview talking points

### 1. Building an OAuth 2.1 authorization server in front of an identity provider that isn't one
- **Problem:** MCP clients need dynamic registration and PKCE; Supabase Auth doesn't offer that to third-party clients.
- **Decision:** the MCP server is its own authorization server. It parks the `/authorize` request, sends the user to `/connect` where they sign in against Supabase directly (server never sees a password), swaps that session for an auth code, then for its own token pair that *wraps* the Supabase refresh token.
- **Details worth saying:** GoTrue rotates refresh tokens on every use, so each verification must store the new one; replayed auth code revokes the grant; refresh can only narrow scope.
- **Bug story:** `/connect` called `signOut()`, which ends the session server-side and killed the refresh token the MCP server had just taken. Every connection failed on first request. Fix: delete the local storage key instead (`login.ts`, commit `8550a12`).

### 2. "No service-role key" as an architectural invariant
- **Decision:** one set of rules (RLS) shared by browser and AI, rather than two implementations. The server builds a per-request supabase-js client with the user's token.
- **Tradeoff:** every request needs a Supabase session refresh (extra latency and a dependency on GoTrue availability), in exchange for an AI-path bug not being able to read another tenant's rows.
- **Defence in depth:** startup check decoding the JWT role claim; separate DB role for OAuth tables; trigger that RLS can't replace (`assert_category_owned`).

### 3. Making a messy bank CSV safe for an LLM to import
- **Problem:** raw statements overstate spending (refund = purchase + reversal; fee = charge + discount), and an LLM shouldn't echo hundreds of rows or invent categories.
- **Decision:** deterministic netting in a pure, tested function; staged batches so the model sees a per-merchant summary and replies with one category per merchant; validate-then-write so a bad category name imports nothing; fingerprint ids so retries are safe.
- **Details:** Interac references repeat across months, so only Visa refs are trusted for grouping; Interac returns match on merchant + amount + ≤3 days; duplicate identical lines get an occurrence counter so they aren't collapsed.

*(Honorable mention: the one-service consolidation and why the SPA fallback excludes `/.well-known`.)*

---

## 7. Gaps & quick wins

Ranked by impact ÷ effort.

| Rank | Gap | Effort | Why it matters |
|---|---|---|---|
| 1 | **No CI** (`.github/` absent). Add a workflow running `npm ci`, `typecheck`, `test`, `lint`, `build` | ~30 min | The single most visible "professional" signal missing; backend tests and typecheck already exist |
| 2 | **No tests for the OAuth provider** — the strongest feature has zero coverage (only parser and batch store are tested; no frontend tests; no integration/e2e) | 2–4 hrs | Test PKCE mismatch, code replay → grant revoked, refresh scope widening rejected, expired token. Turns a claim into proof |
| 3 | **No architecture diagram in README** for the OAuth sequence | 1 hr | Recruiters and interviewers skim diagrams; a Mermaid sequence diagram of the 4-step flow would help |
| 4 | **No rate limiting** despite the `trust proxy` comment referencing `express-rate-limit` — it is not in `package.json` | 1 hr | `/register`, `/token`, and `/connect/complete` are unauthenticated. Either add it or remove the stale comment (`backend/src/index.ts:18-25`) |
| 5 | **TLS verification disabled** for the OAuth DB pool (`rejectUnauthorized: false`, `backend/src/db.ts`) | 30 min | An interviewer will notice. Pin Supabase's CA instead, or document the trade-off |
| 6 | **Possible refresh race**: concurrent MCP requests on one grant each call `refreshSession` with the same Supabase refresh token; GoTrue rotates tokens, so a second concurrent call could fail (my inference from the code; not tested) | 1–2 hrs | Worth verifying; serialize per-grant or tolerate GoTrue's reuse window |
| 7 | **In-memory import batches** are single-instance only (documented in code) | — | Fine for this scale; know the answer when asked "what breaks at 2 instances?" |
| 8 | **Repo hygiene**: `.claude/scheduled_tasks.lock` is committed; `.mcp.json` embeds a Supabase project ref; a 931 KB mockup HTML is tracked | 10 min | Remove/ignore before sharing the repo publicly |
| 9 | **No Dockerfile / IaC** beyond `render.yaml` | 1–2 hrs | Optional; a small Dockerfile helps cloud/infra-targeted resumes |
| 10 | **Known unfinished**: `month_start_day` stored but unused; weekly-email toggle is a stub; no dark-mode toggle (all documented in README) | varies | Fine as long as README stays honest, but don't claim these as features |
| 11 | **No metrics/tracing/alerting**; logging is `console.*` only | 2+ hrs | Keep out of bullets; mention only "health check and error logging" |

---

## 8. Questions for me

1. **Is this deployed and live?** Is the Render service running, and is it connected to Claude as a custom connector? (Determines whether you can say "deployed" vs. "deployable".)
2. **Users / traffic:** how many people (even just you and friends) use it? How many expenses are stored? → `[N users, M expenses]`
3. **Import accuracy:** how many real statement lines have you run through the importer, and roughly what fraction needed manual correction? Any before/after on a statement where netting changed the total? → `[X lines parsed, reversal netting corrected $Y / Z% of rows]`
4. **Latency:** any measured time for a tool call or an end-to-end `add_expense`, including the Supabase session refresh? → `[X ms]`
5. **Free-tier cold start:** the README says ~30 s. Did you measure it, and did you do anything about it?
6. **Provenance of the bank format:** the parser targets an RBC-style export (`date,description,debit,credit`). Which bank is it, and did you only test on your own data?
7. **AI assistance:** if AI tools wrote significant parts, how do you want that represented? (I can word bullets around design decisions and debugging that you drove, but I can't tell from the repo which lines were hand-written.)
8. **Design source:** the UI is "transcribed from the design mockups" (`Tally — expense tracker UI.html`). Did you design them, or were they provided/generated? Affects whether "designed" or "implemented" is the accurate verb.
9. **Concurrency:** have you hit the refresh-token race in gap #6, or run two simultaneous tool calls?
10. **Timeline:** git shows ~3 weeks of history. Was any of this built before the first commit (the first commit is 63 files / ~14.7k lines including lockfiles)? I used the commit dates only.
