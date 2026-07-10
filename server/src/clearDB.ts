import sql from './db';

/**
 * DANGER: irreversibly wipes core tables. Guarded so it cannot run by accident
 * (e.g. an fat-fingered `bun src/clearDB.ts` against production).
 *
 * Run with:  CONFIRM_CLEAR=yes bun src/clearDB.ts
 * Refuses to run when NODE_ENV=production.
 */
async function clear() {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to clear the database: NODE_ENV=production.');
    process.exit(1);
  }
  if (process.env.CONFIRM_CLEAR !== 'yes') {
    console.error('❌ Refusing to clear the database. Re-run with CONFIRM_CLEAR=yes to proceed.');
    process.exit(1);
  }

  console.log('🧹 Clearing data from database...');
  try {
    // Fixed table name: the news table is `local_news`, not `news_items`.
    await sql`TRUNCATE TABLE reports, local_news, users, upvotes, verifications CASCADE;`;
    console.log('✅ All data cleared successfully.');
  } catch (error) {
    console.error('❌ Failed to clear data:', error);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

clear();
