# FixIndia — Deployment & Network Boundary Checklist

The application code assumes a specific network/deployment topology. These are
**operator controls that live outside the code** but the code's security model
depends on them. Every deploy MUST confirm each item below. (See
`docs/PRODUCTION-READINESS.md` for the already-completed app-layer hardening.)

## 1. Two-service isolation (hard constraint — see `implementation.md` §1A)

The public API (`server/src/index.ts`, port **6969**) and the admin API
(`server/src/admin.ts`, port **6970**) are **two separate processes with two
different auth systems and two disjoint CORS allow-lists**. Never merge them,
never share routes, never loosen either CORS list to a wildcard.

| | Public API | Admin API |
|---|---|---|
| Port | 6969 | 6970 |
| Public domain | `api.enjoyxd.eu.org` | `cr.enjoyxd.eu.org` (API) / `md.enjoyxd.eu.org` (panel) |
| PM2 process | `fixindia-api` | `fixindia-admin-api` |
| Auth | Clerk JWT | Cloudflare Access JWT **or** `ADMIN_KEY` |
| CORS allow-list | `PROD_ORIGINS` in `index.ts` | `ALLOWED_ADMIN_ORIGINS` in `admin.ts` (only `md.enjoyxd.eu.org` in prod) |

## 2. Network exposure

- [ ] **Ports 6969 and 6970 are bound to localhost / private interface** and
      exposed ONLY via the Cloudflare proxy/tunnel. They must NOT be directly
      dialable on the VM's public IP.
- [ ] **Firewall:** only **443** (proxy) and **SSH** are open on the VM.
      `6969`/`6970` are denied from the internet.
- [ ] **Cloudflare Access is enforced** in front of `md.enjoyxd.eu.org` AND
      `cr.enjoyxd.eu.org` with an email/SSO allow-list. This is the **outer
      gate**; the app's `verifyAdminAuth` is the **inner gate** — defense in
      depth. The admin API must not be reachable by the open internet even
      before app-layer auth.
- [ ] The public API (`api.enjoyxd.eu.org`) sits behind the reverse proxy for
      `api.enjoyxd.eu.org`; its origin is the only public origin.

## 3. Secrets & credentials

- [ ] **`ADMIN_KEY` is ≥ 32 chars** (enforced by `config.ts` in production) and
      generated with `openssl rand -hex 32`. Rotated per
      `docs/SECRET-ROTATION.md`.
- [ ] **Prefer Cloudflare Access** so `ADMIN_KEY` is break-glass only. The admin
      panel never persists the key to `localStorage` (see `admin-panel/README.md`).
- [ ] `CLERK_SECRET_KEY`, Storj keys, and Groq/OpenRouter keys are set in
      `server/.env` on the VM (never committed; `.env` is gitignored).
- [ ] `ADMIN_SQL_ENABLED` is **unset** in normal operation (the SQL shell is
      disabled by default).

## 4. TLS & headers

- [ ] **TLS everywhere.** HSTS is emitted by `security.ts` and `public/_headers`.
- [ ] Security headers (CSP, X-Frame-Options, HSTS, etc.) are emitted by both
      the public and admin APIs via `onAfterHandle`.

## 5. Process management

- [ ] Both processes are managed by **PM2** via `ecosystem.config.json`.
      After deploy, `pm2 list` shows `fixindia-api` AND `fixindia-admin-api`
      online.
- [ ] `server/deploy.sh` runs the readiness check against `/health/ready`
      (verifies the DB), not just the liveness-only `/health`.
- [ ] Graceful shutdown: both processes handle SIGTERM/SIGINT (drain DB pool,
      exit within ~5s) so PM2 reloads don't drop in-flight requests.

## 6. Database

- [ ] PostgreSQL 14+ with **PostGIS** extension.
- [ ] `schema.sql` is applied on fresh installs; `migrate.ts` runs idempotently
      on every startup (advisory-locked so both processes don't race).
- [ ] **Least-privilege read-only role** for the SQL shell (see
      `docs/readonly-db-role.sql`). The app's read/write role is separate.
- [ ] Backups are configured (out of scope for this repo, but required for prod).

## 7. Post-deploy manual security checks

- Admin API rejects a request with no `cf-access-jwt-assertion` and no
  `x-admin-key` → **401**.
- Admin SQL shell with `ADMIN_SQL_ENABLED` unset → **403**;
  `SELECT api_key FROM ai_models` → **403**;
  `SELECT * FROM ai_models` → `api_key` shows `[redacted]`.
- Public API: a POST with a spoofed body `userId`/`creatorId` does **not** act
  as that user (identity comes from the Clerk token).
- CORS: the admin panel origin is **not** accepted by the public API, and a
  public origin is **not** accepted by the admin API.
