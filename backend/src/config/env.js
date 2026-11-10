const path = require('path');

// Load .env from the backend root regardless of the current directory.
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

/** Parse values like '7d', '12h', '30m', '45s' into milliseconds. */
function ttlToMs(ttl, fallbackMs) {
  const match = /^(\d+)([smhd])$/.exec(String(ttl || '').trim());
  if (!match) return fallbackMs;
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Number(match[1]) * units[match[2]];
}

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'change-me-to-a-long-random-string') {
  throw new Error('JWT_SECRET is missing or still the placeholder — set it in backend/.env');
}

const nodeEnv = process.env.NODE_ENV || 'development';

// Comma-separated list of allowed browser origins (credentialed CORS).
const clientOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const env = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: Number(process.env.PORT) || 4000,
  clientOrigins,

  pg: {
    // Neon/Render-style deployments provide a single DATABASE_URL;
    // local development uses the individual PG* variables instead.
    connectionString: process.env.DATABASE_URL || null,
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'mukwasi_agri_business',
  },

  jwt: {
    secret: jwtSecret,
    ttl: process.env.JWT_TTL || '7d',
    ttlMs: ttlToMs(process.env.JWT_TTL, 7 * 86_400_000),
  },

  cookieName: process.env.COOKIE_NAME || 'farmis_token',
};

module.exports = { env };
