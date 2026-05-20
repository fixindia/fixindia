// Environment variable validation
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

export function validateEnv() {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Check required variables
  for (const varName of requiredEnvVars) {
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
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && !dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    console.error('❌ DATABASE_URL must start with postgresql:// or postgres://');
    process.exit(1);
  }

  // Validate ADMIN_KEY length in production
  if (process.env.NODE_ENV === 'production' && process.env.ADMIN_KEY) {
    if (process.env.ADMIN_KEY.length < 32) {
      console.error('❌ ADMIN_KEY must be at least 32 characters in production');
      console.error('   Generate with: openssl rand -hex 32');
      process.exit(1);
    }
  }

  console.log('✅ Environment variables validated');
}
