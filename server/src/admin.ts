/* eslint-disable @typescript-eslint/no-explicit-any */
import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import sql from './db';
import { runMigrations } from './migrate';
import { verifyAdminAuth } from './admin_auth';
import { clearModelCache } from './llm';
import { adminVerifySubmission } from './volunteer_system';
import { runEnhancedNewsScraper } from './enhanced_scraper';
import { runMultiCityMLAScraper } from './multi_city_mla_scraper';
import { runProjectScraper } from './project_scraper';
import { securityHeaders, generateFingerprint, checkRateLimit, getClientIP } from './security';
import { logger } from './lib/logger';
import { env } from './config';
import cron from 'node-cron';


// Run database migrations on startup. Shared with the public API and serialized
// via a Postgres advisory lock, so the two processes can start concurrently.
try {
  logger.info('[Admin API] Running schema updates...');
  await runMigrations();
  logger.info('[Admin API] Schema updates complete (including audit log).');
} catch (err) {
  logger.error('[Admin API] Failed to run admin schema updates', { error: String(err) });
}

// SECURITY H2: Environment-based CORS for admin panel
const ALLOWED_ADMIN_ORIGINS = env.isProduction
  ? ['https://md.enjoyxd.eu.org']
  : ['http://localhost:3000', 'http://localhost:5173', 'https://md.enjoyxd.eu.org'];

// SECURITY: Scrub secret-looking columns from any row returned to the client.
// Matches column names containing key/secret/token/password (case-insensitive).
const SECRET_COLUMN_RE = /(api_key|secret|password|passwd|token|access_key)/i;
function redactSecretColumns(row: any): any {
  if (!row || typeof row !== 'object') return row;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = SECRET_COLUMN_RE.test(k) && v != null ? '[redacted]' : v;
  }
  return out;
}

// SECURITY H5: Audit logging helper
async function logAdminAction(email: string, action: string, details?: any, ip?: string) {
  try {
    await sql`
      INSERT INTO admin_audit_log (admin_email, action, details, ip_address)
      VALUES (${email}, ${action}, ${JSON.stringify(details || null)}, ${ip || 'unknown'})
    `;
  } catch (err) {
    logger.error('[Audit Log] Failed to write audit entry', { error: String(err) });
  }
}

const adminApp = new Elysia()
  .use(cors({
    origin: ALLOWED_ADMIN_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'cf-access-jwt-assertion', 'X-Admin-Key'],
    credentials: true,
  }))

  // ─── Security Headers (10B.2) ─────────────────────────
  // The public API sets these; the admin API previously did not. Reuse the same
  // hardened header set so admin responses get HSTS / frame-options / CSP too.
  .onAfterHandle(({ set }) => {
    Object.entries(securityHeaders).forEach(([key, value]) => {
      set.headers[key] = value;
    });
  })

  // ─── Admin rate limiting (10B.2) ──────────────────────
  // Stricter than the public API: it's a small, known set of operators. This
  // adds brute-force resistance to the ADMIN_KEY fallback path.
  .onBeforeHandle(({ request, set }) => {
    const fingerprint = generateFingerprint(request);
    // Tighter limits: 60 req/min per fingerprint for the admin surface.
    const result = checkRateLimit(fingerprint, 60, 60_000);
    if (!result.allowed) {
      set.status = 429;
      set.headers['Retry-After'] = String(result.retryAfter || 60);
      return { error: 'Too many admin requests. Slow down.', retryAfter: result.retryAfter };
    }
  })

  // ─── Health Check (liveness — Public, no DB) ────────────────────────────
  .get('/health', () => ({ status: 'ok', service: 'admin-api', timestamp: new Date().toISOString() }))

  // ─── Readiness Check (verifies the DB) ──────────────────────────────────
  .get('/health/ready', async ({ set }) => {
    try {
      const ping = sql`SELECT 1 as ok`;
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('DB ping timed out')), 2000),
      );
      await Promise.race([ping, timeout]);
      return { status: 'ready', service: 'admin-api', timestamp: new Date().toISOString() };
    } catch (err) {
      logger.error('[Admin API] Readiness check failed', { error: String(err) });
      set.status = 503;
      return { status: 'degraded', service: 'admin-api', timestamp: new Date().toISOString() };
    }
  })

  // ─── Guard: Authenticate all other routes + Audit Log ──────────────
  .onBeforeHandle(async ({ request, set }) => {
    // Exclude health checks
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health' || pathname === '/health/ready') return;

    const auth = await verifyAdminAuth(request);
    if (!auth.authenticated) {
      set.status = 401;
      return { error: auth.error || 'Unauthorized. Valid Cloudflare Access JWT or Admin Key required.' };
    }

    // SECURITY H5: Log every authenticated admin action
    const ip = getClientIP(request);
    logAdminAction(
      auth.email || 'unknown',
      `${request.method} ${pathname}`,
      undefined,
      ip
    );
  })

  // ─── Metrics Dashboard ────────────────────────────────
  .get('/api/admin/metrics', async ({ set }) => {
    try {
      const memory = process.memoryUsage();

      // Table counts
      const [userCount] = await sql`SELECT count(*)::integer FROM users`;
      const [reportCount] = await sql`SELECT count(*)::integer FROM reports`;
      const [newsCount] = await sql`SELECT count(*)::integer FROM local_news`;
      const [mlaCount] = await sql`SELECT count(*)::integer FROM mlas`;
      const [flaggedMlas] = await sql`SELECT count(*)::integer FROM mlas WHERE is_incorrect = TRUE`;
      const [pendingCount] = await sql`SELECT count(*)::integer FROM pending_verifications WHERE status = 'pending'`;

      // Status breakdown for reports
      const reportBreakdown = await sql`
        SELECT status, count(*)::integer as count 
        FROM reports 
        GROUP BY status
      `;

      return {
        system: {
          uptime: process.uptime(),
          memory: {
            heapUsed: Math.round(memory.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memory.heapTotal / 1024 / 1024),
            rss: Math.round(memory.rss / 1024 / 1024),
          },
          nodeVersion: process.version,
        },
        counts: {
          users: userCount.count,
          reports: reportCount.count,
          news: newsCount.count,
          mlas: mlaCount.count,
          flaggedMlas: flaggedMlas.count,
          pendingVerifications: pendingCount.count,
        },
        reportStatusBreakdown: reportBreakdown.reduce((acc: any, curr: any) => {
          acc[curr.status] = curr.count;
          return acc;
        }, {}),
      };
    } catch (err) {
      logger.error('[Admin API] Failed to load metrics', { error: String(err) });
      set.status = 500;
      return { error: 'Failed to load metrics' };
    }
  })

  // ─── Volunteer Moderation ─────────────────────────────
  .get('/api/admin/volunteer/pending', async ({ set }) => {
    try {
      const pending = await sql`
        SELECT id, data_type, raw_data, submitted_by, submitter_email, verification_count, required_verifications, created_at
        FROM pending_verifications
        WHERE status = 'pending'
        ORDER BY created_at DESC
      `;
      return { submissions: pending };
    } catch (err) {
      logger.error('[Admin API] Failed to load pending volunteer submissions', { error: String(err) });
      set.status = 500;
      return { error: 'Failed to load pending submissions' };
    }
  })

  .post('/api/admin/volunteer/:action/:id', async ({ params, set }) => {
    const { action, id } = params;
    const isApprove = action === 'approve';

    if (action !== 'approve' && action !== 'reject') {
      set.status = 400;
      return { error: 'Invalid action. Must be approve or reject.' };
    }

    try {
      await adminVerifySubmission(id, isApprove);
      return { success: true, message: `Submission ${isApprove ? 'approved' : 'rejected'} successfully.` };
    } catch (e: any) {
      set.status = 500;
      return { error: e.message || 'Verification execution failed' };
    }
  }, {
    params: t.Object({
      action: t.String(),
      id: t.String(),
    })
  })

  // ─── AI Configuration CRUD ─────────────────────────────
  .get('/api/admin/ai-models', async ({ set }) => {
    try {
      const models = await sql`
        SELECT id, name, provider, model_string, api_key, api_key_env_var, api_endpoint, priority, is_enabled, is_free, created_at, updated_at
        FROM ai_models
        ORDER BY priority ASC
      `;
      // SECURITY: Mask API keys — never send full secrets to frontend
      const maskedModels = (models as any[]).map((m: any) => ({
        ...m,
        api_key: m.api_key ? `••••••••${m.api_key.slice(-4)}` : null,
      }));
      return { models: maskedModels };
    } catch (err) {
      logger.error('[Admin API] Failed to load AI models', { error: String(err) });
      set.status = 500;
      return { error: 'Failed to load AI models' };
    }
  })

  .post('/api/admin/ai-models', async ({ body, set }) => {
    const { name, provider, modelString, apiKey, apiKeyEnvVar, apiEndpoint, priority, isEnabled, isFree } = body;

    try {
      const [newModel] = await sql`
        INSERT INTO ai_models (
          name, provider, model_string, api_key, api_key_env_var, api_endpoint, priority, is_enabled, is_free
        ) VALUES (
          ${name}, ${provider}, ${modelString}, ${apiKey || null}, ${apiKeyEnvVar}, ${apiEndpoint || null}, 
          ${priority || 1}, ${isEnabled !== false}, ${isFree !== false}
        ) RETURNING id, name
      `;
      
      clearModelCache();
      return { success: true, model: newModel };
    } catch (e: any) {
      set.status = 500;
      return { error: e.message || 'Failed to create AI model' };
    }
  }, {
    body: t.Object({
      name: t.String(),
      provider: t.String(),
      modelString: t.String(),
      apiKey: t.Optional(t.Union([t.String(), t.Null()])),
      apiKeyEnvVar: t.String(),
      apiEndpoint: t.Optional(t.Union([t.String(), t.Null()])),
      priority: t.Optional(t.Numeric()),
      isEnabled: t.Optional(t.Boolean()),
      isFree: t.Optional(t.Boolean()),
    })
  })

  .put('/api/admin/ai-models/:id', async ({ params, body, set }) => {
    const { id } = params;
    const { name, provider, modelString, apiKey, apiKeyEnvVar, apiEndpoint, priority, isEnabled, isFree } = body;

    // SECURITY (10B.5): An empty/absent apiKey means "leave unchanged", NEVER
    // "clear". The panel never round-trips full keys; it only sends a new key
    // when the operator is actively rotating one.
    const keyProvided = typeof apiKey === 'string' && apiKey.trim().length > 0;

    try {
      const [updatedModel] = await sql`
        UPDATE ai_models SET
          name = ${name},
          provider = ${provider},
          model_string = ${modelString},
          api_key = ${keyProvided ? apiKey : sql`api_key`},
          api_key_env_var = ${apiKeyEnvVar},
          api_endpoint = ${apiEndpoint || null},
          priority = ${priority},
          is_enabled = ${isEnabled},
          is_free = ${isFree},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, name
      `;

      if (!updatedModel) {
        set.status = 404;
        return { error: 'Model not found' };
      }

      clearModelCache();
      return { success: true, model: updatedModel };
    } catch (e: any) {
      set.status = 500;
      return { error: e.message || 'Failed to update AI model' };
    }
  }, {
    params: t.Object({ id: t.Numeric() }),
    body: t.Object({
      name: t.String(),
      provider: t.String(),
      modelString: t.String(),
      apiKey: t.Optional(t.Union([t.String(), t.Null()])),
      apiKeyEnvVar: t.String(),
      apiEndpoint: t.Optional(t.Union([t.String(), t.Null()])),
      priority: t.Numeric(),
      isEnabled: t.Boolean(),
      isFree: t.Boolean(),
    })
  })

  .delete('/api/admin/ai-models/:id', async ({ params, set }) => {
    const { id } = params;

    try {
      const [deleted] = await sql`
        DELETE FROM ai_models WHERE id = ${id} RETURNING id, name
      `;

      if (!deleted) {
        set.status = 404;
        return { error: 'Model not found' };
      }

      clearModelCache();
      return { success: true, message: `Model ${deleted.name} deleted.` };
    } catch (e: any) {
      set.status = 500;
      return { error: e.message || 'Failed to delete AI model' };
    }
  }, {
    params: t.Object({ id: t.Numeric() })
  })

  // ─── Scraper Run Logs & Triggers ──────────────────────
  .get('/api/admin/scrapers', async ({ set }) => {
    try {
      const runs = await sql`
        SELECT id, scraper_type, status, items_processed, error_message, started_at, completed_at
        FROM scraper_runs
        ORDER BY started_at DESC
        LIMIT 20
      `;
      return { runs };
    } catch (err) {
      logger.error('[Admin API] Failed to load scraper runs', { error: String(err) });
      set.status = 500;
      return { error: 'Failed to load scraper runs' };
    }
  })

  .post('/api/admin/scrapers/run/:type', async ({ params, set }) => {
    const { type } = params;

    if (type !== 'news' && type !== 'mla' && type !== 'projects') {
      set.status = 400;
      return { error: 'Invalid scraper type. Must be news, mla, or projects.' };
    }

    // Trigger run asynchronously to avoid HTTP timeouts
    runScraperAsync(type).catch(err => {
      logger.error('[Admin Scraper] Asynchronous scraper run failed', { type, error: String(err) });
    });

    return { success: true, message: `Manual run for scraper '${type}' has been queued.` };
  }, {
    params: t.Object({ type: t.String() })
  })

  // ─── Database Shell / Query Executor (READ-ONLY) ──────────────────
  // SECURITY: This is a powerful primitive. Even read-only, an admin key leak
  // turns it into "dump the entire database". It is therefore:
  //   1. Disabled unless ADMIN_SQL_ENABLED=true is explicitly set.
  //   2. Restricted to SELECT/EXPLAIN/SHOW/WITH, single statement, no comments.
  //   3. Blocked from reading secret columns (ai_models.api_key) and Postgres
  //      system catalogs / information_schema (which expose credentials & config).
  //   4. Result sets are scrubbed of any column that looks like a secret.
  // For anything beyond that, use a dedicated read-only DB role over psql.
  .post('/api/admin/db/query', async ({ body, set }) => {
    if (env.ADMIN_SQL_ENABLED !== true) {
      set.status = 403;
      return { success: false, error: 'The SQL shell is disabled. Set ADMIN_SQL_ENABLED=true to enable it.' };
    }

    const { query } = body;

    // Reject SQL comments outright — they are the usual way to smuggle a second
    // statement or hide keywords from the validator.
    if (/--|\/\*|\*\//.test(query)) {
      set.status = 403;
      return { success: false, error: 'SQL comments are not allowed.' };
    }

    // Single statement only (allow one optional trailing semicolon).
    if (query.replace(/;\s*$/, '').includes(';')) {
      set.status = 403;
      return { success: false, error: 'Only a single statement is allowed.' };
    }

    // Block ALL write/DDL/DCL statements and dangerous functions.
    const BLOCKED_PATTERNS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|merge|call|do|vacuum|analyze|pg_read_file|pg_write_file|pg_ls_dir|pg_sleep|lo_import|lo_export|dblink|current_setting|set_config)\b/i;
    if (BLOCKED_PATTERNS.test(query)) {
      set.status = 403;
      return { success: false, error: 'That statement or function is not permitted in the SQL shell.' };
    }

    // Block access to secret columns and system catalogs that expose credentials.
    const SENSITIVE_TARGETS = /\b(api_key|pg_shadow|pg_authid|pg_user|pg_roles|information_schema|pg_catalog|pg_settings)\b/i;
    if (SENSITIVE_TARGETS.test(query)) {
      set.status = 403;
      return { success: false, error: 'Query references a restricted table, column, or catalog.' };
    }

    // Only allow read-only statement forms.
    const trimmed = query.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('EXPLAIN') && !trimmed.startsWith('SHOW') && !trimmed.startsWith('WITH')) {
      set.status = 403;
      return { success: false, error: 'Only SELECT, EXPLAIN, SHOW, and WITH (CTE) queries are allowed.' };
    }

    try {
      // Force read-only transaction for defense-in-depth.
      const result = await sql.begin('READ ONLY', async (tx: any) => {
        return await tx.unsafe(query);
      });

      const rows = Array.isArray(result) ? result : [result];
      // Defense-in-depth: scrub any secret-looking columns from the output even
      // if a query slipped one through (e.g. SELECT * on a future table).
      const scrubbed = rows.map((row: any) => redactSecretColumns(row));

      return {
        success: true,
        rows: scrubbed,
        affected: 0,
        isWrite: false,
      };
    } catch (e: any) {
      set.status = 400;
      // Sanitize error message to prevent information leakage
      const safeError = (e.message || 'Query execution error').replace(/\/[^\s]+/g, '[path redacted]');
      return { success: false, error: safeError };
    }
  }, {
    body: t.Object({
      query: t.String(),
    })
  })

  // ─── PM2 Process Management (ADMIN) ───────────────────
  .get('/api/admin/pm2/list', async () => {
    try {
      // SECURITY: Use execFile with argument array instead of string interpolation
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('pm2', ['jlist']);
      const processes = JSON.parse(stdout);
      // Filter to return only fixindia processes in the application set
      const appSet = ['fixindia-api', 'fixindia-admin-api'];
      const filtered = processes.filter((p: any) => appSet.includes(p.name));
      
      return { 
        success: true, 
        mode: 'production',
        processes: filtered.map((p: any) => ({
          name: p.name,
          pm_id: p.pm_id,
          status: p.pm2_env?.status || 'unknown',
          uptime: p.pm2_env?.pm_uptime ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000) : 0,
          restarts: p.pm2_env?.restart_time || 0,
          cpu: p.monit?.cpu || 0,
          memory: Math.round((p.monit?.memory || 0) / 1024 / 1024),
        }))
      };
    } catch {
      // PM2 not available — return empty list
      return {
        success: true,
        mode: env.isProduction ? 'pm2-unavailable' : 'development',
        processes: []
      };
    }
  })

  .post('/api/admin/pm2/action/:action/:name', async ({ params, set, request }) => {
    const { action, name } = params;

    // SECURITY: Strict regex validation to prevent command injection
    if (!/^(start|stop|restart)$/.test(action)) {
      set.status = 400;
      return { error: 'Invalid action. Must be start, stop, or restart.' };
    }

    if (!/^fixindia-(api|admin-api)$/.test(name)) {
      set.status = 400;
      return { error: 'Invalid process name. Restricted to application set.' };
    }

    const ip = getClientIP(request);
    // Re-derive the admin identity for the detailed audit row (JWKS is cached,
    // so this is cheap). 10B.6: every PM2 action records who/what/result.
    const auth = await verifyAdminAuth(request);
    const adminEmail = auth.email || 'unknown';

    try {
      // SECURITY: Use execFile with argument array instead of string interpolation
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      await execFileAsync('pm2', [action, name]);
      logAdminAction(adminEmail, `pm2:${action}`, { process: name, result: 'success' }, ip);
      return { success: true, message: `Process ${name} ${action}ed successfully.` };
    } catch (err: any) {
      if (!env.isProduction) {
        logAdminAction(adminEmail, `pm2:${action}`, { process: name, result: 'simulated-dev' }, ip);
        return {
          success: true,
          message: `[Dev Mode] Action '${action}' simulated on process '${name}'.`
        };
      }
      logAdminAction(adminEmail, `pm2:${action}`, { process: name, result: 'failed', error: String(err) }, ip);
      set.status = 500;
      return { success: false, error: 'PM2 action failed. Check server logs.' };
    }
  }, {
    params: t.Object({
      action: t.String(),
      name: t.String(),
    })
  })

  // ─── Global error handler ─────────────────────────────
  .onError(({ error, set }) => {
    logger.error('[Admin API] Unhandled error', { error: String(error) });
    set.status = 500;
    return { error: 'Internal server error' };
  })

  .listen({ port: env.ADMIN_PORT, hostname: '0.0.0.0' });

logger.info('FixIndia.org Admin API running', { port: adminApp.server?.port });

// ─── Graceful shutdown ─────────────────────────────────
async function shutdown(signal: string) {
  logger.info('[Admin API] Shutting down', { signal });
  try {
    adminApp.stop();
  } catch (e) {
    logger.warn('[Admin API] Error stopping server', { error: String(e) });
  }
  try {
    await sql.end({ timeout: 5 });
  } catch (e) {
    logger.warn('[Admin API] Error closing DB pool', { error: String(e) });
  }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Admin audit-log retention (10B.8) ─────────────────
// Prune admin_audit_log rows older than 180 days, daily at 4:30 AM. The
// retention window is deliberately long enough to support incident review.
cron.schedule('30 4 * * *', async () => {
  try {
    await sql`DELETE FROM admin_audit_log WHERE created_at < NOW() - INTERVAL '180 days'`;
    logger.info('[Admin API] Pruned admin_audit_log entries older than 180 days');
  } catch (err) {
    logger.error('[Admin API] Failed to prune admin_audit_log', { error: String(err) });
  }
});

// Helper: Run scraper asynchronously and log output to DB
async function runScraperAsync(type: 'news' | 'mla' | 'projects') {
  logger.info('[Admin Scraper] Triggering manual run', { type });

  const [run] = await sql`
    INSERT INTO scraper_runs (scraper_type, status, started_at)
    VALUES (${type}, 'running', NOW())
    RETURNING id
  `;

  try {
    let processed = 0;
    if (type === 'news') {
      processed = await runEnhancedNewsScraper();
    } else if (type === 'mla') {
      processed = await runMultiCityMLAScraper();
    } else if (type === 'projects') {
      processed = await runProjectScraper();
    }

    await sql`
      UPDATE scraper_runs
      SET status = 'success', items_processed = ${processed}, completed_at = NOW()
      WHERE id = ${run.id}
    `;
    logger.info('[Admin Scraper] Manual run successful', { type, processed });
  } catch (err: any) {
    logger.error('[Admin Scraper] Manual run failed', { type, error: String(err) });
    await sql`
      UPDATE scraper_runs
      SET status = 'failed', error_message = ${err.message || 'Unknown error'}, completed_at = NOW()
      WHERE id = ${run.id}
    `;
  }
}
