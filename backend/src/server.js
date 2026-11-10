const app = require('./app');
const { env } = require('./config/env');
const { pool } = require('./db/pool');

const server = app.listen(env.port, () => {
  console.log(`[farmis-api] listening on port ${env.port} (${env.nodeEnv})`);
  if (env.pg.connectionString) {
    const url = new URL(env.pg.connectionString);
    console.log(`[farmis-api] database: ${url.user}@${url.host}${url.pathname}`);
  } else {
    console.log(`[farmis-api] database: ${env.pg.user}@${env.pg.host}:${env.pg.port}/${env.pg.database}`);
  }
  console.log(`[farmis-api] CORS origin(s): ${env.clientOrigins.join(', ')}`);
});

/** Graceful shutdown — close HTTP first, then the pg pool. */
function shutdown(signal) {
  console.log(`\n[farmis-api] ${signal} received, shutting down...`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  // Failsafe if something hangs.
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
