/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment */
import { Elysia, t } from 'elysia';
import { cors } from '@elysiajs/cors';
import sql from './db';
import { verifyAdminAuth } from './admin_auth';
import { clearModelCache } from './llm';
import { adminVerifySubmission } from './volunteer_system';
import { runEnhancedNewsScraper } from './enhanced_scraper';
import { runMultiCityMLAScraper } from './multi_city_mla_scraper';
import { runProjectScraper } from './project_scraper';


// Run database migrations on startup to support scraper logging + audit logging
try {
  console.log('🔄 [Admin API] Running schema updates for admin services...');
  await sql`
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
  // SECURITY H5: Audit log table for all admin actions
  await sql`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id SERIAL PRIMARY KEY,
      admin_email TEXT NOT NULL,
      action TEXT NOT NULL,
      details JSONB,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at DESC)
  `;
  console.log('✓ [Admin API] Schema updates complete (including audit log).');
} catch (err) {
  console.error('❌ [Admin API] Failed to run admin schema updates:', err);
}

// SECURITY H2: Environment-based CORS for admin panel
const ALLOWED_ADMIN_ORIGINS = process.env.NODE_ENV === 'production'
  ? ['https://md.enjoyxd.eu.org']
  : ['http://localhost:3000', 'http://localhost:5173', 'https://md.enjoyxd.eu.org'];

// SECURITY H5: Audit logging helper
async function logAdminAction(email: string, action: string, details?: any, ip?: string) {
  try {
    await sql`
      INSERT INTO admin_audit_log (admin_email, action, details, ip_address)
      VALUES (${email}, ${action}, ${JSON.stringify(details || null)}, ${ip || 'unknown'})
    `;
  } catch (err) {
    console.error('[Audit Log] Failed to write audit entry:', err);
  }
}

const adminApp = new Elysia()
  .use(cors({
    origin: ALLOWED_ADMIN_ORIGINS,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'cf-access-jwt-assertion', 'X-Admin-Key'],
    credentials: true,
  }))

  // ─── Health Check (Public) ────────────────────────────
  .get('/health', () => ({ status: 'ok', service: 'admin-api', timestamp: new Date().toISOString() }))

  // ─── Guard: Authenticate all other routes + Audit Log ──────────────
  .onBeforeHandle(async ({ request, set }) => {
    // Exclude /health check
    const pathname = new URL(request.url).pathname;
    if (pathname === '/health') return;

    const auth = await verifyAdminAuth(request);
    if (!auth.authenticated) {
      set.status = 401;
      return { error: auth.error || 'Unauthorized. Valid Cloudflare Access JWT or Admin Key required.' };
    }

    // SECURITY H5: Log every authenticated admin action
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
               request.headers.get('cf-connecting-ip') || 'unknown';
    logAdminAction(
      auth.email || 'unknown',
      `${request.method} ${pathname}`,
      undefined,
      ip
    );
  })

  // ─── Metrics Dashboard ────────────────────────────────
  .get('/api/admin/metrics', async () => {
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
  })

  // ─── Volunteer Moderation ─────────────────────────────
  .get('/api/admin/volunteer/pending', async () => {
    const pending = await sql`
      SELECT id, data_type, raw_data, submitted_by, submitter_email, verification_count, required_verifications, created_at
      FROM pending_verifications
      WHERE status = 'pending'
      ORDER BY created_at DESC
    `;
    return { submissions: pending };
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
  .get('/api/admin/ai-models', async () => {
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

    try {
      const [updatedModel] = await sql`
        UPDATE ai_models SET
          name = ${name},
          provider = ${provider},
          model_string = ${modelString},
          api_key = ${apiKey || null},
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
  .get('/api/admin/scrapers', async () => {
    const runs = await sql`
      SELECT id, scraper_type, status, items_processed, error_message, started_at, completed_at
      FROM scraper_runs
      ORDER BY started_at DESC
      LIMIT 20
    `;
    return { runs };
  })

  .post('/api/admin/scrapers/run/:type', async ({ params, set }) => {
    const { type } = params;

    if (type !== 'news' && type !== 'mla' && type !== 'projects') {
      set.status = 400;
      return { error: 'Invalid scraper type. Must be news, mla, or projects.' };
    }

    // Trigger run asynchronously to avoid HTTP timeouts
    runScraperAsync(type).catch(err => {
      console.error(`[Admin Scraper] Asynchronous scraper run for ${type} failed:`, err);
    });

    return { success: true, message: `Manual run for scraper '${type}' has been queued.` };
  }, {
    params: t.Object({ type: t.String() })
  })

  // ─── Database Shell / Query Executor (READ-ONLY) ──────────────────
  .post('/api/admin/db/query', async ({ body, set }) => {
    const { query } = body;

    // SECURITY: Block ALL write/DDL/DCL statements
    const BLOCKED_PATTERNS = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|pg_read_file|pg_write_file|lo_import|lo_export)\b/i;
    if (BLOCKED_PATTERNS.test(query)) {
      set.status = 403;
      return { success: false, error: 'Write operations are not allowed through the admin SQL shell. Use direct database access for modifications.' };
    }

    // Additional safety: only allow SELECT and common read-only commands
    const trimmed = query.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('EXPLAIN') && !trimmed.startsWith('SHOW') && !trimmed.startsWith('WITH')) {
      set.status = 403;
      return { success: false, error: 'Only SELECT, EXPLAIN, SHOW, and WITH (CTE) queries are allowed.' };
    }

    try {
      // Force read-only transaction for defense-in-depth
      const result = await sql.begin('READ ONLY', async (tx: any) => {
        return await tx.unsafe(query);
      });
      
      return {
        success: true,
        rows: Array.isArray(result) ? result : [result],
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
        mode: process.env.NODE_ENV === 'production' ? 'pm2-unavailable' : 'development',
        processes: []
      };
    }
  })

  .post('/api/admin/pm2/action/:action/:name', async ({ params, set }) => {
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

    try {
      // SECURITY: Use execFile with argument array instead of string interpolation
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFileAsync = promisify(execFile);
      await execFileAsync('pm2', [action, name]);
      return { success: true, message: `Process ${name} ${action}ed successfully.` };
    } catch (err: any) {
      if (process.env.NODE_ENV !== 'production') {
        return { 
          success: true, 
          message: `[Dev Mode] Action '${action}' simulated on process '${name}'.` 
        };
      }
      set.status = 500;
      return { success: false, error: 'PM2 action failed. Check server logs.' };
    }
  }, {
    params: t.Object({
      action: t.String(),
      name: t.String(),
    })
  })

  .listen({ port: process.env.ADMIN_PORT ? parseInt(process.env.ADMIN_PORT, 10) : 6970, hostname: '0.0.0.0' });

console.log(`🟢 FixIndia.org Admin API running at http://0.0.0.0:${adminApp.server?.port}`);

// Helper: Run scraper asynchronously and log output to DB
async function runScraperAsync(type: 'news' | 'mla' | 'projects') {
  console.log(`[Admin Scraper] Triggering manual run: ${type}`);
  
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
    console.log(`[Admin Scraper] ✓ Manual run successful: ${type} (${processed} items)`);
  } catch (err: any) {
    console.error(`[Admin Scraper] ❌ Manual run failed: ${type}`, err);
    await sql`
      UPDATE scraper_runs
      SET status = 'failed', error_message = ${err.message || 'Unknown error'}, completed_at = NOW()
      WHERE id = ${run.id}
    `;
  }
}
