const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode } = require('../db/departments');
const { toIsoDate } = require('../db/dates');

const router = Router();

/** DB task_status → the frontend's chip vocabulary. */
const TASK_STATUS = {
  pending: 'open',
  'in_progress': 'in-progress',
  completed: 'done',
};

/**
 * GET /api/tasks/mine — tasks assigned to the signed-in user.
 * Cancelled tasks are hidden; statuses map to open / in-progress / done.
 */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT t.task_id, t.title, t.description, t.due_date, t.task_status,
              u.first_name || ' ' || u.last_name AS assignee,
              d.department_name
         FROM tasks t
         JOIN users u ON u.user_id = t.assigned_to
         LEFT JOIN departments d ON d.department_id = t.department_id
        WHERE t.assigned_to = $1
          AND t.task_status <> 'cancelled'
        ORDER BY t.due_date ASC NULLS LAST, t.task_id ASC`,
      [req.user.id],
    );

    res.json({
      ok: true,
      tasks: rows.map((row) => ({
        id: String(row.task_id),
        title: row.title,
        notes: row.description ?? '',
        dept: departmentCode(row.department_name),
        assignee: row.assignee,
        due: row.due_date ? toIsoDate(row.due_date) : '',
        status: TASK_STATUS[row.task_status] ?? 'open',
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
