/**
 * Apply pending migrations only (no seeds).
 * Run: npm run migrate
 */
const { runMigrations } = require('../db/migrate');
const { pool } = require('../db/pool');

runMigrations()
  .then(() => pool.end())
  .catch((err) => {
    console.error('[migrate] failed:', err.message);
    process.exitCode = 1;
    return pool.end().catch(() => {});
  });
