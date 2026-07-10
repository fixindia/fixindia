/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Idempotent schema migrations, run on startup.
 *
 * Both the public API (index.ts) and the admin API (admin.ts) call this. They
 * are separate PM2 processes that start at the same time, so every DDL statement
 * here MUST be idempotent (IF NOT EXISTS) AND the whole run is serialized behind
 * a Postgres advisory lock so the two processes never race each other on the
 * same CREATE/ALTER.
 */
import sql from './db';

// Arbitrary but fixed lock key for this app's migration section.
const MIGRATION_LOCK_KEY = 428914771;

export async function runMigrations(): Promise<void> {
  // pg_advisory_xact_lock is released automatically when the transaction ends.
  await sql.begin(async (tx: any) => {
    await tx`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;

    // ── reports / users / mlas column top-ups ──
    await tx`
      ALTER TABLE mlas
      ADD COLUMN IF NOT EXISTS is_incorrect BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
      ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6)
    `;
    await tx`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS home_constituency TEXT,
      ADD COLUMN IF NOT EXISTS home_city TEXT,
      ADD COLUMN IF NOT EXISTS home_state TEXT
    `;
    // Folded in from the deleted migrate_image_url.ts: image_url on reports.
    // schema.sql already declares it, so fresh installs and migrated DBs match.
    await tx`ALTER TABLE reports ADD COLUMN IF NOT EXISTS image_url TEXT`;

    // ── reports.source_url uniqueness (9.2 idempotent scrapers) ──
    // Scraped reports carry a source_url; making it unique lets the project
    // scraper use INSERT ... ON CONFLICT (source_url) DO NOTHING so concurrent
    // runs can't double-insert. First drop any existing duplicate rows (keeping
    // the oldest per url) so the unique index can be created cleanly. User-
    // submitted reports have source_url = NULL and are excluded by the partial
    // index, so they are never affected.
    await tx`
      DELETE FROM reports a
      USING reports b
      WHERE a.source_url = b.source_url
        AND a.source_url IS NOT NULL
        AND a.created_at > b.created_at
    `;
    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_reports_source_url
      ON reports(source_url)
      WHERE source_url IS NOT NULL
    `;

    // ── wards: columns + unique constraint required by seed.ts ──
    await tx`ALTER TABLE wards ADD COLUMN IF NOT EXISTS constituency TEXT`;
    await tx`ALTER TABLE wards ADD COLUMN IF NOT EXISTS city TEXT`;
    // seed.ts uses ON CONFLICT (ward_number); ensure a matching unique index.
    await tx`
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_wards_ward_number
      ON wards(ward_number)
      WHERE ward_number IS NOT NULL
    `;

    // ── ai_models table + seed ──
    await tx`
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
      )
    `;
    await tx`
      CREATE INDEX IF NOT EXISTS idx_ai_models_priority ON ai_models(priority) WHERE is_enabled = TRUE
    `;

    const countRes = await tx`SELECT COUNT(*)::integer AS count FROM ai_models`;
    if (countRes[0] && countRes[0].count === 0) {
      await tx`
        INSERT INTO ai_models (name, provider, model_string, api_key_env_var, api_endpoint, priority, is_enabled, is_free)
        VALUES
          ('Groq Llama 3.3 70B', 'Groq', 'llama-3.3-70b-versatile', 'GROQ_API_KEYS', 'https://api.groq.com/openai/v1/chat/completions', 1, TRUE, TRUE),
          ('OpenRouter Llama 3.3 70B', 'OpenRouter', 'meta-llama/llama-3.3-70b-instruct:free', 'OPENROUTER_API_KEYS', 'https://openrouter.ai/api/v1/chat/completions', 2, TRUE, TRUE),
          ('OpenRouter Gemini 2.5 Flash', 'OpenRouter', 'google/gemini-2.5-flash:free', 'OPENROUTER_API_KEYS', 'https://openrouter.ai/api/v1/chat/completions', 3, TRUE, TRUE)
        ON CONFLICT (name) DO NOTHING
      `;
      console.log('✓ Seeded default AI models.');
    }

    // ── admin operational tables ──
    await tx`
      CREATE TABLE IF NOT EXISTS scraper_runs (
        id SERIAL PRIMARY KEY,
        scraper_type TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
        items_processed INTEGER DEFAULT 0,
        error_message TEXT,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      )
    `;
    await tx`
      CREATE TABLE IF NOT EXISTS admin_audit_log (
        id SERIAL PRIMARY KEY,
        admin_email TEXT NOT NULL,
        action TEXT NOT NULL,
        details JSONB,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await tx`
      CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC)
    `;

    // ── Resolution lifecycle (closes the accountability loop) ──
    // Consensus "is it fixed?" votes, mirroring the `verifications` table.
    // One row per (report, user), upserted: a user's latest assessment wins.
    // 'working' votes drive open→in_progress (quorum 2); 'fixed' votes drive
    // open/in_progress→resolved (consensus 3). See POST /api/reports/:id/resolve.
    await tx`
      CREATE TABLE IF NOT EXISTS resolutions (
        id SERIAL PRIMARY KEY,
        report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        vote TEXT NOT NULL CHECK (vote IN ('working', 'fixed')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(report_id, user_id)
      )
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_resolutions_report_id ON resolutions(report_id)`;

    // Append-only status-transition log → powers the My-Issues timeline and
    // is the source that notifications are generated from.
    await tx`
      CREATE TABLE IF NOT EXISTS report_status_events (
        id SERIAL PRIMARY KEY,
        report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        actor_id TEXT,
        from_status TEXT,
        to_status TEXT NOT NULL,
        note TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_status_events_report ON report_status_events(report_id, created_at DESC)`;

    // In-app notifications (Track 4). user_id is a Clerk ID.
    await tx`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        report_id UUID REFERENCES reports(id) ON DELETE CASCADE,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC)`;

    // Escalation log (Track 2) — counts citizens who filed a complaint on a
    // report, feeding "pressure" metrics. No PII beyond the actor's Clerk ID.
    await tx`
      CREATE TABLE IF NOT EXISTS escalations (
        id SERIAL PRIMARY KEY,
        report_id UUID NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        channel TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await tx`CREATE INDEX IF NOT EXISTS idx_escalations_report ON escalations(report_id)`;

    // ── AI vision support (Track 3) ──
    // Flag models that can accept images (multimodal). queryVision() selects
    // is_vision = TRUE rows. Idempotent column add + seed one Groq vision model.
    await tx`ALTER TABLE ai_models ADD COLUMN IF NOT EXISTS is_vision BOOLEAN NOT NULL DEFAULT FALSE`;
    const visionCount = await tx`SELECT COUNT(*)::integer AS count FROM ai_models WHERE is_vision = TRUE`;
    if (visionCount[0] && visionCount[0].count === 0) {
      await tx`
        INSERT INTO ai_models (name, provider, model_string, api_key_env_var, api_endpoint, priority, is_enabled, is_free, is_vision)
        VALUES
          ('Groq Llama 4 Scout (vision)', 'Groq', 'meta-llama/llama-4-scout-17b-16e-instruct', 'GROQ_API_KEYS', 'https://api.groq.com/openai/v1/chat/completions', 1, TRUE, TRUE, TRUE)
        ON CONFLICT (name) DO NOTHING
      `;
      console.log('✓ Seeded default vision model.');
    }
  });
}
