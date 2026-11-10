const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode } = require('../db/departments');

const router = Router();

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

module.exports = router;
