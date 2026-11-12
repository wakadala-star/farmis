const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { env } = require('./config/env');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const tasksRoutes = require('./routes/tasks.routes');
const attendanceRoutes = require('./routes/attendance.routes');
const entriesRoutes = require('./routes/entries.routes');
const reportsRoutes = require('./routes/reports.routes');
const transactionsRoutes = require('./routes/transactions.routes');
const ownerRoutes = require('./routes/owner.routes');
const salesRoutes = require('./routes/sales.routes');
const cropsRoutes = require('./routes/crops.routes');
const livestockRoutes = require('./routes/livestock.routes');
const customersRoutes = require('./routes/customers.routes');
const expensesRoutes = require('./routes/expenses.routes');
const inventoryRoutes = require('./routes/inventory.routes');

const app = express();

app.disable('x-powered-by');

// Behind Render's reverse proxy: the X-Forwarded-For chain ends with an
// internal (private) hop, so trust private ranges too — req.ip then walks
// back to the real client address instead of the proxy's.
app.set('trust proxy', ['loopback', 'uniquelocal']);

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
app.use('/api/tasks', tasksRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/entries', entriesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/crops', cropsRoutes);
app.use('/api/livestock', livestockRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/inventory', inventoryRoutes);

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
