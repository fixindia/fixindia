-- FixIndia — least-privilege read-only DB role (10B.4)
--
-- The admin SQL shell (server/src/admin.ts, /api/admin/db/query) is disabled by
-- default and already locked down: READ ONLY transaction, no writes/DDL/DCL,
-- no system catalogs, secret columns redacted. As defense-in-depth, provision a
-- dedicated read-only role and point the shell at it so even a bypass is
-- bounded to SELECTs on application tables.
--
-- Run once as a Postgres superuser:
--   psql "$DATABASE_URL" -f docs/readonly-db-role.sql
--
-- Then set the shell's connection to this role (e.g. a separate DATABASE_URL
-- variant like READONLY_DATABASE_URL wired into admin.ts when ADMIN_SQL_ENABLED
-- is true). The app's normal read/write role stays separate.

-- 1. Create the role (no login by default; grant login only if connecting over
--    the network — prefer a local peer-mapped role).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fixindia_readonly') THEN
    CREATE ROLE fixindia_readonly LOGIN PASSWORD 'CHANGE_ME_STRONG_PASSWORD';
  END IF;
END$$;

-- 2. Connect to the application database and grant schema + table access.
--    (Run this connected to the fixindia database, not the maintenance DB.)
GRANT USAGE ON SCHEMA public TO fixindia_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fixindia_readonly;

-- 3. Keep the grant current for future tables.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO fixindia_readonly;

-- 4. Explicitly deny access to the secrets-bearing table's key column.
--    (The app already redacts api_key, but this is the DB-level guarantee.)
REVOKE ALL ON ai_models FROM fixindia_readonly;
GRANT SELECT (id, name, provider, model_string, api_key_env_var, api_endpoint, priority, is_enabled, is_free, created_at, updated_at) ON ai_models TO fixindia_readonly;

-- 5. No access to Postgres system catalogs that expose credentials/config.
--    (The role has no explicit grants on pg_catalog/information_schema beyond
--    what PUBLIC has; revoke the sensitive bits to be explicit.)
REVOKE SELECT ON pg_authid FROM PUBLIC;
REVOKE SELECT ON pg_shadow FROM PUBLIC;
REVOKE SELECT ON pg_user FROM PUBLIC;
