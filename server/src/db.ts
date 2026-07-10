import postgres from 'postgres';
import { env } from './config';

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const sql = postgres(env.DATABASE_URL, {
  max: 20, // Increased for better concurrency
  idle_timeout: 300, // 5 minutes
  connect_timeout: 10,
  max_lifetime: 3600, // Rotate connections hourly
  onnotice: () => {}, // Suppress notices
  transform: {
    undefined: null, // Handle undefined gracefully
  },
});

export default sql;
