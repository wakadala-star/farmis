const { Pool } = require('pg');
const { env } = require('../config/env');

// DATABASE_URL (Neon/Render) wins when present; PG* vars are for local dev.
const pool = env.pg.connectionString
  ? new Pool({ connectionString: env.pg.connectionString })
  : new Pool({
      host: env.pg.host,
      port: env.pg.port,
      user: env.pg.user,
      password: env.pg.password,
      database: env.pg.database,
    });

pool.on('error', (err) => {
  console.error('[pg] unexpected pool error:', err.message);
});

/** Thin wrapper so callers never need the pool directly. */
function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
