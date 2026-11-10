const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { query } = require('../db/pool');
const { departmentCode } = require('../db/departments');

/** Read and verify the JWT from the auth cookie (null when absent/invalid). */
function readToken(req) {
  const token = req.cookies?.[env.cookieName];
  if (!token) return null;
  try {
    return jwt.verify(token, env.jwt.secret);
  } catch {
    return null;
  }
}

/** Load the live user row for a payload (so role/status changes apply immediately). */
async function loadUser(userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.first_name, u.last_name, u.email,
            u.employment_status, r.role_name, d.department_name
       FROM users u
       JOIN roles r      ON r.role_id = u.role_id
       LEFT JOIN departments d ON d.department_id = u.department_id
      WHERE u.user_id = $1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** Shape a user row the way the frontend Session/User types expect. */
function toSession(row) {
  return {
    id: String(row.user_id),
    fullName: `${row.first_name} ${row.last_name}`.trim(),
    email: row.email,
    role: row.role_name,                        // 'owner' | 'supervisor' | 'worker'
    department: departmentCode(row.department_name), // 'crops' | 'livestock' | null
  };
}

/**
 * Attaches req.user when a valid session exists, but never rejects.
 * Used by signup so an existing owner can create another owner.
 */
async function optionalAuth(req, _res, next) {
  try {
    const payload = readToken(req);
    const row = payload ? await loadUser(payload.sub) : null;
    req.user = row && row.employment_status === 'active' ? toSession(row) : null;
  } catch {
    req.user = null;
  }
  next();
}

/** Requires a valid, active session — 401 otherwise. */
async function requireAuth(req, res, next) {
  try {
    const payload = readToken(req);
    if (!payload) {
      return res.status(401).json({ ok: false, message: 'Please sign in to continue.' });
    }
    const row = await loadUser(payload.sub);
    if (!row || row.employment_status !== 'active') {
      clearAuthCookie(res);
      return res.status(401).json({ ok: false, message: 'Session is no longer valid. Please sign in again.' });
    }
    req.user = toSession(row);
    next();
  } catch (err) {
    next(err);
  }
}

/** Restricts a route to the listed roles — 403 otherwise. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, message: 'Please sign in to continue.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        ok: false,
        message: `This action requires the ${roles.join(' or ')} role.`,
      });
    }
    next();
  };
}

// Production serves the app from GitHub Pages (*.github.io) and the API from
// Render (*.onrender.com) — a cross-site pair, so the cookie must be
// SameSite=None; Secure to be sent on credentialed XHR. Local dev stays Lax.
const cookieOptions = {
  httpOnly: true,                          // unreadable from JavaScript (XSS protection)
  sameSite: env.isProd ? 'none' : 'lax',   // cross-site in prod, same-site locally
  secure: env.isProd,                      // HTTPS-only in production
  path: '/',
};

function setAuthCookie(res, token) {
  res.cookie(env.cookieName, token, { ...cookieOptions, maxAge: env.jwt.ttlMs });
}

function clearAuthCookie(res) {
  res.clearCookie(env.cookieName, cookieOptions);
}

module.exports = {
  optionalAuth,
  requireAuth,
  requireRole,
  setAuthCookie,
  clearAuthCookie,
};
