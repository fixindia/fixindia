/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import { timingSafeEqual, createHash } from 'node:crypto';
import sql from './db';
import { storage } from './lib/storage';
import { logger } from './lib/logger';
import { withTtlCache } from './lib/cache';
import { runProjectScraper } from './project_scraper';
import { runEnhancedNewsScraper } from './enhanced_scraper';
import { runMultiCityMLAScraper } from './multi_city_mla_scraper';
import { submitVolunteerData, getPendingSubmissions, verifySubmission } from './volunteer_system';
import { securityHeaders, generateFingerprint, checkRateLimit, checkUserRateLimit, sanitizeInput, sanitizeTitle, validateImageMagicBytes } from './security';
import { verifyAuth, requireAuth, requireOwnership } from './auth';
import cron from 'node-cron';
import { validateEnv, env } from './config';
import { runMigrations } from './migrate';
import { SCRAPING_SCHEDULE } from './config/cities';
import { nextResolutionStatus } from './lib/resolution';
import { resolveAgency, draftComplaint } from './lib/escalation';
import { analyzeCivicImage } from './lib/vision';

// Validate environment variables on startup
validateEnv();

// Run database migrations on startup (serialized via advisory lock; safe to run
// concurrently with the admin API process).
try {
  logger.info('Running database migrations...');
  await runMigrations();
  logger.info('Database migrations complete.');
} catch (err) {
  logger.error('Database migration failed', { error: String(err) });
}

// ─── Security: In-memory rate limiter ──────────
// Now using enhanced fingerprinting from security.ts

// Admin key for sensitive operations
const ADMIN_KEY = env.ADMIN_KEY;
if (!ADMIN_KEY) {
  if (env.isProduction) {
    throw new Error('ADMIN_KEY environment variable is not set');
  }
  logger.warn('ADMIN_KEY not set. Admin endpoints will be disabled.');
}

// Shared UUID validator (v4-ish; matches gen_random_uuid() output shape)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const ALLOWED_ORIGINS = env.isProduction
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

  // ─── Per-request ID + Enhanced Rate Limiting + body-size guard ───
  .onBeforeHandle(({ request, set, store }) => {
    // Attach a short request id so errors can be traced end-to-end.
    const reqId = (store as any).requestId || crypto.randomUUID();
    (store as any).requestId = reqId;

    // 10A.2: Per-route body-size limit. The global cap is 15 MB to allow image
    // uploads (multipart/form-data). JSON payloads on non-upload routes are
    // tiny, so reject anything that is NOT multipart but larger than 32 KB
    // early — this stops oversized JSON bodies from being parsed/processed.
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    const isMultipart = ct.startsWith('multipart/form-data');
    if (!isMultipart && contentLength > 32 * 1024) {
      set.status = 413;
      return { error: 'Payload too large.', requestId: reqId };
    }

    const fingerprint = generateFingerprint(request);
    const isWrite = request.method === 'POST' || request.method === 'PUT';
    const limit = isWrite ? 30 : 120;

    const result = checkRateLimit(fingerprint, limit, 60_000);

    if (!result.allowed) {
      set.status = 429;
      set.headers['Retry-After'] = String(result.retryAfter || 60);
      return { error: 'Too many requests. Slow down.', retryAfter: result.retryAfter, requestId: reqId };
    }
  })

  // ─── Health Check (liveness — cheap, no DB) ───
  .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // ─── Readiness Check (verifies the DB is reachable) ───
  .get('/health/ready', async ({ set }) => {
    try {
      // Race the DB ping against a 2s timeout so a stuck Postgres can't hang
      // the load balancer / deploy health check.
      const ping = sql`SELECT 1`;
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DB ping timed out')), 2000),
      );
      await Promise.race([ping, timeout]);
      return { status: 'ready', timestamp: new Date().toISOString() };
    } catch (err) {
      logger.error('Readiness check failed', { error: String(err) });
      set.status = 503;
      return { status: 'degraded', timestamp: new Date().toISOString() };
    }
  })

  // ─── CSP Violation Report Collector (10A.4) ───
  // Browsers POST `application/csp-report` (or `application/reports+json` for
  // the Reporting-Api) here when a Content-Security-Policy directive blocks
  // something. We log the violation so real-world issues surface; no PII is
  // stored. Returns 204 so the browser is satisfied.
  .post('/api/csp-report', async ({ request, set }) => {
    try {
      const ct = (request.headers.get('content-type') || '').toLowerCase();
      const text = await request.text();
      let report: unknown = text;
      try { report = JSON.parse(text); } catch { /* leave as raw text */ }
      logger.warn('CSP violation reported', { contentType: ct, report });
    } catch (err) {
      logger.warn('Failed to read CSP report', { error: String(err) });
    }
    set.status = 204;
    return '';
  })

  // ─── Map Context: Bounding Box Query ─────────
  .get('/api/map/context', async ({ query, set, store }) => {
    const reqId = (store as any).requestId;
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

    try {
      // 8.1: do the nearby-news matching in SQL with a LATERAL + ST_DWithin
      // spatial join instead of an O(reports × news) JS nested loop. The
      // GiST indexes on reports.location and local_news.location make this
      // cheap, and it runs on every map pan.
      // 0.01 degrees ≈ ~1.1 km at the equator (matches the old JS threshold).
      const rows = await sql`
        SELECT
          r.id, r.title, r.category, r.custom_category, r.status, r.severity,
          r.agency, r.ward_name, r.mla_name, r.sanctioned_budget,
          r.upvotes, r.verification_count,
          (SELECT COUNT(*) FROM resolutions rz WHERE rz.report_id = r.id AND rz.vote = 'fixed')::int AS fixed_count,
          (SELECT COUNT(*) FROM resolutions rz WHERE rz.report_id = r.id AND rz.vote = 'working')::int AS working_count,
          ST_Y(r.location::geometry) AS latitude,
          ST_X(r.location::geometry) AS longitude,
          r.created_at, r.creator_id,
          r.zone, r.parliamentary_constituency, r.mp_name,
          r.image_url, r.source_url,
          COALESCE(
            json_agg(
              json_build_object(
                'source', n.source,
                'title', n.headline,
                'url', n.url,
                'snippet', n.snippet,
                'isTragic', n.is_tragic,
                'date', to_char(n.published_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
              )
            ) FILTER (WHERE n.id IS NOT NULL),
            '[]'::json
          ) AS news_context
        FROM reports r
        LEFT JOIN LATERAL (
          SELECT n.id, n.headline, n.url, n.source, n.snippet, n.is_tragic, n.published_at
          FROM local_news n
          WHERE ST_DWithin(n.location, r.location, 1100)  -- ~0.01 deg / ~1.1 km
            AND n.confidence_score >= 50
          ORDER BY n.published_at DESC
          LIMIT 5
        ) n ON TRUE
        WHERE ST_Intersects(
          r.location,
          ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography
        )
        -- news_context is aggregated with json_agg, so every non-aggregated
        -- column must be grouped. reports.id is the PK, so grouping by it alone
        -- lets Postgres treat all other r.* columns as functionally dependent.
        GROUP BY r.id
        ORDER BY r.created_at DESC
        LIMIT 200
      `;

      const issuesWithNews = rows.map((r: any) => {
        const imageUrl = r.image_url ? storage.getPublicUrl(r.image_url) : null;
        const newsContext = Array.isArray(r.news_context) && r.news_context.length > 0
          ? r.news_context.map((nn: any) => ({ ...nn, date: formatRelativeTime(nn.date) }))
          : undefined;
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
          fixedCount: r.fixed_count,
          workingCount: r.working_count,
          timestamp: formatRelativeTime(r.created_at),
          newsContext,
          zone: r.zone,
          parliament: r.parliamentary_constituency,
          mp: r.mp_name,
          imageUrl,
          sourceUrl: r.source_url,
        };
      });

      return { issues: issuesWithNews };
    } catch (err) {
      logger.error('Failed to load map context', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load map context', requestId: reqId };
    }
  })

  // ─── All Reports (fallback) ──────────────────
  .get('/api/reports', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
      const reports = await sql`
        SELECT
          id, title, category, custom_category, status, severity,
          agency, ward_name, mla_name, sanctioned_budget,
          upvotes, verification_count,
          (SELECT COUNT(*) FROM resolutions rz WHERE rz.report_id = reports.id AND rz.vote = 'fixed')::int AS fixed_count,
          (SELECT COUNT(*) FROM resolutions rz WHERE rz.report_id = reports.id AND rz.vote = 'working')::int AS working_count,
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
          fixedCount: r.fixed_count,
          workingCount: r.working_count,
          timestamp: formatRelativeTime(r.created_at),
          zone: r.zone,
          parliament: r.parliamentary_constituency,
          mp: r.mp_name,
          imageUrl: imageUrl,
          sourceUrl: r.source_url,
        };
      }));

      return { issues };
    } catch (err) {
      logger.error('Failed to load reports', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load reports', requestId: reqId };
    }
  })

  // ─── Submit Report (validated) ────────────────
  .post('/api/reports', async ({ body, set, request }) => {
    // Auth: Require authenticated user for report submission
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to submit reports' };
    }

    const { title, category, customCategory, latitude, longitude, severity, image } = body;
    // SECURITY: The creator is ALWAYS the authenticated user. Never trust a
    // client-supplied creatorId — doing so lets anyone attribute reports (and
    // the resulting trust points) to arbitrary accounts.
    const creatorId = auth.userId;

    // Per-user rate limit: max 5 reports per 10 minutes
    if (auth.userId) {
      const userLimit = checkUserRateLimit(auth.userId, 'submit_report', 5, 10 * 60 * 1000);
      if (!userLimit.allowed) {
        set.status = 429;
        return { error: 'Too many reports. Please wait before submitting again.', retryAfter: userLimit.retryAfter };
      }
    }

    // Validate the cheap metadata FIRST, before spending a Storj upload on it.
    // (Previously the image was uploaded before these checks, so a rejected
    // submission still left an orphaned object in object storage.)
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
        logger.error('Image upload failed', { error: String(e) });
        set.status = 500;
        return { error: 'Image upload failed. Please try again.' };
      }
    }

    const validSeverity = ['low', 'medium', 'high', 'critical'];
    const safeSeverity = validSeverity.includes(severity || '') ? severity : 'medium';
    const safeTitle = sanitizeTitle(title);

    const wardMatch = await sql`
      SELECT ward_name, mla_name, sanctioned_budget::text,
             zone, parliamentary_constituency, mp_name
      FROM wards
      WHERE ST_Contains(
        boundaries::geometry,
        ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)
      )
      LIMIT 1
    `;

    const ward = wardMatch[0] || { ward_name: 'Unknown Ward', mla_name: 'TBD', sanctioned_budget: 'Pending', zone: null, parliamentary_constituency: null, mp_name: null };

    // Smart agency routing: keyword-based, covers standard categories AND free-text
    // "Other" descriptions, with a safe 'Municipal Corporation' default. See lib/escalation.ts.
    const agency = resolveAgency(category, customCategory);

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
        ${agency},
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
      // creatorId is a Clerk ID (e.g. "user_xxx"), which lives in users.clerk_id,
      // NOT users.id (a UUID). The previous `WHERE id = ${creatorId}` never matched,
      // so contributors were silently never credited.
      await sql`
        UPDATE users
        SET reports_published = reports_published + 1, trust_score = trust_score + 10
        WHERE clerk_id = ${creatorId}
      `;
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
      // creatorId intentionally omitted — the server derives it from the verified token.
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

    // SECURITY: The voter identity is the verified token subject, NOT a body field.
    // Trusting body.userId let a single user cast unlimited upvotes by rotating IDs,
    // defeating the UNIQUE(report_id, user_id) constraint.
    const userId = auth.userId!;

    // Per-user rate limit: max 30 upvotes per 10 minutes
    const userLimit = checkUserRateLimit(userId, 'upvote', 30, 10 * 60 * 1000);
    if (!userLimit.allowed) {
      set.status = 429;
      return { error: 'Too many upvotes. Slow down.', retryAfter: userLimit.retryAfter };
    }

    // Validate report id is a UUID before touching the DB.
    if (!UUID_RE.test(params.id)) {
      set.status = 400;
      return { success: false, error: 'Invalid report ID.' };
    }

    try {
      // Atomic: only bump the counter if the upvote row was actually inserted.
      // The unique constraint makes a duplicate INSERT throw → caught as 409.
      await sql.begin(async (tx: any) => {
        await tx`INSERT INTO upvotes (report_id, user_id) VALUES (${params.id}, ${userId})`;
        await tx`UPDATE reports SET upvotes = upvotes + 1 WHERE id = ${params.id}`;
      });
      return { success: true };
    } catch {
      set.status = 409;
      return { success: false, error: 'Already upvoted' };
    }
  }, {
    params: t.Object({
      id: t.String()
    }),
    // body.userId kept optional for backward-compat with old clients but ignored.
    body: t.Optional(t.Object({
      userId: t.Optional(t.String())
    }))
  })

  // ─── Verify Report ───────────────────────────
  .post('/api/reports/:id/verify', async ({ params, body, set, request }) => {
    // Auth: Require authenticated user
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to verify reports' };
    }

    // SECURITY: verifier identity comes from the verified token, not the body.
    const userId = auth.userId!;
    const { isValid } = body;

    // Per-user rate limit: max 20 verifications per 10 minutes
    const userLimit = checkUserRateLimit(userId, 'verify_report', 20, 10 * 60 * 1000);
    if (!userLimit.allowed) {
      set.status = 429;
      return { error: 'Too many verifications. Slow down.', retryAfter: userLimit.retryAfter };
    }

    if (!UUID_RE.test(params.id)) {
      set.status = 400;
      return { success: false, error: 'Invalid report ID.' };
    }

    try {
      // All mutations for one vote happen atomically. Status transitions are
      // COUNT-based and consensus-driven — a single vote can never resolve or
      // reject a report on its own (the old code let one "invalid" vote mark
      // ANY report resolved, a trivial censorship/vandalism vector).
      // image_url values of any report that transitions to 'rejected' are
      // collected here and cleaned up from Storj AFTER the tx commits (10A.6).
      const imagesToDelete: string[] = [];
      const outcome = await sql.begin(async (tx: any) => {
        // Prevent self-verification of one's own report.
        const [rpt] = await tx`SELECT creator_id, status FROM reports WHERE id = ${params.id}`;
        if (!rpt) return { notFound: true };
        if (rpt.creator_id && rpt.creator_id === userId) {
          return { selfVote: true };
        }

        // Record the vote. UNIQUE(report_id, verifier_id) blocks double voting.
        await tx`
          INSERT INTO verifications (report_id, verifier_id, is_valid)
          VALUES (${params.id}, ${userId}, ${isValid})
        `;

        // Recount from the source of truth rather than trusting a cached counter.
        const [counts] = await tx`
          SELECT
            COUNT(*) FILTER (WHERE is_valid) AS valid,
            COUNT(*) FILTER (WHERE NOT is_valid) AS invalid
          FROM verifications
          WHERE report_id = ${params.id}
        `;
        const validCount = Number(counts.valid);
        const invalidCount = Number(counts.invalid);

        // Keep the denormalised counter in sync with real "valid" votes.
        await tx`UPDATE reports SET verification_count = ${validCount} WHERE id = ${params.id}`;

        // Consensus thresholds (require 3 concurring votes either way).
        const CONSENSUS = 3;
        if (validCount >= CONSENSUS) {
          const [opened] = await tx`
            UPDATE reports SET status = 'open'
            WHERE id = ${params.id} AND status = 'pending_verification'
            RETURNING creator_id
          `;
          // Notify the reporter that their report cleared verification (Track 4).
          if (opened?.creator_id) {
            await tx`
              INSERT INTO report_status_events (report_id, actor_id, from_status, to_status, note)
              VALUES (${params.id}, ${userId}, 'pending_verification', 'open', 'community verified')
            `;
            if (opened.creator_id !== userId) {
              await tx`
                INSERT INTO notifications (user_id, type, title, body, report_id)
                VALUES (${opened.creator_id}, 'verified', 'Your report is now live! 📍',
                  'The community verified your report — it is now visible on the map.', ${params.id})
              `;
            }
          }
        } else if (invalidCount >= CONSENSUS) {
          // Community judged the report invalid → reject (not "resolved").
          // Capture the image_url before the status flip so we can clean up
          // the Storj object after the transaction commits (10A.6).
          const [rejected] = await tx`
            UPDATE reports SET status = 'rejected'
            WHERE id = ${params.id} AND status IN ('pending_verification', 'open')
            RETURNING image_url
          `;
          if (rejected?.image_url) {
            imagesToDelete.push(rejected.image_url);
          }
        }

        // Credit the verifier by their Clerk ID (users.clerk_id, not users.id).
        await tx`
          UPDATE users
          SET reports_verified = reports_verified + 1, trust_score = trust_score + 20
          WHERE clerk_id = ${userId}
        `;

        return { validCount, invalidCount };
      });

      if ((outcome as any).notFound) {
        set.status = 404;
        return { success: false, error: 'Report not found' };
      }
      if ((outcome as any).selfVote) {
        set.status = 403;
        return { success: false, error: 'You cannot verify your own report.' };
      }

      // 10A.6: best-effort cleanup of rejected-report images from Storj. Done
      // AFTER the transaction commits so a rolled-back vote never deletes an
      // image for a report that wasn't actually rejected. Failures are logged
      // but never fail the request — the row is already rejected.
      for (const imgUrl of imagesToDelete) {
        storage.deleteImage(imgUrl).catch((e) =>
          logger.warn('Failed to delete rejected-report image', { error: String(e) }),
        );
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
      // userId accepted for backward-compat but ignored; identity is from the token.
      userId: t.Optional(t.String()),
      isValid: t.Boolean()
    })
  })

  // ─── Resolve / Progress (closes the accountability loop) ──────
  // Consensus "is it fixed?" voting, mirroring /verify. A user upserts a single
  // vote: 'working' (I saw work happening) or 'fixed' (this is resolved).
  //   • distinct 'working' >= 2  AND status = 'open'                 → 'in_progress'
  //   • distinct 'fixed'   >= 3  AND status IN ('open','in_progress') → 'resolved'
  // One actor can never resolve alone (needs 3 concurring 'fixed'). Every
  // transition is logged to report_status_events and notifies the reporter.
  .post('/api/reports/:id/resolve', async ({ params, body, set, request }) => {
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to update an issue' };
    }
    const userId = auth.userId!;

    const userLimit = checkUserRateLimit(userId, 'resolve_report', 30, 10 * 60 * 1000);
    if (!userLimit.allowed) {
      set.status = 429;
      return { error: 'Too many updates. Slow down.', retryAfter: userLimit.retryAfter };
    }

    if (!UUID_RE.test(params.id)) {
      set.status = 400;
      return { success: false, error: 'Invalid report ID.' };
    }

    const vote = body.vote;

    try {
      const outcome = await sql.begin(async (tx: any) => {
        const [rpt] = await tx`SELECT creator_id, status FROM reports WHERE id = ${params.id}`;
        if (!rpt) return { notFound: true };
        // Only actionable while the issue is live. pending/rejected/resolved are terminal here.
        if (!['open', 'in_progress'].includes(rpt.status)) {
          return { badState: true, status: rpt.status };
        }

        // Upsert the user's latest assessment (they may go working → fixed later).
        await tx`
          INSERT INTO resolutions (report_id, user_id, vote)
          VALUES (${params.id}, ${userId}, ${vote})
          ON CONFLICT (report_id, user_id)
          DO UPDATE SET vote = EXCLUDED.vote, updated_at = NOW()
        `;

        const [counts] = await tx`
          SELECT
            COUNT(*) FILTER (WHERE vote = 'working') AS working,
            COUNT(*) FILTER (WHERE vote = 'fixed')   AS fixed
          FROM resolutions
          WHERE report_id = ${params.id}
        `;
        const workingCount = Number(counts.working);
        const fixedCount = Number(counts.fixed);

        // Pure, unit-tested transition decision (see lib/resolution.ts).
        const decided = nextResolutionStatus(rpt.status, workingCount, fixedCount);
        let newStatus: string | null = null;
        if (decided === 'resolved') {
          const [row] = await tx`
            UPDATE reports SET status = 'resolved', updated_at = NOW()
            WHERE id = ${params.id} AND status IN ('open', 'in_progress')
            RETURNING status
          `;
          if (row) newStatus = 'resolved';
        } else if (decided === 'in_progress') {
          const [row] = await tx`
            UPDATE reports SET status = 'in_progress', updated_at = NOW()
            WHERE id = ${params.id} AND status = 'open'
            RETURNING status
          `;
          if (row) newStatus = 'in_progress';
        }

        // Credit the voter's civic contribution (like /verify credits verifiers).
        await tx`
          UPDATE users
          SET integrations_helped = integrations_helped + 1, trust_score = trust_score + 5
          WHERE clerk_id = ${userId}
        `;

        if (newStatus) {
          await tx`
            INSERT INTO report_status_events (report_id, actor_id, from_status, to_status, note)
            VALUES (${params.id}, ${userId}, ${rpt.status}, ${newStatus}, ${'community consensus'})
          `;
          if (newStatus === 'resolved' && rpt.creator_id) {
            // Reward the reporter for getting their issue fixed, and notify them.
            await tx`
              UPDATE users SET trust_score = trust_score + 25 WHERE clerk_id = ${rpt.creator_id}
            `;
            if (rpt.creator_id !== userId) {
              await tx`
                INSERT INTO notifications (user_id, type, title, body, report_id)
                VALUES (${rpt.creator_id}, 'resolved', 'Your report was resolved! ✓',
                  'The community confirmed your reported issue has been fixed.', ${params.id})
              `;
            }
          } else if (newStatus === 'in_progress' && rpt.creator_id && rpt.creator_id !== userId) {
            await tx`
              INSERT INTO notifications (user_id, type, title, body, report_id)
              VALUES (${rpt.creator_id}, 'in_progress', 'Work has started on your report 🚧',
                'A citizen reported that work is underway on your issue.', ${params.id})
            `;
          }
        }

        return { status: newStatus || rpt.status, workingCount, fixedCount };
      });

      if ((outcome as any).notFound) {
        set.status = 404;
        return { success: false, error: 'Report not found' };
      }
      if ((outcome as any).badState) {
        set.status = 409;
        return { success: false, error: `Issue is ${(outcome as any).status} and can no longer be updated.` };
      }

      return { success: true, ...(outcome as any) };
    } catch {
      set.status = 500;
      return { success: false, error: 'Failed to record your update.' };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ vote: t.Union([t.Literal('working'), t.Literal('fixed')]) })
  })

  // ─── Draft a complaint / escalation for a report (Track 2) ────
  // Turns passive "wall of shame" into action: produces a formal complaint the
  // citizen can email their MLA or share. AI-drafted when a key is set, else a
  // strong deterministic template. Also returns the MLA's contact so the client
  // can build a mailto:. Records the escalation for pressure metrics.
  .post('/api/reports/:id/complaint', async ({ params, set, request }) => {
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to file a complaint' };
    }
    const userId = auth.userId!;

    const limit = checkUserRateLimit(userId, 'complaint', 15, 10 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { error: 'Too many complaints drafted. Slow down.', retryAfter: limit.retryAfter };
    }

    if (!UUID_RE.test(params.id)) {
      set.status = 400;
      return { error: 'Invalid report ID.' };
    }

    try {
      const [r] = await sql`
        SELECT title, category, custom_category, agency, ward_name, mla_name, mp_name,
               sanctioned_budget, upvotes,
               ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
               EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400 AS days_open
        FROM reports WHERE id = ${params.id}
      `;
      if (!r) {
        set.status = 404;
        return { error: 'Report not found' };
      }

      // Best-effort contact lookup: the report denormalizes mla_name; join mlas
      // for a real phone/email where available.
      let mlaEmail: string | null = null;
      let mlaPhone: string | null = null;
      if (r.mla_name) {
        const [m] = await sql`SELECT email, contact FROM mlas WHERE name = ${r.mla_name} LIMIT 1`;
        if (m) { mlaEmail = m.email || null; mlaPhone = m.contact || null; }
      }

      const complaint = await draftComplaint({
        title: r.title,
        category: r.category,
        customCategory: r.custom_category,
        ward: r.ward_name,
        mla: r.mla_name,
        mp: r.mp_name,
        agency: r.agency,
        sanctionedBudget: r.sanctioned_budget,
        latitude: r.latitude,
        longitude: r.longitude,
        daysOpen: r.days_open != null ? Math.floor(Number(r.days_open)) : null,
        upvotes: r.upvotes,
      });

      // Log the escalation (fire-and-forget semantics; failure must not block the draft).
      try {
        await sql`INSERT INTO escalations (report_id, user_id, channel) VALUES (${params.id}, ${userId}, 'draft')`;
      } catch (e) {
        logger.warn('Failed to log escalation', { error: String(e) });
      }

      return {
        subject: complaint.subject,
        body: complaint.body,
        source: complaint.source,
        recipient: {
          mlaName: r.mla_name || null,
          mlaEmail,
          mlaPhone,
          agency: r.agency || null,
        },
      };
    } catch (err) {
      logger.error('Failed to draft complaint', { error: String(err) });
      set.status = 500;
      return { error: 'Failed to draft complaint' };
    }
  }, {
    params: t.Object({ id: t.String() })
  })

  // ─── AI photo analysis (Track 3) ─────────────
  // Suggests category + severity from an uploaded photo so reporting is faster.
  // Analysis only — does NOT store the image (the report-submit path does that).
  // Returns { suggestion: null } when no vision model/key is available so the
  // client falls back to manual selection.
  .post('/api/reports/analyze-image', async ({ body, set, request }) => {
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required' };
    }
    const userId = auth.userId!;
    const limit = checkUserRateLimit(userId, 'analyze_image', 20, 10 * 60 * 1000);
    if (!limit.allowed) {
      set.status = 429;
      return { error: 'Too many analyses. Slow down.', retryAfter: limit.retryAfter };
    }

    const image = (body as any)?.image;
    if (!(image instanceof File)) {
      set.status = 400;
      return { error: 'An image file is required.' };
    }
    const MAX_SIZE = 10 * 1024 * 1024;
    if (image.size > MAX_SIZE) {
      set.status = 400;
      return { error: 'Image too large. Maximum 10MB allowed.' };
    }
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(image.type)) {
      set.status = 400;
      return { error: 'Invalid image type. Only JPEG, PNG, and WebP allowed.' };
    }
    const buf = Buffer.from(await image.arrayBuffer());
    if (!validateImageMagicBytes(buf, image.type)) {
      set.status = 400;
      return { error: 'Image content does not match declared type.' };
    }

    try {
      const dataUrl = `data:${image.type};base64,${buf.toString('base64')}`;
      const suggestion = await analyzeCivicImage(dataUrl);
      return { suggestion }; // null when no vision model configured → client stays manual
    } catch (err) {
      logger.warn('Image analysis failed', { error: String(err) });
      return { suggestion: null };
    }
  }, {
    body: t.Object({ image: t.Any() })
  })

  // ─── Nearby reports (duplicate detection, Track 3) ──
  // Pure spatial lookup so citizens can add their voice to an existing report
  // instead of fragmenting pressure with a duplicate. No auth (read-only).
  .get('/api/reports/nearby', async ({ query, set, store }) => {
    const reqId = (store as any).requestId;
    const lat = parseFloat(query.lat as string);
    const lng = parseFloat(query.lng as string);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      set.status = 400;
      return { error: 'Valid lat & lng required.' };
    }
    // Default 75 m; clamp to a sane range so this can't become a wide scan.
    let radius = parseFloat(query.radius as string);
    if (isNaN(radius)) radius = 75;
    radius = Math.max(10, Math.min(radius, 500));
    const category = typeof query.category === 'string' && query.category ? query.category : null;

    try {
      const rows = await sql`
        SELECT id, title, category, status, upvotes,
               ROUND(ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)::numeric, 1) AS distance_m
        FROM reports
        WHERE status IN ('pending_verification', 'open', 'in_progress')
          AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radius})
          AND (${category}::text IS NULL OR category = ${category})
        ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) ASC
        LIMIT 5
      `;
      return {
        nearby: rows.map((r: any) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          status: r.status,
          upvotes: r.upvotes,
          distanceM: Number(r.distance_m),
        })),
      };
    } catch (err) {
      logger.error('Nearby lookup failed', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to find nearby reports', requestId: reqId };
    }
  })

  // ─── Notifications (Track 4) ─────────────────
  .get('/api/notifications', async ({ set, request, store }) => {
    const reqId = (store as any).requestId;
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required' };
    }
    try {
      const rows = await sql`
        SELECT id, type, title, body, report_id, is_read, created_at
        FROM notifications
        WHERE user_id = ${auth.userId}
        ORDER BY created_at DESC
        LIMIT 50
      `;
      const [c] = await sql`
        SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = ${auth.userId} AND is_read = FALSE
      `;
      return {
        unread: c?.unread || 0,
        notifications: rows.map((n: any) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          reportId: n.report_id,
          isRead: n.is_read,
          createdAt: n.created_at,
        })),
      };
    } catch (err) {
      logger.error('Failed to load notifications', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load notifications', requestId: reqId };
    }
  })

  .post('/api/notifications/read', async ({ body, set, request }) => {
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required' };
    }
    try {
      const ids = (body as any)?.ids;
      if (Array.isArray(ids) && ids.length > 0) {
        const numeric = ids.map((x: any) => Number(x)).filter((x: number) => Number.isInteger(x));
        await sql`UPDATE notifications SET is_read = TRUE WHERE user_id = ${auth.userId} AND id = ANY(${numeric})`;
      } else {
        // No ids → mark all read.
        await sql`UPDATE notifications SET is_read = TRUE WHERE user_id = ${auth.userId} AND is_read = FALSE`;
      }
      return { success: true };
    } catch (err) {
      logger.error('Failed to mark notifications read', { error: String(err) });
      set.status = 500;
      return { error: 'Failed to update notifications' };
    }
  }, {
    body: t.Optional(t.Object({ ids: t.Optional(t.Array(t.Number())) }))
  })

  // ─── My Reports (richer, with timeline; Track 4) ──
  .get('/api/reports/mine', async ({ set, request, store }) => {
    const reqId = (store as any).requestId;
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required' };
    }
    try {
      const reports = await sql`
        SELECT id, title, category, custom_category, status, severity, agency, ward_name, mla_name,
               upvotes, verification_count,
               (SELECT COUNT(*) FROM resolutions rz WHERE rz.report_id = reports.id AND rz.vote = 'fixed')::int AS fixed_count,
               ST_Y(location::geometry) AS latitude, ST_X(location::geometry) AS longitude,
               created_at
        FROM reports
        WHERE creator_id = ${auth.userId}
        ORDER BY created_at DESC
        LIMIT 100
      `;
      const ids = reports.map((r: any) => r.id);
      let events: any[] = [];
      if (ids.length > 0) {
        events = await sql`
          SELECT report_id, from_status, to_status, note, created_at
          FROM report_status_events
          WHERE report_id = ANY(${ids})
          ORDER BY created_at ASC
        `;
      }
      const byReport: Record<string, any[]> = {};
      for (const e of events) {
        (byReport[e.report_id] ||= []).push({
          fromStatus: e.from_status, toStatus: e.to_status, note: e.note, createdAt: e.created_at,
        });
      }
      return {
        reports: reports.map((r: any) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          customCategory: r.custom_category,
          status: r.status,
          severity: r.severity,
          agency: r.agency,
          ward: r.ward_name,
          mla: r.mla_name,
          upvotes: r.upvotes,
          verificationCount: r.verification_count,
          fixedCount: r.fixed_count,
          latitude: r.latitude,
          longitude: r.longitude,
          timestamp: formatRelativeTime(r.created_at),
          timeline: byReport[r.id] || [],
        })),
      };
    } catch (err) {
      logger.error('Failed to load my reports', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load your reports', requestId: reqId };
    }
  })

  // ─── Leaderboard: Citizens ───────────────────
  .get('/api/leaderboard/citizens', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
      // 8.2: cache for 60s — this aggregate recomputes on every hit but changes
      // slowly, so repeat requests within the TTL skip the SQL entirely.
      const result = await withTtlCache('leaderboard:citizens', 60_000, async () => {
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
      });
      return result;
    } catch (err) {
      logger.error('Failed to load citizen leaderboard', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load leaderboard', requestId: reqId };
    }
  })

  // ─── Leaderboard: Wall of Shame ──────────────
  .get('/api/leaderboard/shame', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
      const result = await withTtlCache('leaderboard:shame', 60_000, async () => {
        const mlas = await sql`
          SELECT
            m.id,
            m.name,
            m.constituency AS ward,
            m.city,
            COUNT(CASE WHEN r.status IN ('open', 'in_progress') THEN 1 END) AS unresolved_count,
            COUNT(CASE WHEN r.status = 'resolved' THEN 1 END) AS resolved_count
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
            resolvedCount: Number(m.resolved_count) || 0,
            rank: i + 1,
          })),
        };
      });
      return result;
    } catch (err) {
      logger.error('Failed to load wall of shame', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load leaderboard', requestId: reqId };
    }
  })

  // ─── Civic Health (real data for LiveabilityDashboard; Track 4) ──
  // Aggregates reports per constituency into a livability picture: totals,
  // status mix, resolution rate, and the best/worst areas. Pure SQL (cached).
  .get('/api/civic-health', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
      const result = await withTtlCache('civic-health', 120_000, async () => {
        const areas = await sql`
          SELECT
            COALESCE(NULLIF(ward_name, ''), 'Unknown') AS area,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status IN ('open', 'in_progress'))::int AS unresolved,
            COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved
          FROM reports
          WHERE status <> 'pending_verification' AND status <> 'rejected'
          GROUP BY COALESCE(NULLIF(ward_name, ''), 'Unknown')
          HAVING COUNT(*) >= 1
        `;

        const scored = areas.map((a: any) => {
          const total = Number(a.total);
          const resolved = Number(a.resolved);
          // Livability score: resolution rate, lightly penalised by open volume.
          const resolutionRate = total > 0 ? resolved / total : 0;
          const score = Math.round(resolutionRate * 100);
          return {
            area: a.area,
            total,
            unresolved: Number(a.unresolved),
            resolved,
            resolutionRate: Math.round(resolutionRate * 100),
            score,
          };
        });

        const best = [...scored].sort((x, y) => y.score - x.score || y.total - x.total).slice(0, 5);
        const worst = [...scored].sort((x, y) => x.score - y.score || y.unresolved - x.unresolved).slice(0, 5);

        const [totals] = await sql`
          SELECT
            COUNT(*) FILTER (WHERE status IN ('open','in_progress'))::int AS unresolved,
            COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
            COUNT(*) FILTER (WHERE status <> 'pending_verification' AND status <> 'rejected')::int AS total
          FROM reports
        `;

        return {
          summary: {
            total: totals?.total || 0,
            unresolved: totals?.unresolved || 0,
            resolved: totals?.resolved || 0,
            resolutionRate: totals && totals.total > 0 ? Math.round((totals.resolved / totals.total) * 100) : 0,
          },
          best,
          worst,
        };
      });
      return result;
    } catch (err) {
      logger.error('Failed to load civic health', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load civic health', requestId: reqId };
    }
  })

  // ─── Trending News ───────────────────────────
  .get('/api/news/trending', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
      const result = await withTtlCache('news:trending', 60_000, async () => {
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
      });
      return result;
    } catch (err) {
      logger.error('Failed to load trending news', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load trending news', requestId: reqId };
    }
  })

  // ─── All News ────────────────────────────────
  .get('/api/news', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
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
    } catch (err) {
      logger.error('Failed to load news', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load news', requestId: reqId };
    }
  })

  // ─── Local News (Alias) ──────────────────────
  .get('/api/local-news', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
      const news = await sql`
        SELECT id, headline, url, source, snippet, city, published_at
        FROM local_news
        WHERE confidence_score >= 40
        ORDER BY published_at DESC
        LIMIT 50
      `;
      return { news };
    } catch (err) {
      logger.error('Failed to load local news', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load local news', requestId: reqId };
    }
  })

  // ─── MLAs ────────────────────────────────────
  .get('/api/mlas', async ({ set, store }) => {
    const reqId = (store as any).requestId;
    try {
      const mlas = await sql`
        SELECT id, name, party, constituency, city, state, contact, email, is_incorrect, latitude, longitude
        FROM mlas
        ORDER BY city, name
      `;
      return { mlas };
    } catch (err) {
      logger.error('Failed to load MLAs', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load MLAs', requestId: reqId };
    }
  })

  .post('/api/mlas/:id/flag', async ({ params, set, request }) => {
    // Auth: Require authenticated user to flag MLAs
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to flag MLA details' };
    }

    // Per-user rate limit: cap flagging to curb abuse/mass-flagging.
    const flagLimit = checkUserRateLimit(auth.userId!, 'flag_mla', 20, 10 * 60 * 1000);
    if (!flagLimit.allowed) {
      set.status = 429;
      return { error: 'Too many flags. Slow down.', retryAfter: flagLimit.retryAfter };
    }

    const { id } = params;
    // mlas.id is an integer (SERIAL); reject non-numeric ids before querying.
    if (!/^\d+$/.test(id)) {
      set.status = 400;
      return { error: 'Invalid MLA id.' };
    }
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

    // Per-user rate limit: this endpoint can CREATE placeholder MLA rows, so it
    // is a data-pollution vector without a cap.
    const flagLimit = checkUserRateLimit(auth.userId!, 'flag_mla', 20, 10 * 60 * 1000);
    if (!flagLimit.allowed) {
      set.status = 429;
      return { error: 'Too many flags. Slow down.', retryAfter: flagLimit.retryAfter };
    }

    const { name, constituency } = body as any;
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.length > 100) {
      set.status = 400;
      return { error: 'A valid MLA name (2-100 chars) is required' };
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

  .get('/api/users/volunteers/constituency/:constituency', async ({ params, set, request, store }) => {
    const reqId = (store as any).requestId;
    // Auth: Require authenticated user to view volunteer PII
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to view volunteer details' };
    }

    const { constituency } = params;
    try {
      // Only expose non-PII fields to other authenticated users. These stat
      // columns are already public via the citizen leaderboard; the referral
      // modal needs them to compute each volunteer's points/level (otherwise
      // everyone renders as "0 Pts" with the lowest badge and undefined keys).
      const volunteers = await sql`
        SELECT id, display_name, job_title, avatar_url,
               reports_published, reports_verified, integrations_helped
        FROM users
        WHERE home_constituency = ${constituency}
        ORDER BY created_at ASC
        LIMIT 5
      `;
      return { volunteers };
    } catch (err) {
      logger.error('Failed to load volunteers', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load volunteers', requestId: reqId };
    }
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

    const { type, data, submitterEmail } = body;
    // SECURITY: attribute the submission to the verified token subject, not a
    // client-supplied submittedBy (which fed the anti-spam rate limiter and the
    // points system — spoofable to frame others or dodge limits).
    const submittedBy = auth.userId!;

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
      // submittedBy accepted for backward-compat but ignored; from the token.
      submittedBy: t.Optional(t.String()),
      submitterEmail: t.Optional(t.Union([t.String(), t.Null()]))
    })
  })

  // ─── Volunteer System: Get Pending ────────────
  .get('/api/volunteer/pending', async ({ set, request, store }) => {
    const reqId = (store as any).requestId;
    // Auth: Require authenticated user to see pending queue
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to view pending submissions' };
    }

    try {
      const pending = await getPendingSubmissions(50);
      return { submissions: pending };
    } catch (err) {
      logger.error('Failed to load pending submissions', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load pending submissions', requestId: reqId };
    }
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

    // SECURITY: bind the synced row to the verified token subject, not a body
    // field. Trusting body.clerkId let an authenticated user create/overwrite
    // the profile row of any other Clerk ID.
    const clerkId = auth.userId!;
    const { displayName, avatarUrl, email } = body;

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
      // clerkId accepted for backward-compat but ignored; identity is from the token.
      clerkId: t.Optional(t.String()),
      displayName: t.Optional(t.Union([t.String(), t.Null()])),
      avatarUrl: t.Optional(t.Union([t.String(), t.Null()])),
      email: t.Optional(t.Union([t.String(), t.Null()]))
    })
  })

  // ─── Get User by Clerk ID ────────────────────
  .get('/api/users/clerk/:clerkId', async ({ params, set, request, store }) => {
    const reqId = (store as any).requestId;
    // SECURITY: Require auth to prevent PII enumeration
    const auth = await verifyAuth(request);
    if (!requireAuth(auth, set)) {
      return { error: 'Authentication required to view user profiles' };
    }

    try {
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

      // Only expose PII (email + home location) to the user themselves.
      const isOwner = auth.userId === params.clerkId;
      if (!isOwner) {
        // Strip email AND home_* location fields for non-owners — leaking a
        // citizen's home constituency/city/state is a real-world safety issue.
        const { email, home_constituency, home_city, home_state, ...safeUser } = user as any;
        return { user: safeUser };
      }
      return { user };
    } catch (err) {
      logger.error('Failed to load user profile', { error: String(err), requestId: reqId });
      set.status = 500;
      return { error: 'Failed to load user profile', requestId: reqId };
    }
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
        -- Only stringify when socials is actually provided. JSON.stringify(null)
        -- yields the jsonb value 'null' (NOT SQL NULL), which defeats COALESCE
        -- and silently wipes a user's saved socials on any update that omits it.
        socials = COALESCE(${socials ? JSON.stringify(socials) : null}, socials),
        home_constituency = COALESCE(${homeConstituency || null}, home_constituency),
        home_city = COALESCE(${homeCity || null}, home_city),
        home_state = COALESCE(${homeState || null}, home_state)
      WHERE clerk_id = ${params.clerkId}
    `;

    return { success: true };
  })

  // NOTE: The legacy UUID-based user routes (POST /api/users, PUT /api/users/:id,
  // GET /api/users/:id) were removed. They allowed IDOR — any authenticated user
  // could overwrite any profile by UUID since there was no ownership check, and
  // there is no safe mapping from a Clerk token to an arbitrary internal UUID.
  // All profile access now goes through the Clerk-scoped routes above
  // (GET/PUT /api/users/clerk/:clerkId), which enforce ownership.

  // ─── Global error handler ────────────────────
  .onError(({ error, set, store }) => {
    const reqId = (store as any)?.requestId;
    logger.error('Unhandled API error', { error: String(error), requestId: reqId });
    set.status = 500;
    return { error: 'Internal server error', requestId: reqId };
  })

  // ─── Start Server ────────────────────────────
  .listen({ port: env.PORT, hostname: '0.0.0.0' });

logger.info('FixIndia.org API running', { port: app.server?.port });

// ─── Graceful shutdown ─────────────────────────
// On SIGTERM/SIGINT (e.g. PM2 reload), stop accepting new connections, drain
// the DB pool, then exit cleanly so in-flight requests finish and connections
// are not leaked.
async function shutdown(signal: string) {
  logger.info('Shutting down public API', { signal });
  try {
    app.stop();
  } catch (e) {
    logger.warn('Error stopping server', { error: String(e) });
  }
  try {
    await sql.end({ timeout: 5 });
  } catch (e) {
    logger.warn('Error closing DB pool', { error: String(e) });
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ═══════════════════════════════════════════════
// SCHEDULED SCRAPING (OFF-PEAK HOURS: 3 AM - 8 AM IST)
// ═══════════════════════════════════════════════

// ─── Enhanced News Scraper: 3 AM, 5 AM, 7 AM ───
cron.schedule(SCRAPING_SCHEDULE.news.cron, async () => {
  logger.info(`[Cron] ${SCRAPING_SCHEDULE.news.description}`);
  try {
    const count = await runEnhancedNewsScraper();
    logger.info('[Cron] Enhanced news scraper done', { count });
  } catch (e) {
    logger.error('[Cron] Enhanced news scraper failed', { error: String(e) });
  }
});

// ─── Multi-City MLA Scraper: 4 AM every Sunday ───
cron.schedule(SCRAPING_SCHEDULE.mla.cron, async () => {
  logger.info(`[Cron] ${SCRAPING_SCHEDULE.mla.description}`);
  try {
    const count = await runMultiCityMLAScraper();
    logger.info('[Cron] Multi-city MLA scraper done', { count });
  } catch (e) {
    logger.error('[Cron] Multi-city MLA scraper failed', { error: String(e) });
  }
});

// ─── Government Projects: 6 AM every Monday ───
cron.schedule(SCRAPING_SCHEDULE.government.cron, async () => {
  logger.info(`[Cron] ${SCRAPING_SCHEDULE.government.description}`);
  try {
    const count = await runProjectScraper();
    logger.info('[Cron] Government projects scraper done', { count });
  } catch (e) {
    logger.error('[Cron] Government projects scraper failed', { error: String(e) });
  }
});

logger.info('Scheduled scrapers configured', {
  news: SCRAPING_SCHEDULE.news.cron,
  mlas: SCRAPING_SCHEDULE.mla.cron,
  projects: SCRAPING_SCHEDULE.government.cron,
});

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
