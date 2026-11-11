const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { query } = require('../db/pool');
const { departmentName } = require('../db/departments');
const { setAuthCookie, clearAuthCookie } = require('../middleware/auth');
const { logAuthAttempt } = require('../db/audit');

const BCRYPT_ROUNDS = 10;
const ROLES = ['owner', 'supervisor', 'worker'];
const SIGNUP_DEPARTMENTS = ['crops', 'livestock'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Collect validation problems for the signup payload. */
function validateSignup(body) {
  const errors = [];
  const fullName = String(body.fullName ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const role = String(body.role ?? '');
  const department = body.department == null ? null : String(body.department);

  if (fullName.length < 2) errors.push('Full name must be at least 2 characters.');
  if (!EMAIL_RE.test(email) || email.length > 120) errors.push('A valid email address is required.');
  if (password.length < 6) errors.push('Password must be at least 6 characters.');
  if (!ROLES.includes(role)) errors.push('Role must be owner, supervisor or worker.');

  // Department only applies to supervisors and workers, and the signup
  // form only offers the two departmental screens (crops / livestock).
  if (role === 'supervisor' || role === 'worker') {
    if (!SIGNUP_DEPARTMENTS.includes(department)) {
      errors.push('Please choose a department (crops or livestock).');
    }
  }

  return { errors, fullName, email, password, role, department };
}

/** Derive a unique username from the email local part (schema needs one). */
async function uniqueUsername(email) {
  const base = (email.split('@')[0] || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 50) || 'user';

  let candidate = base;
  for (let i = 1; i <= 50; i++) {
    const { rows } = await query('SELECT 1 FROM users WHERE username = $1', [candidate]);
    if (rows.length === 0) return candidate;
    candidate = `${base}-${i}`.slice(0, 60);
  }
  return `${base}-${Date.now()}`.slice(0, 60);
}

/**
 * POST /api/auth/signup
 *
 * Open signup for supervisors and workers (crops/livestock only).
 * Owners: the first owner may self-register (bootstrap); after that an
 * owner account can only be created by an authenticated owner.
 */
async function signup(req, res, next) {
  try {
    const { errors, fullName, email, password, role, department } = validateSignup(req.body ?? {});
    if (errors.length > 0) {
      logAuthAttempt('signup', 'failure', { email, reason: 'validation', ip: req.ip });
      return res.status(400).json({ ok: false, message: errors.join(' ') });
    }

    if (role === 'owner') {
      const { rows } = await query(
        `SELECT EXISTS (
           SELECT 1 FROM users u
           JOIN roles r ON r.role_id = u.role_id
           WHERE r.role_name = 'owner'
         ) AS has_owner`,
      );
      const hasOwner = rows[0].has_owner;
      const callerIsOwner = req.user?.role === 'owner';
      if (hasOwner && !callerIsOwner) {
        logAuthAttempt('signup', 'failure', { email, reason: 'owner_closed', ip: req.ip });
        return res.status(403).json({
          ok: false,
          message: 'Owner accounts are created by an existing farm owner.',
        });
      }
    }

    const { rows: existing } = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (existing.length > 0) {
      logAuthAttempt('signup', 'failure', { email, reason: 'duplicate_email', ip: req.ip });
      return res.status(409).json({
        ok: false,
        message: 'An account with this email already exists.',
      });
    }

    const [firstName, ...rest] = fullName.split(/\s+/);
    const lastName = rest.join(' ');
    const username = await uniqueUsername(email);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows: roleRows } = await query('SELECT role_id FROM roles WHERE role_name = $1', [role]);
    const roleId = roleRows[0].role_id;

    let departmentId = null;
    if (role !== 'owner') {
      const { rows: deptRows } = await query(
        'SELECT department_id FROM departments WHERE department_name = $1',
        [departmentName(department)],
      );
      departmentId = deptRows[0]?.department_id ?? null;
    }

    const { rows } = await query(
      `INSERT INTO users (role_id, department_id, first_name, last_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING user_id`,
      [roleId, departmentId, firstName, lastName, username, email, passwordHash],
    );

    logAuthAttempt('signup', 'success', { email, userId: rows[0].user_id, ip: req.ip });

    return res.status(201).json({
      ok: true,
      message: 'Account created successfully.',
      userId: String(rows[0].user_id),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/signin
 * Verifies credentials and issues the httpOnly JWT cookie.
 */
async function signin(req, res, next) {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!email || !password) {
      logAuthAttempt('signin', 'failure', { email: email || null, reason: 'validation', ip: req.ip });
      return res.status(400).json({ ok: false, message: 'Email and password are required.' });
    }

    const { rows } = await query(
      `SELECT u.user_id, u.first_name, u.last_name, u.email, u.password_hash,
              u.employment_status, r.role_name, d.department_name
         FROM users u
         JOIN roles r      ON r.role_id = u.role_id
         LEFT JOIN departments d ON d.department_id = u.department_id
        WHERE lower(u.email) = $1`,
      [email],
    );
    const user = rows[0];

    const badCredentials = { ok: false, message: 'Incorrect email or password.' };
    if (!user) {
      logAuthAttempt('signin', 'failure', { email, reason: 'unknown_email', ip: req.ip });
      return res.status(401).json(badCredentials);
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      logAuthAttempt('signin', 'failure', { email, userId: user.user_id, reason: 'bad_password', ip: req.ip });
      return res.status(401).json(badCredentials);
    }

    if (user.employment_status !== 'active') {
      logAuthAttempt('signin', 'failure', { email, userId: user.user_id, reason: 'inactive_account', ip: req.ip });
      return res.status(403).json({ ok: false, message: 'This account is inactive. Contact the farm owner.' });
    }

    const token = jwt.sign(
      { sub: String(user.user_id), role: user.role_name },
      env.jwt.secret,
      { expiresIn: env.jwt.ttl },
    );
    setAuthCookie(res, token);
    logAuthAttempt('signin', 'success', { email, userId: user.user_id, ip: req.ip });

    const session = {
      id: String(user.user_id),
      fullName: `${user.first_name} ${user.last_name}`.trim(),
      email: user.email,
      role: user.role_name,
      department: user.department_name
        ? (user.department_name === 'Crop Production' ? 'crops'
          : user.department_name === 'Animal Rearing' ? 'livestock'
          : null)
        : null,
    };

    return res.json({ ok: true, message: `Welcome back, ${session.fullName}.`, session });
  } catch (err) {
    next(err);
  }
}

/** POST /api/auth/signout — clears the auth cookie. */
function signout(_req, res) {
  clearAuthCookie(res);
  res.json({ ok: true, message: 'Signed out.' });
}

/** GET /api/auth/me — the current session, re-read from the database. */
function me(req, res) {
  res.json({ ok: true, session: req.user });
}

module.exports = { signup, signin, signout, me, uniqueUsername };
