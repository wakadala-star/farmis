const { Router } = require('express');
const bcrypt = require('bcrypt');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode, departmentName } = require('../db/departments');
const { uniqueUsername } = require('../controllers/auth.controller');

const router = Router();

const BCRYPT_ROUNDS = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SIGNUP_DEPARTMENTS = ['crops', 'livestock'];

/**
 * GET /api/users — demonstrates role + department authorization.
 *
 *   owner      → every user on the farm
 *   supervisor → only users in their own department (crops / livestock)
 *   worker     → 403
 */
router.get('/', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const { role, department, id } = req.user;

    let sql = `SELECT u.user_id, u.first_name, u.last_name, u.email, u.phone,
                      u.employment_status, u.hire_date, u.created_at,
                      r.role_name, d.department_name
                 FROM users u
                 JOIN roles r      ON r.role_id = u.role_id
                 LEFT JOIN departments d ON d.department_id = u.department_id`;
    const params = [];

    if (role === 'supervisor') {
      // Scope to the supervisor's own department.
      sql += `
        JOIN users su ON su.user_id = $1
       WHERE u.department_id = su.department_id
         AND u.department_id IS NOT NULL`;
      params.push(id);
    }
    sql += ' ORDER BY u.user_id';

    const { rows } = await query(sql, params);

    res.json({
      ok: true,
      users: rows.map((row) => ({
        id: String(row.user_id),
        fullName: `${row.first_name} ${row.last_name}`.trim(),
        email: row.email,
        phone: row.phone,
        role: row.role_name,
        department: departmentCode(row.department_name),
        employmentStatus: row.employment_status,
        hireDate: row.hire_date,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/users — recruit a person into the farm.
 * Body: { name, email, password } (+ role / department for owners).
 *
 *   supervisor → always creates an ACTIVE WORKER in their own department
 *                (the "Recruit a Worker" screen; the supervisor chooses
 *                the initial password and passes it on)
 *   owner      → may create a worker or supervisor in a chosen department
 */
router.post('/', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');

    const errors = [];
    if (name.length < 2) errors.push('Enter the full name (at least 2 characters).');
    if (!EMAIL_RE.test(email) || email.length > 120) errors.push('A valid email address is required.');
    if (password.length < 6) errors.push('Password must be at least 6 characters.');
    if (errors.length) return res.status(400).json({ ok: false, message: errors.join(' ') });

    // Supervisors always create workers in their own department; owners
    // pick the role and department (worker/supervisor only — owners are
    // created through signup with an owner session).
    let role = 'worker';
    let department = req.user.department;
    if (req.user.role === 'owner') {
      role = ['worker', 'supervisor'].includes(String(body.role ?? ''))
        ? String(body.role)
        : 'worker';
      department = body.department == null ? null : String(body.department);
    } else {
      if (!department) {
        return res.status(403).json({ ok: false, message: 'No department is assigned to your account.' });
      }
    }
    if (role !== 'owner' && !SIGNUP_DEPARTMENTS.includes(department)) {
      return res.status(400).json({ ok: false, message: 'Please choose a department (crops or livestock).' });
    }

    const { rows: existing } = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (existing.length > 0) {
      return res.status(409).json({ ok: false, message: 'An account with this email already exists.' });
    }

    const [firstName, ...rest] = name.split(/\s+/);
    const lastName = rest.join(' ');
    const username = await uniqueUsername(email);
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows: roleRows } = await query('SELECT role_id FROM roles WHERE role_name = $1', [role]);
    const { rows: deptRows } = await query(
      'SELECT department_id FROM departments WHERE department_name = $1',
      [departmentName(department)],
    );

    const { rows } = await query(
      `INSERT INTO users (role_id, department_id, first_name, last_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING user_id, created_at`,
      [roleRows[0].role_id, deptRows[0]?.department_id ?? null, firstName, lastName, username, email, passwordHash],
    );

    return res.status(201).json({
      ok: true,
      message: `Account created for ${name}.`,
      user: {
        id: String(rows[0].user_id),
        name,
        email,
        role,
        department,
        joined: rows[0].created_at,
      },
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /api/users/:id — remove someone from the team by DEACTIVATING
 * the account (employment_status → 'inactive'). History stays intact and
 * signin already refuses inactive accounts, so this is reversible later.
 *
 *   supervisor → workers of their own department only
 *   owner      → anyone except owners
 */
router.delete('/:id', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, message: 'Invalid user id.' });

    const { rows } = await query(
      `SELECT u.user_id, u.first_name, u.last_name, u.employment_status,
              u.department_id, r.role_name
         FROM users u
         JOIN roles r ON r.role_id = u.role_id
        WHERE u.user_id = $1::bigint`,
      [id],
    );
    const target = rows[0];

    const inScope =
      target &&
      String(target.user_id) !== String(req.user.id) && // never yourself
      (req.user.role === 'owner'
        ? target.role_name !== 'owner'
        : target.role_name === 'worker' &&
          target.department_id != null &&
          String(target.department_id) === String(req.user.departmentId));

    if (!target || !inScope) {
      return res.status(404).json({ ok: false, message: 'That person is not on your team.' });
    }
    if (target.employment_status !== 'active') {
      return res.status(409).json({ ok: false, message: 'That account is already inactive.' });
    }

    await query("UPDATE users SET employment_status = 'inactive' WHERE user_id = $1::bigint", [id]);

    const fullName = `${target.first_name} ${target.last_name}`.trim();
    return res.json({ ok: true, message: `${fullName} was removed from the team.` });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
