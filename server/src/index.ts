/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment */
import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { timingSafeEqual, createHash } from 'node:crypto';
import sql from './db';
import { storage } from './lib/storage';
import { runProjectScraper } from './project_scraper';
import { runEnhancedNewsScraper } from './enhanced_scraper';
import { runMultiCityMLAScraper } from './multi_city_mla_scraper';
import { submitVolunteerData, getPendingSubmissions, verifySubmission } from './volunteer_system';
import { securityHeaders, generateFingerprint, checkRateLimit, checkUserRateLimit, sanitizeInput, sanitizeTitle, validateImageMagicBytes } from './security';
import { verifyAuth, requireAuth, requireOwnership } from './auth';
import cron from 'node-cron';
import { validateEnv } from './config';
import { SCRAPING_SCHEDULE } from './config/cities';

// Validate environment variables on startup
validateEnv();

// Run database migrations on startup
try {
  console.log('🔄 Running database migrations...');
  await sql`
    ALTER TABLE mlas 
    ADD COLUMN IF NOT EXISTS is_incorrect BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS latitude NUMERIC(9,6),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6)
  `;
  await sql`
    ALTER TABLE users 
    ADD COLUMN IF NOT EXISTS home_constituency TEXT,
    ADD COLUMN IF NOT EXISTS home_city TEXT,
    ADD COLUMN IF NOT EXISTS home_state TEXT
  `;
  await sql`
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
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_models_priority ON ai_models(priority) WHERE is_enabled = TRUE
  `;

  // Seed default models if table is empty
  const countRes = await sql`SELECT COUNT(*)::integer FROM ai_models`;
  if (countRes[0] && countRes[0].count === 0) {
    await sql`
      INSERT INTO ai_models (name, provider, model_string, api_key_env_var, api_endpoint, priority, is_enabled, is_free)
      VALUES 
        ('Groq Llama 3.3 70B', 'Groq', 'llama-3.3-70b-versatile', 'GROQ_API_KEYS', 'https://api.groq.com/openai/v1/chat/completions', 1, TRUE, TRUE),
        ('OpenRouter Llama 3.3 70B', 'OpenRouter', 'meta-llama/llama-3.3-70b-instruct:free', 'OPENROUTER_API_KEYS', 'https://openrouter.ai/api/v1/chat/completions', 2, TRUE, TRUE),
        ('OpenRouter Gemini 2.5 Flash', 'OpenRouter', 'google/gemini-2.5-flash:free', 'OPENROUTER_API_KEYS', 'https://openrouter.ai/api/v1/chat/completions', 3, TRUE, TRUE)
    `;
    console.log('✓ Seeded default AI models.');
  }
  console.log('✓ Database migrations complete.');
} catch (err) {
  console.error('❌ Database migration failed:', err);
}

// ─── Security: In-memory rate limiter ──────────
// Now using enhanced fingerprinting from security.ts

// Admin key for sensitive operations
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_KEY environment variable is not set');
  }
  console.warn('⚠️  ADMIN_KEY not set. Admin endpoints will be disabled.');
}

// Constant-time string comparison to prevent timing attacks
function constantTimeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  
  // SECURITY: Hash inputs first to normalize lengths and prevent
  // length-based timing side-channels
  const aHash = createHash('sha256').update(a).digest();
  const bHash = createHash('sha256').update(b).digest();
  return timingSafeEqual(aHash, bHash);
}

// Admin authentication middleware
function requireAdmin(adminKey: string | null): boolean {
  if (!ADMIN_KEY) return false;
  if (!adminKey) return false;
  return constantTimeCompare(adminKey, ADMIN_KEY);
}

// Allowed frontend origins (strict matching)
// SECURITY: Only include localhost origins in development mode
const PROD_ORIGINS = [
  'https://fixindia.org',
  'https://www.fixindia.org',
  'https://fixindia.pages.dev',
  'https://help.fixindia.org',
  'https://fixindia-volunteer.pages.dev',
  'https://builder.fixindia.org',
];

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://help.localhost:5173',
];

const ALLOWED_ORIGINS = process.env.NODE_ENV === 'production'
  ? PROD_ORIGINS
  : [...PROD_ORIGINS, ...DEV_ORIGINS];

const app = new Elysia({
  serve: {
    // Limit request body to 15MB (10MB image + metadata headroom)
    maxRequestBodySize: 1024 * 1024 * 15,
  }
})
  .use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST', 'PUT'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
    credentials: true,
  }))

  // ─── Security Headers ────────────────────────
  .onAfterHandle(({ set }) => {
    Object.entries(securityHeaders).forEach(([key, value]) => {
      set.headers[key] = value;
    });
    // Note: Vary: Origin is automatically set by @elysiajs/cors middleware
  })

  // ─── Enhanced Rate Limiting with Fingerprinting ───
  .onBeforeHandle(({ request, set }) => {
    const fingerprint = generateFingerprint(request);
    const isWrite = request.method === 'POST' || request.method === 'PUT';
    const limit = isWrite ? 30 : 120;

    const result = checkRateLimit(fingerprint, limit, 60_000);

    if (!result.allowed) {
      set.status = 429;
      set.headers['Retry-After'] = String(result.retryAfter || 60);
      return { error: 'Too many requests. Slow down.', retryAfter: result.retryAfter };
    }
  })

  // ─── Health Check ────────────────────────────
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // ─── Map Context: Bounding Box Query ─────────
  .get('/api/map/context', async ({ query }) => {
    const { west, south, east, north } = query;

    const w = parseFloat(west as string);
    const s = parseFloat(south as string);
    const e = parseFloat(east as string);
    const n = parseFloat(north as string);

    if (isNaN(w) || isNaN(s) || isNaN(e) || isNaN(n)) {
      return { error: 'Invalid bounds. Provide west, south, east, north.' };
    }

    // Sanity check bounds (prevent absurdly large queries)
    if (Math.abs(e - w) > 5 || Math.abs(n - s) > 5) {
      return { error: 'Bounding box too large. Max 5 degrees.' };
    }

    const reports = await sql`
      SELECT 
        id, title, category, custom_category, status, severity,
        agency, ward_name, mla_name, sanctioned_budget,
        upvotes, verification_count,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        created_at, creator_id,
        zone, parliamentary_constituency, mp_name,
        image_url, source_url
      FROM reports
      WHERE ST_Intersects(
        location,
        ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography
      )
      ORDER BY created_at DESC
      LIMIT 200
    `;

    const news = await sql`
      SELECT
        id, headline, url, source, snippet, is_tragic,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        published_at, confidence_score
      FROM local_news
      WHERE ST_Intersects(
        location,
        ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography
      )
      AND confidence_score >= 50
      ORDER BY published_at DESC
      LIMIT 50
    `;

    const filteredNews = news.map((n: any) => ({
      ...n,
      lat: n.latitude,
      lng: n.longitude
    }));

    const issuesWithNews = await Promise.all(reports.map(async (r: any) => {
      const nearby = filteredNews.filter((n: any) => {
        const dist = Math.sqrt(Math.pow(n.lat - r.latitude, 2) + Math.pow(n.lng - r.longitude, 2));
        return dist < 0.01;
      }).map((n: any) => ({
        id: n.id,
        source: n.source,
        title: n.headline,
        url: n.url,
        date: formatRelativeTime(n.published_at),
        snippet: n.snippet,
        isTragic: n.is_tragic,
      }));

      // Use public URL instead of signed URL (no API call needed!)
      const imageUrl = r.image_url ? storage.getPublicUrl(r.image_url) : null;

      return {
        id: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        title: r.title,
        category: r.category,
        customCategory: r.custom_category,
        status: r.status,
        severity: r.severity,
        agency: r.agency,
        ward: r.ward_name,
        mla: r.mla_name,
        sanctionedBudget: r.sanctioned_budget,
        upvotes: r.upvotes,
        verificationCount: r.verification_count,
        timestamp: formatRelativeTime(r.created_at),
        newsContext: nearby.length > 0 ? nearby : undefined,
        zone: r.zone,
        parliament: r.parliamentary_constituency,
        mp: r.mp_name,
        imageUrl: imageUrl,
        sourceUrl: r.source_url,
      };
    }));

    return { issues: issuesWithNews };
  })

  // ─── All Reports (fallback) ──────────────────
  .get('/api/reports', async () => {
    const reports = await sql`
      SELECT 
        id, title, category, custom_category, status, severity,
        agency, ward_name, mla_name, sanctioned_budget,
        upvotes, verification_count,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        created_at, creator_id,
        zone, parliamentary_constituency, mp_name,
        image_url, source_url
      FROM reports
      WHERE status != 'pending_verification'
      ORDER BY created_at DESC
      LIMIT 200
    `;

    const issues = await Promise.all(reports.map(async (r: any) => {
      // Use public URL instead of signed URL
      const imageUrl = r.image_url ? storage.getPublicUrl(r.image_url) : null;

      return {
        id: r.id,
        latitude: r.latitude,
        longitude: r.longitude,
        title: r.title,
        category: r.category,
        customCategory: r.custom_category,
        status: r.status,
        severity: r.severity,
        agency: r.agency,
        ward: r.ward_name,
        mla: r.mla_name,
        sanctionedBudget: r.sanctioned_budget,
        upvotes: r.upvotes,
        verificationCount: r.verification_count,
        timestamp: formatRelativeTime(r.created_at),
        zone: r.zone,
        parliament: r.parliamentary_constituency,
        mp: r.mp_name,
        imageUrl: imageUrl,
        sourceUrl: r.source_url,
      };
    }));

    return { issues };
  })

  // ─── Submit Report (validated) ────────────────
  .post('/api/reports', async ({ body, set, request }) => {
    // Auth: Require authenticated user for report submission
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to submit reports' };
    }

    const { title, category, customCategory, latitude, longitude, severity, creatorId, image } = body;

    // Per-user rate limit: max 5 reports per 10 minutes
    if (auth.userId) {
      const userLimit = checkUserRateLimit(auth.userId, 'submit_report', 5, 10 * 60 * 1000);
      if (!userLimit.allowed) {
        set.status = 429;
        return { error: 'Too many reports. Please wait before submitting again.', retryAfter: userLimit.retryAfter };
      }
    }

    let imageUrl = null;
    if (image instanceof File) {
      // Validate image size (10MB max)
      const MAX_SIZE = 10 * 1024 * 1024;
      if (image.size > MAX_SIZE) {
        set.status = 400;
        return { error: 'Image too large. Maximum 10MB allowed.' };
      }

      // Validate image type via MIME
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(image.type)) {
        set.status = 400;
        return { error: 'Invalid image type. Only JPEG, PNG, and WebP allowed.' };
      }

      // Validate magic bytes match declared type
      const imageBuffer = Buffer.from(await image.arrayBuffer());
      if (!validateImageMagicBytes(imageBuffer, image.type)) {
        set.status = 400;
        return { error: 'Image content does not match declared type.' };
      }

      try {
        imageUrl = await storage.uploadImage(image);
      } catch (e) {
        console.error('Image upload failed:', e);
        set.status = 500;
        return { error: 'Image upload failed. Please try again.' };
      }
    }

    // Input validation
    if (!title || typeof title !== 'string' || title.length < 3 || title.length > 200) {
      set.status = 400;
      return { error: 'Title must be 3-200 characters.' };
    }
    if (!category || typeof category !== 'string') {
      set.status = 400;
      return { error: 'Category is required.' };
    }
    // Strict coordinate validation
    if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
        isNaN(latitude) || isNaN(longitude) ||
        !isFinite(latitude) || !isFinite(longitude) ||
        latitude < -90 || latitude > 90 ||
        longitude < -180 || longitude > 180) {
      set.status = 400;
      return { error: 'Invalid coordinates.' };
    }

    const validSeverity = ['low', 'medium', 'high', 'critical'];
    const safeSeverity = validSeverity.includes(severity || '') ? severity : 'medium';
    const safeTitle = sanitizeTitle(title);

    const wardMatch = await sql`
      SELECT ward_name, mla_name, sanctioned_budget::text
      FROM wards
      WHERE ST_Contains(
        boundaries::geometry,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      )
      LIMIT 1
    `;

    const ward = wardMatch[0] || { ward_name: 'Unknown Ward', mla_name: 'TBD', sanctioned_budget: 'Pending', zone: null, parliamentary_constituency: null, mp_name: null };

    const agencyMap: Record<string, string> = {
      'Pothole': 'BBMP Major Roads',
      'Broken Footpath': 'BBMP Ward Level',
      'Drainage': 'BWSSB',
      'Streetlight': 'BESCOM',
    };

    const [report] = await sql`
      INSERT INTO reports (
        title, category, custom_category, location, severity, agency, 
        ward_name, mla_name, sanctioned_budget, creator_id,
        zone, parliamentary_constituency, mp_name, image_url
      )
      VALUES (
        ${safeTitle},
        ${category.slice(0, 50)},
        ${customCategory ? customCategory.slice(0, 100) : null},
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
        ${safeSeverity},
        ${agencyMap[category] || 'Municipal Corporation'},
        ${ward.ward_name},
        ${ward.mla_name},
        ${'₹' + (ward.sanctioned_budget || '0') + ' Crores'},
        ${creatorId || null},
        ${ward.zone},
        ${ward.parliamentary_constituency},
        ${ward.mp_name},
        ${imageUrl}
      )
      RETURNING id, title, status, created_at
    `;

    if (creatorId) {
      await sql`UPDATE users SET reports_published = reports_published + 1, trust_score = trust_score + 10 WHERE id = ${creatorId}`;
    }

    return { success: true, report };
  }, {
    body: t.Object({
      title: t.String({ minLength: 3, maxLength: 200 }),
      category: t.String({ minLength: 1, maxLength: 50 }),
      customCategory: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
      latitude: t.Numeric({ minimum: -90, maximum: 90 }),
      longitude: t.Numeric({ minimum: -180, maximum: 180 }),
      severity: t.Optional(t.Union([t.Literal('low'), t.Literal('medium'), t.Literal('high'), t.Literal('critical')])),
      creatorId: t.Optional(t.Union([t.String(), t.Null()])),
      image: t.Optional(t.Any()),
    })
  })

  // ─── Upvote (one per user) ───────────────────
  .post('/api/reports/:id/upvote', async ({ params, body, set, request }) => {
    // Auth: Require authenticated user
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to upvote' };
    }

    const { userId } = body;

    // Per-user rate limit: max 30 upvotes per 10 minutes
    if (auth.userId) {
      const userLimit = checkUserRateLimit(auth.userId, 'upvote', 30, 10 * 60 * 1000);
      if (!userLimit.allowed) {
        set.status = 429;
        return { error: 'Too many upvotes. Slow down.', retryAfter: userLimit.retryAfter };
      }
    }

    try {
      await sql`INSERT INTO upvotes (report_id, user_id) VALUES (${params.id}, ${userId})`;
      await sql`UPDATE reports SET upvotes = upvotes + 1 WHERE id = ${params.id}`;
      return { success: true };
    } catch {
      set.status = 409;
      return { success: false, error: 'Already upvoted' };
    }
  }, {
    params: t.Object({
      id: t.String()
    }),
    body: t.Object({
      userId: t.String()
    })
  })

  // ─── Verify Report ───────────────────────────
  .post('/api/reports/:id/verify', async ({ params, body, set, request }) => {
    // Auth: Require authenticated user
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to verify reports' };
    }

    const { userId, isValid } = body;

    // Per-user rate limit: max 20 verifications per 10 minutes
    if (auth.userId) {
      const userLimit = checkUserRateLimit(auth.userId, 'verify_report', 20, 10 * 60 * 1000);
      if (!userLimit.allowed) {
        set.status = 429;
        return { error: 'Too many verifications. Slow down.', retryAfter: userLimit.retryAfter };
      }
    }

    try {
      await sql`INSERT INTO verifications (report_id, verifier_id, is_valid) VALUES (${params.id}, ${userId}, ${isValid})`;

      if (isValid) {
        await sql`UPDATE reports SET verification_count = verification_count + 1 WHERE id = ${params.id}`;
        const [report] = await sql`SELECT verification_count FROM reports WHERE id = ${params.id}`;
        if (report && report.verification_count >= 3) {
          await sql`UPDATE reports SET status = 'open' WHERE id = ${params.id} AND status = 'pending_verification'`;
        }
      } else {
        await sql`UPDATE reports SET status = 'resolved' WHERE id = ${params.id}`;
      }

      if (userId) {
        await sql`UPDATE users SET reports_verified = reports_verified + 1, trust_score = trust_score + 20 WHERE id = ${userId}`;
      }

      return { success: true };
    } catch {
      set.status = 409;
      return { success: false, error: 'Already verified' };
    }
  }, {
    params: t.Object({
      id: t.String()
    }),
    body: t.Object({
      userId: t.String(),
      isValid: t.Boolean()
    })
  })

  // ─── Leaderboard: Citizens ───────────────────
  .get('/api/leaderboard/citizens', async () => {
    const users = await sql`
      SELECT 
        id, display_name, job_title, socials, avatar_url,
        reports_published, reports_verified, integrations_helped,
        (reports_published * 10 + reports_verified * 20 + integrations_helped * 50) AS civic_sense_score
      FROM users
      WHERE (reports_published * 10 + reports_verified * 20 + integrations_helped * 50) > 0
      ORDER BY civic_sense_score DESC
      LIMIT 50
    `;

    return {
      citizens: users.map((u: any, i: number) => ({
        id: u.id,
        name: u.display_name,
        jobTitle: u.job_title,
        socials: u.socials || {},
        reportsPublished: u.reports_published,
        reportsVerified: u.reports_verified,
        integrationsHelped: u.integrations_helped,
        civicSenseScore: u.civic_sense_score,
        rank: i + 1,
      })),
    };
  })

  // ─── Leaderboard: Wall of Shame ──────────────
  .get('/api/leaderboard/shame', async () => {
    const mlas = await sql`
      SELECT
        m.id,
        m.name,
        m.constituency AS ward,
        m.city,
        COUNT(CASE WHEN r.status = 'open' THEN 1 END) AS unresolved_count
      FROM mlas m
      LEFT JOIN reports r ON r.mla_name = m.name
      GROUP BY m.id, m.name, m.constituency, m.city
      ORDER BY unresolved_count DESC, m.name ASC
      LIMIT 50
    `;

    return {
      mlas: mlas.map((m: any, i: number) => ({
        id: m.id,
        name: m.name,
        ward: m.ward,
        city: m.city,
        unresolvedCount: Number(m.unresolved_count) || 0,
        rank: i + 1,
      })),
    };
  })

  // ─── Trending News ───────────────────────────
  .get('/api/news/trending', async () => {
    const news = await sql`
      SELECT 
        id, headline, url, source, snippet, is_tragic,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        published_at
      FROM local_news
      WHERE confidence_score >= 40
      ORDER BY published_at DESC
      LIMIT 20
    `;

    return {
      news: news.map((n: any) => ({
        id: n.id,
        source: n.source,
        title: n.headline,
        url: n.url,
        date: formatRelativeTime(n.published_at),
        snippet: n.snippet,
        isTragic: n.is_tragic,
      })),
    };
  })

  // ─── All News ────────────────────────────────
  .get('/api/news', async () => {
    const news = await sql`
      SELECT id, headline, url, source, snippet, is_tragic, city,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        published_at
      FROM local_news
      WHERE confidence_score >= 40
      ORDER BY published_at DESC
      LIMIT 50
    `;
    return {
      news: news.map((n: any) => ({
        id: n.id,
        source: n.source,
        title: n.headline,
        url: n.url,
        date: formatRelativeTime(n.published_at),
        snippet: n.snippet,
        isTragic: n.is_tragic,
        city: n.city,
        location: { lat: n.latitude, lng: n.longitude }
      }))
    };
  })

  // ─── Local News (Alias) ──────────────────────
  .get('/api/local-news', async () => {
    const news = await sql`
      SELECT id, headline, url, source, snippet, city, published_at
      FROM local_news
      WHERE confidence_score >= 40
      ORDER BY published_at DESC
      LIMIT 50
    `;
    return { news };
  })

  // ─── MLAs ────────────────────────────────────
  .get('/api/mlas', async () => {
    const mlas = await sql`
      SELECT id, name, party, constituency, city, state, contact, email, is_incorrect, latitude, longitude
      FROM mlas
      ORDER BY city, name
    `;
    return { mlas };
  })

  .post('/api/mlas/:id/flag', async ({ params, set, request }) => {
    // Auth: Require authenticated user to flag MLAs
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to flag MLA details' };
    }

    const { id } = params;
    const [mla] = await sql`
      SELECT id, is_incorrect FROM mlas WHERE id = ${id}
    `;
    if (!mla) {
      set.status = 404;
      return { error: 'MLA not found' };
    }
    await sql`
      UPDATE mlas
      SET is_incorrect = TRUE, updated_at = NOW()
      WHERE id = ${id}
    `;
    return { success: true, message: 'MLA details flagged as incorrect' };
  })

  .post('/api/mlas/flag-by-name', async ({ body, set, request }) => {
    // Auth: Require authenticated user
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to flag MLA details' };
    }

    const { name, constituency } = body as any;
    if (!name) {
      set.status = 400;
      return { error: 'MLA name is required' };
    }
    
    let mla;
    if (constituency) {
      [mla] = await sql`
        SELECT id FROM mlas WHERE name = ${name} AND constituency = ${constituency}
      `;
    } else {
      [mla] = await sql`
        SELECT id FROM mlas WHERE name = ${name} LIMIT 1
      `;
    }
    
    if (!mla) {
      // Create placeholder MLA
      const [newMla] = await sql`
        INSERT INTO mlas (name, constituency, city, state, is_incorrect)
        VALUES (${name}, ${constituency || 'Unknown Constituency'}, 'Unknown', 'Unknown', TRUE)
        RETURNING id
      `;
      return { success: true, message: 'Placeholder MLA created and flagged as incorrect', mlaId: newMla.id };
    }

    await sql`
      UPDATE mlas
      SET is_incorrect = TRUE, updated_at = NOW()
      WHERE id = ${mla.id}
    `;
    return { success: true, message: 'MLA details flagged as incorrect', mlaId: mla.id };
  })

  .get('/api/users/volunteers/constituency/:constituency', async ({ params, set, request }) => {
    // Auth: Require authenticated user to view volunteer PII
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to view volunteer details' };
    }

    const { constituency } = params;
    // Only expose non-PII fields to other authenticated users
    const volunteers = await sql`
      SELECT display_name, job_title
      FROM users
      WHERE home_constituency = ${constituency}
      ORDER BY created_at ASC
      LIMIT 5
    `;
    return { volunteers };
  })

  // ─── Enhanced News Scraper Trigger (ADMIN) ───
  .post('/api/scraper/enhanced/run', async ({ request, set }) => {
    const adminKey = request.headers.get('x-admin-key');
    if (!requireAdmin(adminKey)) {
      set.status = 403;
      return { error: 'Forbidden. Valid admin key required.' };
    }
    const countNews = await runEnhancedNewsScraper();
    return { success: true, newsArticlesInserted: countNews };
  })

  // ─── Multi-City MLA Scraper Trigger (ADMIN) ──
  .post('/api/scraper/mla/multi-city/run', async ({ request, set }) => {
    const adminKey = request.headers.get('x-admin-key');
    if (!requireAdmin(adminKey)) {
      set.status = 403;
      return { error: 'Forbidden. Valid admin key required.' };
    }
    const countMlas = await runMultiCityMLAScraper();
    return { success: true, mlasUpdated: countMlas };
  })

  // ─── Project/MLA Scraper Trigger (ADMIN) ─────
  .post('/api/scraper/projects/run', async ({ request, set }) => {
    const adminKey = request.headers.get('x-admin-key');
    if (!requireAdmin(adminKey)) {
      set.status = 403;
      return { error: 'Forbidden. Valid admin key required.' };
    }
    const countProjects = await runProjectScraper();
    return { success: true, projectsInserted: countProjects };
  })

  // ─── Volunteer System: Submit Data ───────────
  .post('/api/volunteer/submit', async ({ body, set, request }) => {
    // Auth: Require authenticated user for volunteer submissions
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to submit volunteer data' };
    }

    const { type, data, submittedBy, submitterEmail } = body;

    try {
      const result = await submitVolunteerData({ type, data, submittedBy, submitterEmail });
      return { success: true, submissionId: result.id };
    } catch (e) {
      set.status = 500;
      return { error: 'Submission failed' };
    }
  }, {
    body: t.Object({
      type: t.String(),
      data: t.Any(),
      submittedBy: t.String(),
      submitterEmail: t.Optional(t.Union([t.String(), t.Null()]))
    })
  })

  // ─── Volunteer System: Get Pending ────────────
  .get('/api/volunteer/pending', async ({ set, request }) => {
    // Auth: Require authenticated user to see pending queue
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to view pending submissions' };
    }

    const pending = await getPendingSubmissions(50);
    return { submissions: pending };
  })

  // ─── Volunteer System: Verify Submission ──────
  .post('/api/volunteer/verify/:id', async ({ params, body, set, request }) => {
    // Auth: Require authenticated user for verification
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to verify submissions' };
    }

    const { verifierId, approved, notes } = body;

    try {
      // Pass authenticated userId to prevent Sybil attacks
      const result = await verifySubmission(params.id, verifierId, approved, notes, auth.userId || undefined);
      return { success: true, ...result };
    } catch (e) {
      set.status = 500;
      return { error: 'Verification failed' };
    }
  }, {
    params: t.Object({
      id: t.String()
    }),
    body: t.Object({
      verifierId: t.String(),
      approved: t.Boolean(),
      notes: t.Optional(t.Union([t.String(), t.Null()]))
    })
  })

  // ─── Clerk User Sync (auto-create on first login) ───
  .post('/api/users/sync', async ({ body, set, request }) => {
    // Auth: Require authenticated user for sync
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required' };
    }

    const { clerkId, displayName, avatarUrl, email } = body;

    const safeName = (displayName || 'Citizen Hero').replace(/<[^>]*>/g, '').slice(0, 50);

    // Upsert: create if not exists, update avatar/name if exists
    const [user] = await sql`
      INSERT INTO users (clerk_id, display_name, avatar_url, email)
      VALUES (${clerkId}, ${safeName}, ${avatarUrl || null}, ${email || null})
      ON CONFLICT (clerk_id) DO UPDATE SET
        display_name = COALESCE(EXCLUDED.display_name, users.display_name),
        avatar_url = COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        email = COALESCE(EXCLUDED.email, users.email)
      RETURNING id, display_name, trust_score, clerk_id
    `;

    return { success: true, user };
  }, {
    body: t.Object({
      clerkId: t.String(),
      displayName: t.Optional(t.Union([t.String(), t.Null()])),
      avatarUrl: t.Optional(t.Union([t.String(), t.Null()])),
      email: t.Optional(t.Union([t.String(), t.Null()]))
    })
  })

  // ─── Get User by Clerk ID ────────────────────
  .get('/api/users/clerk/:clerkId', async ({ params, set, request }) => {
    // SECURITY: Require auth to prevent PII enumeration
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to view user profiles' };
    }

    const [user] = await sql`
      SELECT 
        id, clerk_id, display_name, job_title, socials, avatar_url,
        reports_published, reports_verified, integrations_helped,
        (reports_published * 10 + reports_verified * 20 + integrations_helped * 50) AS civic_sense_score,
        home_constituency, home_city, home_state,
        created_at
      FROM users WHERE clerk_id = ${params.clerkId}
    `;

    if (!user) { set.status = 404; return { error: 'User not found' }; }

    // Only expose PII (email, home_*) to the user themselves
    const isOwner = auth.userId === params.clerkId;
    if (!isOwner) {
      // Strip sensitive fields for non-owners
      const { email, ...safeUser } = user as any;
      return { user: safeUser };
    }
    return { user };
  })

  // ─── Update User by Clerk ID ─────────────────
  .put('/api/users/clerk/:clerkId', async ({ params, body, set, request }) => {
    // Auth: IDOR Protection — user can only update their own profile
    const auth = await verifyAuth(request);
    if (!requireOwnership(auth, params.clerkId, set)) {
      return { error: 'You can only update your own profile' };
    }

    const { jobTitle, socials, homeConstituency, homeCity, homeState } = body as any;

    await sql`
      UPDATE users SET
        job_title = COALESCE(${jobTitle ? jobTitle.replace(/<[^>]*>/g, '').slice(0, 50) : null}, job_title),
        socials = COALESCE(${JSON.stringify(socials || null)}, socials),
        home_constituency = COALESCE(${homeConstituency || null}, home_constituency),
        home_city = COALESCE(${homeCity || null}, home_city),
        home_state = COALESCE(${homeState || null}, home_state)
      WHERE clerk_id = ${params.clerkId}
    `;

    return { success: true };
  })

  // ─── User Profile CRUD (legacy UUID-based) ──
  .post('/api/users', async ({ body, set, request }) => {
    // SECURITY: Require authenticated user (prevents mass fake account creation)
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to create user profile' };
    }

    const { displayName, jobTitle, socials } = body as any;

    const safeName = (displayName || 'Citizen Hero').replace(/<[^>]*>/g, '').slice(0, 50);
    const safeJob = jobTitle ? jobTitle.replace(/<[^>]*>/g, '').slice(0, 50) : null;

    const [user] = await sql`
      INSERT INTO users (display_name, job_title, socials)
      VALUES (${safeName}, ${safeJob}, ${JSON.stringify(socials || {})})
      RETURNING id, display_name, trust_score
    `;

    return { success: true, user };
  })

  .put('/api/users/:id', async ({ params, body, set, request }) => {
    // Auth: Require authenticated user for profile updates
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to update profile' };
    }

    const { displayName, jobTitle, socials, avatarUrl } = body as any;

    // Validate UUID format
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
      set.status = 400;
      return { error: 'Invalid user ID format.' };
    }

    await sql`
      UPDATE users SET
        display_name = COALESCE(${displayName ? displayName.replace(/<[^>]*>/g, '').slice(0, 50) : null}, display_name),
        job_title = COALESCE(${jobTitle ? jobTitle.replace(/<[^>]*>/g, '').slice(0, 50) : null}, job_title),
        socials = COALESCE(${JSON.stringify(socials || null)}, socials),
        avatar_url = COALESCE(${avatarUrl || null}, avatar_url)
      WHERE id = ${params.id}
    `;

    return { success: true };
  })

  .get('/api/users/:id', async ({ params, set }) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
      set.status = 400;
      return { error: 'Invalid user ID format.' };
    }

    const [user] = await sql`
      SELECT 
        id, display_name, job_title, socials, avatar_url,
        reports_published, reports_verified, integrations_helped,
        (reports_published * 10 + reports_verified * 20 + integrations_helped * 50) AS civic_sense_score,
        created_at
      FROM users WHERE id = ${params.id}
    `;

    if (!user) { set.status = 404; return { error: 'User not found' }; }
    return { user };
  })

  // ─── Global error handler ────────────────────
  .onError(({ error, set }) => {
    console.error('[API Error]', error);
    set.status = 500;
    return { error: 'Internal server error' };
  })

  // ─── Start Server ────────────────────────────
  .listen({ port: process.env.PORT ? parseInt(process.env.PORT, 10) : 6969, hostname: '0.0.0.0' });

console.log(`🟢 FixIndia.org API running at http://0.0.0.0:${app.server?.port}`);

// ═══════════════════════════════════════════════
// SCHEDULED SCRAPING (OFF-PEAK HOURS: 3 AM - 8 AM IST)
// ═══════════════════════════════════════════════

// ─── Enhanced News Scraper: 3 AM, 5 AM, 7 AM ───
cron.schedule(SCRAPING_SCHEDULE.news.cron, async () => {
  console.log(`[Cron] ${SCRAPING_SCHEDULE.news.description}`);
  try {
    const count = await runEnhancedNewsScraper();
    console.log(`[Cron] ✓ Enhanced news scraper: ${count} articles`);
  } catch (e) {
    console.error('[Cron] Enhanced news scraper failed:', e);
  }
});

// ─── Multi-City MLA Scraper: 4 AM every Sunday ───
cron.schedule(SCRAPING_SCHEDULE.mla.cron, async () => {
  console.log(`[Cron] ${SCRAPING_SCHEDULE.mla.description}`);
  try {
    const count = await runMultiCityMLAScraper();
    console.log(`[Cron] ✓ Multi-city MLA scraper: ${count} MLAs`);
  } catch (e) {
    console.error('[Cron] Multi-city MLA scraper failed:', e);
  }
});

// ─── Government Projects: 6 AM every Monday ───
cron.schedule(SCRAPING_SCHEDULE.government.cron, async () => {
  console.log(`[Cron] ${SCRAPING_SCHEDULE.government.description}`);
  try {
    const count = await runProjectScraper();
    console.log(`[Cron] ✓ Government projects scraper: ${count} projects`);
  } catch (e) {
    console.error('[Cron] Government projects scraper failed:', e);
  }
});

console.log('📅 Scheduled scrapers configured:');
console.log(`   - News: ${SCRAPING_SCHEDULE.news.cron} (3 AM, 5 AM, 7 AM IST)`);
console.log(`   - MLAs: ${SCRAPING_SCHEDULE.mla.cron} (4 AM Sunday)`);
console.log(`   - Projects: ${SCRAPING_SCHEDULE.government.cron} (6 AM Monday)`);

// Helper: Smart relative time formatting
function formatRelativeTime(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  if (diff < 0) return 'Just now'; // Future date protection

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? 's' : ''} ago`;

  // For older items, use actual date
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
