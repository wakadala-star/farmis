const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

/**
 * Applies every pending file in db/migrations/ (sorted by filename).
 *
 * - Recorded versions live in schema_migrations — re-running is a no-op.
 * - Each file runs in its own transaction: all-or-nothing.
 * - Never drops or rewrites existing data (unlike the old schema.sql).
 */
async function runMigrations() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(200) PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  const { rows } = await pool.query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.version));

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
      ran += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  console.log(
    ran === 0
      ? '[migrate] schema up to date (nothing to apply)'
      : `[migrate] ${ran} migration(s) applied`,
  );
  return ran;
}

module.exports = { runMigrations };
