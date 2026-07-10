# FixIndia.org — Production Readiness Report

Status of the exhaustive hardening pass. Grouped by severity. Every code item
below is **done** in this branch; the "Manual / operator" section lists what only
you can do (rotate secrets, provision DB roles, deploy).

---

## ✅ Critical — fixed

| # | Issue | Fix |
|---|-------|-----|
| C1 | **Vote / point fraud & IDOR via body-supplied identity.** `upvote`, `verify`, report submit, `users/sync`, and `volunteer/submit` trusted a client `userId`/`creatorId`/`clerkId`. | All identity now derives from the **verified Clerk token** (`auth.userId`). Body fields kept optional for back-compat but ignored. `server/src/index.ts` |
| C2 | **Single vote could resolve/reject any report.** One `isValid:false` set status to `resolved`. | Consensus model: status only changes at **3 concurring votes**; counts recomputed from the `verifications` table inside a transaction; invalid consensus → `rejected`, never destructive `resolved`. Self-verification blocked. |
| C3 | **Points never awarded** (and award path spoofable). `UPDATE users … WHERE id = <clerkId>` compared a Clerk ID to a UUID column. | All stat/point updates now key on `clerk_id`. |
| C4 | **Legacy `PUT /api/users/:id` had no ownership check** (IDOR: overwrite any profile by UUID). | Legacy UUID user routes (`POST/PUT/GET /api/users/:id`) **removed**; all profile access goes through the ownership-checked Clerk routes. Client methods removed too. |
| C5 | **Admin SQL shell could exfiltrate secrets** (`SELECT api_key FROM ai_models`, dump PII, hit system catalogs). | Now **disabled unless `ADMIN_SQL_ENABLED=true`**, blocks comments/multi-statement/`api_key`/`pg_*`/`information_schema`, and scrubs secret-looking columns from results. `server/src/admin.ts` |
| C6 | **Live secrets + SSH private key in working tree.** | Code/docs hardened; `deploy_to_server.sh` no longer echoes `ADMIN_KEY` or hardcodes the DB password. Rotation is operator-only → `docs/SECRET-ROTATION.md`. |

## ✅ High / correctness — fixed

- **PII leak:** non-owners no longer receive `email` or `home_constituency/city/state` from the Clerk user route.
- **Broken auth on reads:** `getUserByClerkId` / `getVolunteersByConstituency` now send the bearer token (were always 401-ing).
- **Fabricated engagement:** `project_scraper.ts` no longer seeds `upvotes`/`verification_count` with `Math.random()` — starts at 0.
- **Mislocated markers:** news geocoder no longer defaults missing coords to Bengaluru center; out-of-India / missing coords are dropped.
- **Migration race:** both API processes ran `ALTER/CREATE` on boot; consolidated into `server/src/migrate.ts` behind a Postgres advisory lock.
- **Schema/seed mismatch:** `wards` gains `constituency`, `city`, and a `UNIQUE(ward_number)` index so `seed.ts` upserts work; `boundaries` made nullable.
- **Destructive script:** `clearDB.ts` fixed table name (`local_news`) and guarded (`CONFIRM_CLEAR=yes`, refuses in production).
- **MLA flag abuse:** per-user rate limit + input validation on `mlas/:id/flag` and `flag-by-name` (placeholder-MLA spam vector).
- **Orphaned uploads:** report metadata is validated **before** the Storj upload.
- **Atomicity:** upvote and verify mutations run in transactions.

## ✅ Low / polish — fixed

- Frontend default API base `localhost:4000` → `localhost:6969` (matched the server).
- Build-blocking TS error in `FullscreenLogin` (`routing="virtual"`) fixed via the auth-provider type.
- `public/robots.txt` added; `public/_headers` gains security headers (X-Frame-Options, nosniff, HSTS, Permissions-Policy) for the Pages-served SPA.
- `server/.env.example` now documents every consumed variable (`OPENROUTER_API_KEYS`, `CLOUDFLARE_TEAM_DOMAIN`, `CLOUDFLARE_AUD`, `ADMIN_SQL_ENABLED`, ports).

## Verification performed

- `npm run build` (frontend) → ✅ builds.
- `tsc -b --noEmit` (frontend) → ✅ no errors.
- `npm run lint` → ✅ 0 errors (18 pre-existing unused-disable warnings only).
- `bun build` on `index.ts`, `admin.ts`, and all changed server modules → ✅ bundles clean.

---

## ⚠️ Manual / operator steps (only you can do)

1. **Rotate every secret and the SSH key** — see `docs/SECRET-ROTATION.md`. The
   leaked values remain valid until you rotate them; code changes do not un-leak them.
2. **Provision a read-only Postgres role** if you intend to use the admin SQL
   shell, then set `ADMIN_SQL_ENABLED=true` only on the admin process.
3. **Deploy**: I did not SSH or deploy. When ready, run `scripts/deploy_to_server.sh`
   (now hardened) or `server/deploy.sh`, then health-check `:6969/health` and `:6970/health`.
4. **Set `NODE_ENV=production`** on the server so strict env checks and prod CORS apply.

## Known limitations (future work, not blocking)

- Rate limiting is in-memory per process (resets on restart, not shared across
  instances). Fine for a single PM2 fork; move to Redis if you scale horizontally.
- No automated test suite yet; verification above is build/type/lint + manual review.
- Map-context news matching is O(reports×news) in JS (bounded by LIMITs); revisit if limits grow.
