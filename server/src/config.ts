// Environment variable validation + centralized, typed access.
//
// Every static env var the app reads is parsed/ defaulted ONCE here into the
// frozen `env` object. Call sites import `env.X` instead of `process.env.X` so
// a typo or a missing var is caught at startup rather than at the call site.
// `validateEnv()` stays as the fail-fast startup gate (called from index.ts /
// admin.ts). Dynamic env-var reads (e.g. llm.ts reads `process.env[<name from
// DB>]`) are intentionally NOT centralized — the name is data, not config.

function parseBool(v: string | undefined, def = false): boolean {
  if (v === undefined) return def;
  return v === 'true' || v === '1' || v === 'yes';
}

function parseInt(v: string | undefined, def: number): number {
  const n = v === undefined ? NaN : Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const requiredEnvVars = [
  'DATABASE_URL',
  'STORJ_BUCKET',
  'STORJ_ENDPOINT',
  'STORJ_ACCESS_KEY',
  'STORJ_SECRET_KEY',
  'GROQ_API_KEYS',
];

const optionalEnvVars = [
  'OPENROUTER_API_KEYS',
  'ADMIN_KEY',
  'NODE_ENV',
];

export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',

  // Ports
  PORT: parseInt(process.env.PORT, 6969),
  ADMIN_PORT: parseInt(process.env.ADMIN_PORT, 6970),

  // Database
  DATABASE_URL: process.env.DATABASE_URL || '',

  // Security — credentials use getters so they always read the LIVE value.
  // This keeps all reads centralized in config.ts (per 6.1) while still
  // supporting runtime rotation and tests that set process.env.ADMIN_KEY.
  get ADMIN_KEY() { return process.env.ADMIN_KEY || ''; },
  get ADMIN_SQL_ENABLED() { return parseBool(process.env.ADMIN_SQL_ENABLED, false); },

  // Clerk
  get CLERK_SECRET_KEY() { return process.env.CLERK_SECRET_KEY || ''; },

  // Cloudflare Access (admin SSO)
  get CLOUDFLARE_TEAM_DOMAIN() { return process.env.CLOUDFLARE_TEAM_DOMAIN || ''; },
  get CLOUDFLARE_AUD() { return process.env.CLOUDFLARE_AUD || ''; },

  // Storj DCS (S3-compatible object storage)
  STORJ_BUCKET: process.env.STORJ_BUCKET || '',
  STORJ_ENDPOINT: process.env.STORJ_ENDPOINT || 'https://gateway.storjshare.io',
  STORJ_ACCESS_KEY: process.env.STORJ_ACCESS_KEY || '',
  STORJ_SECRET_KEY: process.env.STORJ_SECRET_KEY || '',

  // AI providers (comma-separated for rotation)
  GROQ_API_KEYS: process.env.GROQ_API_KEYS || '',
  OPENROUTER_API_KEYS: process.env.OPENROUTER_API_KEYS || '',

  // Observability
  LOG_LEVEL: (process.env.LOG_LEVEL || 'info').toLowerCase(),
});

export function validateEnv() {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Clerk secret key is required in production, recommended/optional in development
  const actualRequired = [...requiredEnvVars];
  if (env.isProduction) {
    actualRequired.push('CLERK_SECRET_KEY');
  } else if (!env.CLERK_SECRET_KEY) {
    warnings.push('CLERK_SECRET_KEY');
  }

  // Check required variables
  for (const varName of actualRequired) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // Check optional but recommended variables
  for (const varName of optionalEnvVars) {
    if (!process.env[varName]) {
      warnings.push(varName);
    }
  }

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
    console.error('\nCopy .env.example to .env and fill in the values.');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('⚠️  Optional environment variables not set:');
    warnings.forEach(v => console.warn(`   - ${v}`));
  }

  // Validate DATABASE_URL format
  const dbUrl = env.DATABASE_URL;
  if (dbUrl && !dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    console.error('❌ DATABASE_URL must start with postgresql:// or postgres://');
    process.exit(1);
  }

  // Validate ADMIN_KEY length in production
  if (env.isProduction && env.ADMIN_KEY) {
    if (env.ADMIN_KEY.length < 32) {
      console.error('❌ ADMIN_KEY must be at least 32 characters in production');
      console.error('   Generate with: openssl rand -hex 32');
      process.exit(1);
    }
  }

  console.log('✅ Environment variables validated');
}
