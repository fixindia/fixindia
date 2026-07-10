-- FixIndia.org Database Schema
-- PostgreSQL 14+ with PostGIS extension

-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- ─── Users Table ────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_id TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Citizen Hero',
  job_title TEXT,
  socials JSONB DEFAULT '{}',
  avatar_url TEXT,
  email TEXT,
  reports_published INTEGER DEFAULT 0,
  reports_verified INTEGER DEFAULT 0,
  integrations_helped INTEGER DEFAULT 0,
  trust_score INTEGER DEFAULT 0,
  home_constituency TEXT,
  home_city TEXT,
  home_state TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Wards Table (Administrative Boundaries) ───
CREATE TABLE IF NOT EXISTS wards (
  id SERIAL PRIMARY KEY,
  ward_name TEXT NOT NULL,
  ward_number INTEGER,
  mla_name TEXT,
  mla_party TEXT,
  mla_contact TEXT,
  constituency TEXT,
  city TEXT,
  sanctioned_budget NUMERIC(12, 2),
  zone TEXT,
  parliamentary_constituency TEXT,
  mp_name TEXT,
  -- Nullable so scraped/seeded rows without geometry can still be inserted;
  -- seed.ts passes NULL boundaries for wards lacking WKB data.
  boundaries GEOGRAPHY(MULTIPOLYGON, 4326),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- seed.ts upserts with ON CONFLICT (ward_number); it needs a matching unique index.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_wards_ward_number
  ON wards(ward_number)
  WHERE ward_number IS NOT NULL;

-- ─── Reports Table ─────────────────────────────
-- NOTE on reports.creator_id (9.1): it is TEXT storing a Clerk ID ("user_...")
-- and intentionally has NO hard foreign key to users(id). Clerk IDs may exist
-- before a matching users row is created (a user can submit a report before
-- their profile is synced via /api/users/sync), so a hard FK would reject
-- valid inserts. Instead, the application keys updates on users.clerk_id
-- (a soft FK), and idx_reports_creator_id (below) keeps those lookups fast.
-- Do NOT add a hard FK here without first guaranteeing a users row exists for
-- every report insert — that would break the report-then-sync flow.
CREATE TABLE IF NOT EXISTS reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  custom_category TEXT,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  status TEXT DEFAULT 'pending_verification' CHECK (status IN ('pending_verification', 'open', 'in_progress', 'resolved', 'rejected')),
  severity TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  agency TEXT,
  ward_name TEXT,
  mla_name TEXT,
  sanctioned_budget TEXT,
  zone TEXT,
  parliamentary_constituency TEXT,
  mp_name TEXT,
  upvotes INTEGER DEFAULT 0,
  verification_count INTEGER DEFAULT 0,
  creator_id TEXT,
  image_url TEXT,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Local News Table ──────────────────────────
CREATE TABLE IF NOT EXISTS local_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  headline TEXT NOT NULL,
  url TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL,
  snippet TEXT,
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  city TEXT,
  is_tragic BOOLEAN DEFAULT FALSE,
  confidence_score INTEGER DEFAULT 0,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── MLAs Table (Multi-City Support) ───────────
CREATE TABLE IF NOT EXISTS mlas (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  party TEXT,
  constituency TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  is_incorrect BOOLEAN DEFAULT FALSE,
  latitude NUMERIC(9,6),
  longitude NUMERIC(9,6),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name, constituency)
);

-- ─── Pending Verifications Table ───────────────
CREATE TABLE IF NOT EXISTS pending_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  data_type TEXT NOT NULL CHECK (data_type IN ('report', 'news', 'mla')),
  raw_data JSONB NOT NULL,
  submitted_by TEXT NOT NULL,
  submitter_email TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  verification_count INTEGER DEFAULT 0,
  required_verifications INTEGER DEFAULT 3,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Volunteer Verifications Table ─────────────
CREATE TABLE IF NOT EXISTS volunteer_verifications (
  id SERIAL PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES pending_verifications(id) ON DELETE CASCADE,
  verifier_id TEXT NOT NULL,
  approved BOOLEAN NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(submission_id, verifier_id)
);

-- ─── Upvotes Table (Prevent Duplicate Votes) ───
CREATE TABLE IF NOT EXISTS upvotes (
  id SERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, user_id)
);

-- ─── Verifications Table ───────────────────────
CREATE TABLE IF NOT EXISTS verifications (
  id SERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  verifier_id TEXT NOT NULL,
  is_valid BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, verifier_id)
);

-- ═══════════════════════════════════════════════
-- INDEXES FOR PERFORMANCE (CRITICAL!)
-- ═══════════════════════════════════════════════

-- ─── Spatial Indexes (MOST IMPORTANT) ──────────
CREATE INDEX IF NOT EXISTS idx_reports_location ON reports USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_news_location ON local_news USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_wards_boundaries ON wards USING GIST(boundaries);

-- ─── Reports Indexes ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_creator_id ON reports(creator_id) WHERE creator_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_mla_name ON reports(mla_name) WHERE mla_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reports_ward_name ON reports(ward_name) WHERE ward_name IS NOT NULL;

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);

-- Unique index on source_url so the project scraper can use
-- INSERT ... ON CONFLICT (source_url) DO NOTHING (idempotent, race-safe).
-- Partial: user-submitted reports have NULL source_url and are excluded.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reports_source_url
  ON reports(source_url)
  WHERE source_url IS NOT NULL;

-- ─── News Indexes ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_news_url ON local_news(url);
CREATE INDEX IF NOT EXISTS idx_news_published_at ON local_news(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_confidence ON local_news(confidence_score) WHERE confidence_score >= 40;

-- ─── User Indexes ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_id) WHERE clerk_id IS NOT NULL;

-- ─── Upvotes/Verifications Indexes ──────────────
CREATE INDEX IF NOT EXISTS idx_upvotes_report_id ON upvotes(report_id);
CREATE INDEX IF NOT EXISTS idx_verifications_report_id ON verifications(report_id);

-- ─── MLAs Indexes ───────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mlas_city ON mlas(city);
CREATE INDEX IF NOT EXISTS idx_mlas_state ON mlas(state);
CREATE INDEX IF NOT EXISTS idx_mlas_constituency ON mlas(constituency);

-- ─── News City Index ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_news_city ON local_news(city) WHERE city IS NOT NULL;

-- ─── Pending Verifications Indexes ─────────────
CREATE INDEX IF NOT EXISTS idx_pending_verifications_status ON pending_verifications(status);
CREATE INDEX IF NOT EXISTS idx_pending_verifications_type ON pending_verifications(data_type);
CREATE INDEX IF NOT EXISTS idx_volunteer_verifications_submission ON volunteer_verifications(submission_id);

-- ─── AI Models Configuration Table ──────────────
CREATE TABLE IF NOT EXISTS ai_models (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (provider IN ('Groq', 'OpenRouter', 'OpenAI', 'Gemini', 'Anthropic')),
  model_string TEXT NOT NULL,
  api_key TEXT,
  api_key_env_var TEXT NOT NULL,
  api_endpoint TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_free BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_models_priority ON ai_models(priority) WHERE is_enabled = TRUE;

-- Vision capability flag (Track 3 — AI photo analysis). migrate.ts also adds
-- this idempotently for already-provisioned DBs and seeds a Groq vision model.
ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS is_vision BOOLEAN NOT NULL DEFAULT FALSE;

-- ═══════════════════════════════════════════════
-- ACCOUNTABILITY LOOP + ENGAGEMENT TABLES
-- ═══════════════════════════════════════════════

-- ─── Resolutions (consensus "is it fixed?" votes) ──
-- Mirrors `verifications`: one upsertable vote per (report, user). 'working'
-- votes move open→in_progress (quorum 2); 'fixed' votes move
-- open/in_progress→resolved (consensus 3). See POST /api/reports/:id/resolve.
CREATE TABLE IF NOT EXISTS resolutions (
  id SERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('working', 'fixed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(report_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_resolutions_report_id ON resolutions(report_id);

-- ─── Report status-transition log (timeline + notification source) ──
CREATE TABLE IF NOT EXISTS report_status_events (
  id SERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  actor_id TEXT,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_status_events_report ON report_status_events(report_id, created_at DESC);

-- ─── In-app notifications (Track 4) ──
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- ─── Escalation log (Track 2 — complaint filed against a report) ──
CREATE TABLE IF NOT EXISTS escalations (
  id SERIAL PRIMARY KEY,
  report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  channel TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_escalations_report ON escalations(report_id);

