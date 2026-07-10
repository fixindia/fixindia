# FixIndia.org — Improvement Implementation Guide

**Audience:** an AI coding agent (or developer) implementing these changes.
**Author:** prepared after a full read of the codebase.
**Status of security-critical work:** the auth/identity/integrity hardening pass is
already done (see `docs/PRODUCTION-READINESS.md`). This document covers the
**remaining, non-blocking improvements** — quality, reliability, DX, performance,
and features.

---

## 0. How to use this document

- Items are grouped by theme and each has: **Why**, **Where** (exact files),
  **What to do** (concrete steps), and **Acceptance criteria** (how to know it's done).
- Priorities: **P1** = do first (reliability/correctness), **P2** = important,
  **P3** = nice to have.
- **Golden rules for every change:**
  1. Never trust client-supplied identity — always use `auth.userId` from the
     verified Clerk token (see `server/src/auth.ts`). This pattern is already
     established; keep it.
  2. Never fabricate data (no `Math.random()` for counts/metrics).
  3. Keep all SQL parameterized via the `postgres` tagged-template (`sql\`...\``).
     Never string-concatenate user input into SQL.
  4. After any change run the verification commands in **Section 12** and ensure
     they pass before considering the task done.
- **Do not** commit secrets, `.env`, or anything under `SSH/`. Do not deploy or
  SSH anywhere unless explicitly asked.

---

## 1. Project map (so you know where things live)

```
/                      Frontend SPA (React 19 + Vite + Tailwind 4 + MapLibre)
  src/App.tsx          Monolithic root component (~1300 lines) — main citizen + volunteer UI
  src/components/      Feature components (MapEngine, ReportModal, Leaderboard, etc.)
  src/lib/api.ts       Single API client for the public backend
  src/lib/auth-provider.tsx  Clerk wrapper + hook re-exports
  src/types/index.ts   Shared TS types
  public/              Static assets, _headers, _redirects, robots.txt

server/                Backend (Elysia on Bun)
  src/index.ts         Public API, port 6969 (reports, news, mlas, leaderboards, volunteer)
  src/admin.ts         Admin API, port 6970 (metrics, ai-models, scrapers, SQL shell, PM2)
  src/auth.ts          Clerk JWT verification (verifyAuth/requireAuth/requireOwnership)
  src/admin_auth.ts    Cloudflare Access JWT + ADMIN_KEY verification
  src/security.ts      Rate limiting, sanitization, image magic-byte checks
  src/migrate.ts       Idempotent startup migrations (advisory-locked)
  src/db.ts            postgres connection pool
  src/llm.ts           Multi-provider LLM query with key rotation
  src/lib/storage.ts   Storj (S3) image upload/compression
  src/*_scraper.ts     News / MLA / project scrapers (cron + manual)
  src/volunteer_system.ts  Volunteer submission + peer verification
  schema.sql           Canonical DB schema (PostgreSQL + PostGIS)

admin-panel/           Separate React SPA for the admin API
```

**Runtime facts you must respect:**
- Public API listens on **6969**, admin API on **6970** (`server/ecosystem.config.json`).
- Identity: Clerk ID (`user_...`) lives in `users.clerk_id`; `users.id` is a UUID.
  Point/stat updates key on `clerk_id`.
- Two API processes share one DB and both call `runMigrations()` (advisory-locked).

---

## 1A. Security architecture — READ BEFORE TOUCHING ANY ENDPOINT

This project deliberately runs **two completely separate backend services with two
different trust models and two different auth systems**. Preserving that separation
is a hard requirement. Do not merge them, do not share routes between them, and do
not weaken either boundary.

### 1A.1 The two services and their isolation

| | Public API | Admin API |
|---|---|---|
| File | `server/src/index.ts` | `server/src/admin.ts` |
| Port | 6969 | 6970 |
| Public domain | `api.enjoyxd.eu.org` | `cr.enjoyxd.eu.org` (API) / `md.enjoyxd.eu.org` (panel) |
| PM2 process | `fixindia-api` | `fixindia-admin-api` |
| Who may call it | Any citizen (auth for writes) | Only the site operator(s) |
| Auth system | **Clerk** JWT (`server/src/auth.ts`) | **Cloudflare Access** JWT or `ADMIN_KEY` (`server/src/admin_auth.ts`) |
| Frontend | `src/` (main SPA, `fixindia.org`) | `admin-panel/` (separate SPA, `md.enjoyxd.eu.org`) |
| CORS allow-list | `PROD_ORIGINS` in `index.ts` (public site + volunteer domains) | `ALLOWED_ADMIN_ORIGINS` in `admin.ts` = **only** `https://md.enjoyxd.eu.org` in prod |

**Why this matters:** the admin surface (SQL shell, PM2 process control, AI-key
config, scraper triggers, all user/report data) is isolated onto its own domain,
its own port, its own process, its own CORS allow-list, and its own auth stack. A
compromise of the public site's Clerk auth cannot reach admin functionality, and the
admin panel's origin is not in the public API's CORS list (and vice-versa).

**Rules for the implementing model:**
1. **Never** add an admin-only capability (anything that reads arbitrary user data,
   mutates config, runs shell/PM2, or executes SQL) to the public API in `index.ts`.
   It belongs in `admin.ts` behind `verifyAdminAuth`.
2. **Never** add a public origin to `ALLOWED_ADMIN_ORIGINS`, and never add the admin
   panel origin to the public `PROD_ORIGINS`. Keep the two CORS lists disjoint.
3. **Never** call the admin API from the citizen SPA (`src/`) or the admin API from
   the volunteer portal. The only client of the admin API is `admin-panel/`.
4. If a new admin domain is added, put it in `ALLOWED_ADMIN_ORIGINS` **and** the
   Cloudflare Access application — never loosen CORS to a wildcard.

### 1A.2 Admin authentication order (`server/src/admin_auth.ts`)

`verifyAdminAuth` accepts a request if **either**:
1. A valid **Cloudflare Access JWT** is present in the `cf-access-jwt-assertion`
   header — verified against Cloudflare's JWKS with checks on signature (`kid` →
   public key), `exp`, `nbf`, `aud` (`CLOUDFLARE_AUD`), and `iss`
   (`https://<CLOUDFLARE_TEAM_DOMAIN>.cloudflareaccess.com`). This is the **primary,
   preferred** path for the deployed panel — the operator authenticates at the
   Cloudflare Access login, and no long-lived secret sits in the browser.
2. **OR** a valid `x-admin-key` header matching `ADMIN_KEY` (constant-time compare).
   This is a **fallback for local/direct use**. It is a single shared bearer secret —
   treat it as break-glass, not the primary control.

Every admin route except `/health` runs `verifyAdminAuth` in `onBeforeHandle`, and
every authenticated admin action is written to `admin_audit_log` (email + method +
path + IP). **Keep both of these invariants** when adding routes: new admin routes
are automatically guarded because the guard is global — do **not** add per-route
opt-outs, and do **not** add new public (unauthenticated) admin routes other than a
health check.

### 1A.3 Deployment/network hardening the operator should confirm (document, don't assume)

These are operational controls that live outside the code but the code depends on.
Call them out in any deploy docs you touch, and add a checklist item for each:
- **Cloudflare Access** must actually be enforced in front of `md.enjoyxd.eu.org`
  and `cr.enjoyxd.eu.org` (email/SSO allow-list), so the admin API is not reachable
  by the open internet even before app-layer auth.
- **Bind admin port 6970 to localhost / private interface** and expose it only via
  the Cloudflare tunnel/proxy — it should not be directly dialable on the VM's public
  IP. (The public API 6969 sits behind the reverse proxy for `api.enjoyxd.eu.org`.)
- **Firewall:** only 80/443 (proxy) and SSH should be open on the VM; 6969/6970 should
  not be publicly reachable.
- `ADMIN_KEY` must be ≥ 32 chars (enforced by `config.ts` in production) and rotated
  per `docs/SECRET-ROTATION.md`.

### 1A.4 The identity-binding invariant (applies to the public API)

Every mutating public endpoint derives the acting user from the **verified Clerk
token** (`auth.userId`), never from a request body field. Body fields like `userId`,
`creatorId`, `clerkId`, `submittedBy`, `verifierId` are accepted for backward-compat
but **ignored**. This is already implemented across `index.ts` and
`volunteer_system.ts` — when you add or edit any endpoint, keep this pattern.
Regression here re-introduces vote fraud / IDOR (see `docs/PRODUCTION-READINESS.md`).

---

## 2. Testing infrastructure (P1 — highest leverage)

**Why:** There are currently **zero automated tests**. Every other improvement is
risky without them. The `scripts/test_*.py` files are ad-hoc manual scripts, not a suite.

**Where:** new `server/tests/`, new `src/**/__tests__/`, `package.json` files.

**What to do:**
1. **Backend unit/integration tests with `bun test`** (built into Bun, no dep needed).
   - Add `"test": "bun test"` to `server/package.json` scripts.
   - Create `server/tests/security.test.ts` covering pure functions in
     `server/src/security.ts`: `validateImageMagicBytes` (valid JPEG/PNG/WebP magic
     bytes pass; a `.exe` header fails), `sanitizeTitle`/`sanitizeInput` (strips
     tags, respects maxLength), `checkRateLimit`/`checkUserRateLimit` (allows up to
     N, blocks N+1, resets after window — use small windows).
   - Create `server/tests/auth.test.ts`: `requireAuth`/`requireOwnership` return
     correct booleans and set `set.status` correctly for authed/unauthed/wrong-owner.
   - These are pure-function tests — **no DB or network required**. Prefer them.
2. **DB-dependent tests (optional, gated):** if a test Postgres is available via
   `DATABASE_URL`, add `server/tests/integration/*.test.ts` that spin up the Elysia
   app and hit endpoints with `app.handle(new Request(...))`. Gate with
   `if (!process.env.TEST_DATABASE_URL) test.skip(...)` so they don't fail in CI
   without a DB.
3. **Frontend tests with Vitest** (aligns with Vite):
   - Add dev deps: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`,
     `jsdom`. Add `"test": "vitest run"` to root `package.json`.
   - Add `test: { environment: 'jsdom', setupFiles: [...] }` to `vite.config.ts`.
   - Start with `src/lib/__tests__/api.test.ts`: mock `fetch` and assert each `api.*`
     method hits the right URL, method, and sends the `Authorization` header when a
     token is passed.

**Acceptance criteria:** `cd server && bun test` and `npm test` (root) both run and
pass green with at least the security + auth + api-client suites above. No test
requires network access to pass.

---

## 3. Backend reliability & correctness (P1)

### 3.1 Wrap all DB reads in error handling
**Why:** Public GET handlers (`/api/reports`, `/api/map/context`, `/api/news/*`,
`/api/leaderboard/*`, `/api/mlas`) call `sql\`...\`` with no try/catch. A transient
DB error becomes an unhandled rejection; the global `onError` catches it but returns
a bare 500 with no structure and the handler's partial work is lost.
**Where:** `server/src/index.ts` (each GET handler).
**What to do:** wrap each handler body in `try/catch`, log with a handler tag, and
return `{ error: 'Failed to load X' }` with `set.status = 500`. Keep the existing
global `onError` as a backstop. Do **not** leak `error.message` to the client.
**Acceptance:** every route handler has explicit error handling; grep shows no
`await sql` outside a try/catch in request handlers.

### 3.2 Add a real readiness/health check that verifies the DB
**Why:** `/health` returns `ok` even when Postgres is down, so load balancers and
`deploy.sh`'s health check pass on a broken server.
**Where:** `server/src/index.ts` and `server/src/admin.ts` `/health`.
**What to do:** add `/health/ready` that runs `await sql\`SELECT 1\`` inside a 2s
timeout; return 200 `{status:'ready'}` on success, 503 `{status:'degraded'}` on
failure. Keep `/health` as a cheap liveness probe. Update `server/deploy.sh` to
curl `/health/ready`.
**Acceptance:** hitting `/health/ready` with the DB down returns 503.

### 3.3 Graceful shutdown
**Why:** No SIGTERM/SIGINT handling; PM2 restarts can drop in-flight requests and
leak DB connections.
**Where:** `server/src/index.ts`, `server/src/admin.ts`.
**What to do:** on `process.on('SIGTERM'|'SIGINT')`, stop accepting new connections
(`app.stop()`), then `await sql.end({ timeout: 5 })`, then `process.exit(0)`.
**Acceptance:** sending SIGTERM logs a clean shutdown and exits within ~5s.

### 3.4 Fix the CI/PM2 startup inconsistency
**Why:** `.github/workflows/deploy.yml` starts the backend with
`nohup bun run src/index.ts &` and **only starts the public API, not the admin API**,
while `ecosystem.config.json` expects PM2 to run both. Production process management
is therefore inconsistent and the admin API may not be running.
**Where:** `.github/workflows/deploy.yml` lines 48–57.
**What to do:** replace the raw `nohup` block with PM2:
`pm2 startOrReload ecosystem.config.json && pm2 save`. Ensure `pm2` is installed on
the box (the `server/deploy.sh` already does this — prefer calling `deploy.sh`).
**Acceptance:** after deploy, `pm2 list` shows both `fixindia-api` and
`fixindia-admin-api` online.

### 3.5 Consolidate one-off migration scripts
**Why:** `server/src/migrate_image_url.ts` is a standalone migration that duplicates
what `migrate.ts` should own; drift between `schema.sql` and `migrate.ts` is a bug
source.
**Where:** `server/src/migrate.ts`, `server/src/migrate_image_url.ts`, `schema.sql`.
**What to do:** fold the `image_url` column add into `migrate.ts` (idempotent
`ADD COLUMN IF NOT EXISTS`), confirm `schema.sql` already has it (it does), then
delete `migrate_image_url.ts`. Going forward, **all** schema changes go in exactly
two places kept in sync: `schema.sql` (fresh installs) and `migrate.ts` (existing DBs).
**Acceptance:** `migrate_image_url.ts` deleted; a fresh `schema.sql` load and a
`migrate.ts` run produce identical table structures.

---

## 4. Structured logging & observability (P2)

**Why:** ~40 `console.log` calls with emoji across the backend. No levels, no
request IDs, no way to silence noise in production or trace a request.
**Where:** all `server/src/*.ts`.
**What to do:**
1. Add a tiny logger module `server/src/lib/logger.ts` exporting `logger.info/warn/error/debug`
   that (a) respects `LOG_LEVEL` env (default `info`), (b) emits JSON lines in
   production (`NODE_ENV=production`) and pretty text otherwise, (c) never logs
   secrets. No external dependency required — a ~30-line wrapper over `console` is fine.
   (If you prefer a library, `pino` is the standard choice; keep it optional.)
2. Replace `console.*` calls with `logger.*`. Keep the emoji only in dev-pretty mode.
3. Add a per-request ID: in the public API's `onBeforeHandle`, generate a short id
   (`crypto.randomUUID()`), attach to a context store, and include it in error logs
   and the `onError` response as `requestId` so users can quote it in bug reports.
**Acceptance:** setting `LOG_LEVEL=warn` silences info logs; production logs are
one JSON object per line; no secret values appear in any log.

---

## 5. Rate limiting durability (P2)

**Why:** `server/src/security.ts` keeps rate-limit state in an in-process `Map`.
It resets on restart and is not shared across processes/instances, so the public and
admin APIs (and any future scaled instances) don't share limits. `ecosystem.config.json`
runs single-fork today, so this is a scaling limitation, not an immediate bug.
**Where:** `server/src/security.ts`.
**What to do (only if/when scaling):** introduce an optional Redis-backed limiter
behind the same `checkRateLimit`/`checkUserRateLimit` signatures. Use `REDIS_URL`
env; if unset, fall back to the current in-memory implementation so local dev needs
no Redis. Keep the function interfaces identical so call sites don't change.
**Acceptance:** with `REDIS_URL` set, two processes share limits; with it unset,
behavior is exactly as today.

---

## 6. Config & environment hygiene (P2)

### 6.1 Centralize and validate all env vars in one typed module
**Why:** Env vars are read ad-hoc via `process.env.X` across many files
(`ADMIN_SQL_ENABLED`, `CLOUDFLARE_*`, `LOG_LEVEL`, ports, etc.). `config.ts` validates
only some. Easy to typo or forget one.
**Where:** `server/src/config.ts` (extend), all `process.env` call sites.
**What to do:** export a single frozen `env` object from `config.ts` built once at
startup, with explicit parsing/defaults for every variable the app reads (list them
by grepping `process.env`). Replace scattered `process.env.X` reads with `env.X`.
Keep `validateEnv()` as the fail-fast startup gate. Ensure `server/.env.example`
lists every key (it was recently updated — keep it authoritative).
**Acceptance:** `grep -rn "process.env" server/src` shows reads only inside
`config.ts`; booting with a missing required var fails fast with a clear message.

### 6.2 Admin panel: stop storing the admin key in localStorage
**Why:** `admin-panel/src/App.tsx` persists the raw `ADMIN_KEY` in `localStorage`
(lines ~66, ~248, ~447). Any XSS on the admin panel exfiltrates full admin access,
and it persists on shared machines.
**Where:** `admin-panel/src/App.tsx`.
**What to do:** prefer the Cloudflare Access JWT path (already supported by
`admin_auth.ts`) as the primary auth for the deployed panel, so no key is stored
client-side. If a manual key entry must remain for local use, keep it in memory
(React state only) for the session and do **not** write it to `localStorage`; require
re-entry on reload. Document this in `admin-panel/README.md`.
**Acceptance:** `grep -n localStorage admin-panel/src/App.tsx` shows the admin key is
never written to storage.

---

## 7. Frontend architecture & UX (P2)

### 7.1 Decompose `src/App.tsx`
**Why:** ~1300 lines with 36 `useState` hooks in one component. It mixes citizen map,
volunteer portal, report submission, profile, and routing. Hard to test or modify safely.
**Where:** `src/App.tsx`.
**What to do (incremental, do not rewrite in one shot):**
1. Extract the volunteer-portal branch into `src/features/volunteer/VolunteerPortal.tsx`.
2. Extract report-submission logic (geolocation + submit + refresh) into a
   `useReportSubmission()` hook in `src/features/reports/`.
3. Extract data-loading effects (reports, news, MLAs) into `useCivicData()` hook.
4. Move URL/portal detection (`isVolunteerPortal`, query parsing) into
   `src/lib/routing.ts`.
   Do each extraction as its own commit; run the build + smoke check between each.
**Acceptance:** `App.tsx` drops below ~400 lines; behavior unchanged; build + typecheck pass.

### 7.2 Add an ErrorBoundary and real loading/empty states
**Why:** No React ErrorBoundary — a render error white-screens the app. Data fetches
`.catch(console.warn)` and silently show stale/empty UI with no user feedback.
**Where:** `src/main.tsx` (wrap `<App/>`), `src/App.tsx` and components.
**What to do:** add `src/components/ErrorBoundary.tsx` (class component) rendering a
friendly fallback with a reload button; wrap the app. For each major data fetch,
track `loading`/`error` state and render spinners/empty/error UIs instead of silently
swallowing errors.
**Acceptance:** throwing in a child shows the fallback, not a blank page; a failed
`getReports()` shows an error state with retry.

### 7.3 Code-split the map bundle
**Why:** `npm run build` warns that chunks exceed 500 kB; `maplibre-gl` alone is
~1 MB. First paint ships the whole map even for users who never scroll it.
**Where:** `src/App.tsx`/`src/components/MapEngine.tsx`, `vite.config.ts`.
**What to do:** lazy-load `MapEngine` with `React.lazy` + `Suspense`, and/or configure
manual chunks in `vite.config.ts` to split `maplibre-gl`/`mapbox-gl` into their own
chunk. Show a lightweight placeholder while the map chunk loads.
**Acceptance:** build no longer warns about the main chunk; map loads behind a
Suspense fallback.

### 7.4 Fix API base URL fallbacks consistently
**Why:** `src/lib/api.ts` defaults to `http://localhost:6969` (correct now), but
verify `admin-panel` `DEFAULT_API_URL` and `.env.example` (`VITE_API_URL`) all agree
and are documented. Mismatched ports were a real bug before.
**Where:** `src/lib/api.ts`, `admin-panel/src/App.tsx`, `.env.example`.
**What to do:** confirm all three reference the same scheme; document required
`VITE_API_URL` in the root `README.md` setup section.
**Acceptance:** a fresh clone following the README connects to the API with no port edits.

---

## 8. Performance (P3)

### 8.1 Reduce the map-context news-matching cost
**Why:** `/api/map/context` in `server/src/index.ts` does an O(reports × news) JS
nested loop (`Math.sqrt`/`Math.pow`) to attach nearby news to each report. Bounded by
`LIMIT 200/50` today, but it will not scale and runs on every map pan.
**Where:** `server/src/index.ts` `/api/map/context`.
**What to do:** either (a) do the spatial join in SQL with `ST_DWithin` on the
geography columns and a lateral join, returning nearby news per report, or (b) keep
JS but pre-index news into a coarse geohash/grid bucket and only compare within the
same/adjacent buckets. Prefer (a) — Postgres+PostGIS already has GiST indexes on
`location`.
**Acceptance:** the nested `filter`+`Math.sqrt` loop is gone; response shape is
unchanged; map still shows news context on reports.

### 8.2 Cache leaderboard / trending queries
**Why:** `/api/leaderboard/*` and `/api/news/trending` recompute aggregates on every
request; they change slowly.
**Where:** `server/src/index.ts`.
**What to do:** add a tiny in-memory TTL cache (e.g. 60s) keyed by route for these
read-only, non-personalized endpoints. Invalidate naturally by TTL. Keep it simple;
no external cache needed.
**Acceptance:** repeated hits within the TTL don't re-run the SQL (verify via logs).

---

## 9. Data integrity & schema (P2)

### 9.1 Add DB-level constraints that match app assumptions
**Why:** `reports.creator_id` is `TEXT` (stores a Clerk ID) with no FK to `users`.
`agency`/`category` are free text. Orphan/typo data can accumulate.
**Where:** `server/schema.sql`, `server/src/migrate.ts`.
**What to do:** (non-breaking, additive) add `CHECK` constraints or lookup tables
where safe; add an index on `reports.creator_id` (exists) and consider a soft FK via
application logic rather than a hard FK (Clerk IDs may predate the users row). Document
the decision in a comment. Do **not** add a hard FK that could reject valid inserts.
**Acceptance:** migrations run cleanly on an existing DB with data; no insert path breaks.

### 9.2 Make scraper inserts idempotent and race-safe
**Why:** `enhanced_scraper.ts` and `project_scraper.ts` check-then-insert by URL,
which can double-insert under concurrency. `local_news.url` is `UNIQUE`, so rely on
that instead.
**Where:** `server/src/enhanced_scraper.ts`, `server/src/project_scraper.ts`.
**What to do:** replace the `SELECT ... then INSERT` with
`INSERT ... ON CONFLICT (url) DO NOTHING` (news) and an equivalent guard for reports
(`source_url`). Remove the now-redundant pre-select.
**Acceptance:** running a scraper twice back-to-back inserts each item at most once.

---

## 10. Security hardening — backend + admin (P2, defense-in-depth)

> The **critical** auth/identity/SQL-shell fixes are already **done** (see
> `docs/PRODUCTION-READINESS.md`). Everything below is additional hardening. Before
> starting, re-read **Section 1A** — the public/admin isolation model is a hard
> constraint, not a preference.

### 10A. Public API (`server/src/index.ts`, port 6969, Clerk-authed)

- **10A.1 Keep the identity-binding invariant (Section 1A.4).** For every mutating
  route, the actor is `auth.userId` from the verified Clerk token; body identity
  fields are ignored. When adding routes, copy an existing hardened route as the
  template. **Acceptance:** no handler reads `body.userId`/`creatorId`/`clerkId`/
  `submittedBy`/`verifierId` as the trusted actor; a test proves a spoofed body id is ignored.
- **10A.2 Per-route body-size limits.** The global cap is 15 MB (for image uploads).
  JSON routes should reject oversized payloads early — validate `Content-Length` (or
  cap parsed size) on non-upload routes to, say, 32 KB. **Acceptance:** a 1 MB JSON
  POST to `/api/reports/:id/verify` is rejected with 413, not parsed.
- **10A.3 Tighten input validation with Elysia schemas.** Several handlers do manual
  `if (typeof ... )` checks. Prefer the `t.Object({...})` body/params/query schemas
  (already used on some routes) so validation is declarative and consistent, and
  invalid requests are rejected before the handler runs. **Acceptance:** every POST/PUT
  route has a `body` schema; every `:id`/`:constituency` param has a `params` schema.
- **10A.4 CSP violation reporting.** `security.ts` CSP is solid; add a `report-to`/
  `report-uri` directive pointing at a lightweight collector route (or a third-party)
  so real-world violations surface. Re-verify the Clerk/MapLibre/Storj `connect-src`
  and `script-src` domains are the minimal necessary set. **Acceptance:** a blocked
  inline script produces a violation report; no unused domains remain in the CSP.
- **10A.5 Fingerprint/IP trust.** `getClientIP` trusts `x-forwarded-for` /
  `cf-connecting-ip`. That is correct **only** behind the Cloudflare/reverse proxy.
  Document that the app must not be exposed directly (see 10C), and consider taking
  the **last** XFF hop added by your own proxy rather than the first (client-spoofable)
  entry if the topology allows. **Acceptance:** a comment in `security.ts` states the
  trusted-proxy assumption; rate-limit keys can't be trivially spoofed via a forged XFF.
- **10A.6 Storj object lifecycle.** When a report is rejected (`status='rejected'`)
  or removed, delete its uploaded object (`storage` needs a `deleteImage(key)`).
  Images are validated before upload now, so orphans are rarer, but rejected-report
  images still linger. **Acceptance:** rejecting a report with an image removes the
  Storj object; add a test/stub for `deleteImage`.

### 10B. Admin API (`server/src/admin.ts` + `admin_auth.ts`, port 6970, CF-Access/ADMIN_KEY)

- **10B.1 Keep the global guard + audit invariant (Section 1A.2).** All routes except
  `/health` stay behind `verifyAdminAuth` in `onBeforeHandle`, and every action stays
  logged to `admin_audit_log`. Do not add unauthenticated admin routes. **Acceptance:**
  a new admin route with no extra code is already blocked for an unauthenticated caller
  and produces an audit row when authenticated.
- **10B.2 Add rate limiting + security headers to the admin API.** The public API sets
  `securityHeaders` (`onAfterHandle`) and IP rate limiting (`onBeforeHandle`); the
  admin API currently does **neither**. Reuse `security.ts`: apply `securityHeaders`
  and a stricter admin rate limit (it's a small, known set of operators). This adds
  brute-force resistance to the `ADMIN_KEY` fallback and hardens the panel responses.
  **Acceptance:** admin responses carry the security headers; repeated failed
  `x-admin-key` attempts get 429.
- **10B.3 Keep the SQL shell locked down.** It is disabled unless
  `ADMIN_SQL_ENABLED=true`, blocks writes/DDL/DCL/comments/multi-statement, blocks
  `api_key`/`pg_*`/`information_schema`, runs in a `READ ONLY` tx, and scrubs
  secret-looking columns from results (`redactSecretColumns`). **Do not relax any of
  this.** If richer querying is needed, provision a dedicated **read-only Postgres
  role** (see 10B.4) rather than widening the allow-list. **Acceptance:** with
  `ADMIN_SQL_ENABLED` unset the shell 403s; `SELECT api_key FROM ai_models` is refused;
  `SELECT * FROM ai_models` returns `api_key: '[redacted]'`.
- **10B.4 Run the shell/app under a least-privilege DB role.** Document and provide SQL
  for a `fixindia_readonly` role (SELECT-only) that the SQL shell connects as, separate
  from the app's read/write role. This bounds blast radius even if the shell is enabled
  and somehow bypassed. **Acceptance:** `docs/` contains the role-creation SQL; the
  shell path uses a connection restricted to that role (or a documented plan to).
- **10B.5 Never return secrets from admin CRUD.** `GET /api/admin/ai-models` masks
  `api_key` to `••••••••<last4>`. Keep it write-only end-to-end: the panel never
  displays or round-trips full keys. When editing a model, an empty key field means
  "leave unchanged," never "clear." **Acceptance:** the API never emits a full
  `api_key`; editing a model without retyping the key preserves the stored key.
- **10B.6 Harden the PM2 / process-control routes.** `pm2/action/:action/:name`
  already regex-restricts action to `start|stop|restart` and name to
  `fixindia-(api|admin-api)`, and uses `execFile` (no shell). Keep those constraints
  and add an audit detail payload (which process, which action, result). **Acceptance:**
  an invalid action/name is rejected with 400; every PM2 action writes an audit row
  including the target.
- **10B.7 Cloudflare Access JWKS robustness.** `admin_auth.ts` caches JWKS for 1 hour
  and re-fetches on cache miss. Add: (a) a hard timeout on the JWKS fetch, (b) a bounded
  retry, and (c) explicit rejection if `alg`/`kty` are unexpected (only accept the RSA
  keys Cloudflare issues). **Acceptance:** a slow/failed JWKS endpoint fails closed
  (denies) within the timeout rather than hanging the request.
- **10B.8 Admin audit-log retention.** `admin_audit_log` grows unbounded. Add a daily
  cron in `admin.ts` pruning rows older than, e.g., 180 days. **Acceptance:** the prune
  cron exists and is covered by a comment explaining the retention window.

### 10C. Deployment/network boundary (document + checklist; code depends on it)

These are operator controls that the code assumes. Add them as explicit checklist
items anywhere you touch deploy docs (`server/deploy.sh`, `scripts/deploy_to_server.sh`,
`docs/`), and do not assume they're in place — state them:
- **Cloudflare Access enforced** in front of `md.enjoyxd.eu.org` and
  `cr.enjoyxd.eu.org` with an email/SSO allow-list (this is the outer gate; the app's
  `verifyAdminAuth` is the inner gate — defense in depth).
- **Ports 6969/6970 bound to localhost/private iface**, exposed only via the proxy/
  tunnel; not directly dialable on the public IP.
- **Firewall:** only 443 (proxy) and SSH open; deny 6969/6970 from the internet.
- **`ADMIN_KEY` ≥ 32 chars** (enforced in prod by `config.ts`) and rotated per
  `docs/SECRET-ROTATION.md`; prefer Cloudflare Access so the key is break-glass only.
- **TLS everywhere** (HSTS is already emitted by `security.ts` and `public/_headers`).

**Acceptance for Section 10:** each 10A/10B item is implemented or explicitly deferred
with a code comment explaining why; every 10C item appears as a written checklist entry
in the deploy docs.

---

## 11. Developer experience & docs (P3)

- **Root `README.md`:** the "Quick Start" mentions `npm run dev` on :3000 but Vite
  defaults to :5173 and the API to :6969 — reconcile the ports and the `VITE_API_URL`
  step. Add a "Run the full stack locally" section (frontend, public API, admin API,
  Postgres+PostGIS via Docker).
- **Add `docker-compose.yml`** for local Postgres+PostGIS so contributors don't need a
  system install (the README lists Postgres+PostGIS as a prerequisite).
- **Prune committed artifacts:** screenshots (`*.png`) and session `*.md` in the repo
  root are gitignored per `.gitignore` but some are tracked — verify with
  `git ls-files | grep -E '\.png$|SESSION'` and remove tracked build/QA artifacts.
- **Type the `any`s:** many handlers use `(r: any)`. Introduce row types (or generate
  from schema) for the hot query results in `index.ts` to catch shape drift.
- **ESLint on the server:** the root eslint config lints `server/` too and shows only
  "unused eslint-disable" warnings — clean those up by removing the stale
  `/* eslint-disable */` headers where nothing is flagged.

---

## 12. Verification commands (run after every change)

```bash
# Frontend
npm run build          # must succeed (Vite)
npx tsc -b --noEmit    # must be clean
npm run lint           # must be 0 errors (warnings for stale eslint-disable are ok)
npm test               # once Section 2 is done — must pass

# Backend (from server/)
cd server
bun build src/index.ts --target=bun --outfile=/dev/null   # public API — must bundle clean
bun build src/admin.ts --target=bun --outfile=/dev/null   # admin API — must bundle clean
bun test               # once Section 2 is done — must pass

# Admin panel SPA (from admin-panel/)
cd ../admin-panel
npm run build          # must succeed
```

**Security-specific manual checks (run in a normal environment / post-deploy):**
- Admin API rejects a request with no `cf-access-jwt-assertion` and no `x-admin-key` → 401.
- Admin SQL shell with `ADMIN_SQL_ENABLED` unset → 403; `SELECT api_key FROM ai_models` → 403;
  `SELECT * FROM ai_models` → `api_key` shows `[redacted]`.
- Public API: a POST with a spoofed body `userId`/`creatorId` does not act as that user
  (identity comes from the Clerk token).
- CORS: the admin panel origin is **not** accepted by the public API, and a public origin
  is **not** accepted by the admin API.

**Environment note:** the sandbox used to prepare this cannot open listening sockets,
so live HTTP tests must be run in a normal environment or post-deploy. Bundle checks,
typecheck, lint, and pure-function unit tests are the reliable local gates here.

---

## 13. Suggested order of execution

0. **Read Section 1A first** and treat the public/admin isolation as a hard constraint
   throughout every task below.
1. **Section 2** (tests) — unlocks safe iteration on everything else. Include the
   auth/identity-binding tests (10A.1) and an admin-guard test (10B.1) in this first pass.
2. **Section 10B + 10C** (admin API hardening + deployment boundary) — highest security
   value: add security headers + rate limiting to the admin API (10B.2), keep the SQL
   shell locked (10B.3), least-privilege DB role (10B.4), CF-Access JWKS robustness
   (10B.7), audit retention (10B.8), and write the 10C network checklist.
3. **Section 6.2** (admin key out of localStorage) and **Section 10A** (public-API
   body-size limits, schema validation, CSP reporting, Storj cleanup).
4. **Section 3** (reliability: error handling, readiness, graceful shutdown, CI/PM2 fix,
   migration consolidation) and **Section 9.2** (idempotent scrapers).
5. **Section 4** (logging) and **Section 6.1** (env centralization).
6. **Section 7** (frontend decomposition + ErrorBoundary + code-split).
7. **Sections 8, 9.1, 11** (performance, DB constraints, DX polish) as time allows.
8. **Section 5** (Redis rate limiting) only when horizontal scaling is actually needed.

Each numbered task is independently shippable. Do them one at a time, run Section 12
after each, and keep changes small and reviewable. **Never** weaken the public/admin
isolation (Section 1A) to make a task easier — if a change seems to require it, stop
and reconsider the approach.
