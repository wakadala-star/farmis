const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { env } = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');

const app = express();

app.disable('x-powered-by');

// Credentialed CORS — only origins listed in CLIENT_ORIGIN may send cookies.
app.use(
  cors({
    origin: env.clientOrigins,
    credentials: true,
  }),
);

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'farmis-api' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);

// Unknown routes → JSON 404 (not an HTML page).
app.use((req, res) => {
  res.status(404).json({ ok: false, message: `Not found: ${req.method} ${req.originalUrl}` });
});

// Central error handler — hides stack traces in production.
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  const message =
    env.isProd ? 'Internal server error.' : (err.message || 'Internal server error.');
  res.status(err.status || 500).json({ ok: false, message });
});

module.exports = app;
