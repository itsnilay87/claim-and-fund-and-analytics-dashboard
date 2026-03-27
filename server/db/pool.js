/**
 * PostgreSQL connection pool
 *
 * Reads DATABASE_URL from environment.
 * Falls back to a local dev default so the server can boot without .env.
 */
const { Pool } = require('pg');

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://cap_user:cap_dev_pass@localhost:5432/claim_analytics';

const pool = new Pool({
  connectionString: DATABASE_URL,
  min: 2,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

/**
 * Convenience wrapper — same signature as pool.query but easier to import.
 */
async function query(text, params) {
  return pool.query(text, params);
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[DB] SIGTERM received — draining pool');
  await pool.end();
});

module.exports = { pool, query };
