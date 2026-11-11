const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode } = require('../db/departments');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

/** DB task_status → the frontend's chip vocabulary. */
const TASK_STATUS = {
  pending: 'open',
  'in_progress': 'in-progress',
  completed: 'done',
};

/** The frontend's chip vocabulary → DB task_status (for writes). */
const STATUS_TO_DB = {
  open: 'pending',
  'in-progress': 'in_progress',
  done: 'completed',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SELECT_TASKS = `
  SELECT t.task_id, t.title, t.description, t.due_date, t.task_status,
         u.first_name || ' ' || u.last_name AS assignee,
         d.department_name
    FROM tasks t
    JOIN users u ON u.user_id = t.assigned_to
    LEFT JOIN departments d ON d.department_id = t.department_id`;

/** Map a joined task row to the frontend's FarmTask shape. */
function toTask(row) {
  return {
    id: String(row.task_id),
    title: row.title,
    notes: row.description ?? '',
    dept: departmentCode(row.department_name),
    assignee: row.assignee,
    due: row.due_date ? toIsoDate(row.due_date) : '',
    status: TASK_STATUS[row.task_status] ?? 'open',
  };
}

/**
 * GET /api/tasks/mine — tasks assigned to the signed-in user.
 * Cancelled tasks are hidden; statuses map to open / in-progress / done.
 */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `${SELECT_TASKS}
        WHERE t.assigned_to = $1
          AND t.task_status <> 'cancelled'
        ORDER BY t.due_date ASC NULLS LAST, t.task_id ASC`,
      [req.user.id],
    );
    res.json({ ok: true, tasks: rows.map(toTask) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tasks/department — every live task of the supervisor's
 * department (same mapping as /mine).
 */
router.get('/department', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    if (!req.user.departmentId) return res.json({ ok: true, tasks: [] });
    const { rows } = await query(
      `${SELECT_TASKS}
        WHERE t.department_id = $1
          AND t.task_status <> 'cancelled'
        ORDER BY t.due_date ASC NULLS LAST, t.task_id ASC`,
      [req.user.departmentId],
    );
    res.json({ ok: true, tasks: rows.map(toTask) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tasks — assign work (supervisor, own department).
 * Body: { title, assignee, due, notes? } — assignee is the worker's email.
 */
router.post('/', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const title = String(body.title ?? '').trim();
    const assignee = String(body.assignee ?? '').trim().toLowerCase();
    const due = body.due;
    const notes = String(body.notes ?? '').trim();

    const errors = [];
    if (title.length < 3 || title.length > 150) errors.push('Give the task a short title (3–150 characters).');
    if (!isIsoDate(due)) errors.push('A valid due date is required.');
    if (!EMAIL_RE.test(assignee)) errors.push('Choose the worker who will do it.');
    if (notes.length > 500) errors.push('Notes must be 500 characters or fewer.');
    if (errors.length) return res.status(400).json({ ok: false, message: errors.join(' ') });

    if (!req.user.departmentId) {
      return res.status(403).json({ ok: false, message: 'No department is assigned to your account.' });
    }

    // The assignee must be an active worker of this supervisor's department.
    const { rows: assignees } = await query(
      `SELECT u.user_id, u.first_name || ' ' || u.last_name AS name
         FROM users u
         JOIN roles r ON r.role_id = u.role_id
        WHERE lower(u.email) = $1
          AND r.role_name = 'worker'
          AND u.employment_status = 'active'
          AND u.department_id = $2`,
      [assignee, req.user.departmentId],
    );
    if (assignees.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'That worker is not on your active team — pick someone from the list.',
      });
    }

    const { rows } = await query(
      `INSERT INTO tasks (title, description, assigned_to, assigned_by, department_id, due_date, task_status)
       VALUES ($1, $2, $3, $4, $5, $6::date, 'pending')
       RETURNING task_id, title, description, due_date, task_status`,
      [title, notes || null, assignees[0].user_id, req.user.id, req.user.departmentId, due],
    );

    const record = toTask({
      ...rows[0],
      assignee: assignees[0].name,
      department_name: null,
    });
    record.dept = req.user.department;

    return res.status(201).json({ ok: true, message: `Task assigned to ${assignees[0].name}.`, record });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/tasks/:id/status — open → in-progress → done (and back).
 * Supervisor scope: own department; cancelled tasks are locked.
 */
router.patch('/:id/status', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, message: 'Invalid task id.' });

    const status = String(req.body?.status ?? '');
    if (!(status in STATUS_TO_DB)) {
      return res.status(400).json({ ok: false, message: 'Status must be open, in-progress or done.' });
    }

    const { rows } = await query(
      `${SELECT_TASKS} WHERE t.task_id = $1::bigint AND t.department_id = $2`,
      [id, req.user.departmentId],
    );
    const task = rows[0];
    if (!task) return res.status(404).json({ ok: false, message: 'Task not found in your department.' });
    if (task.task_status === 'cancelled') {
      return res.status(409).json({ ok: false, message: 'Cancelled tasks cannot be changed.' });
    }

    await query(
      'UPDATE tasks SET task_status = $1, updated_at = now() WHERE task_id = $2::bigint',
      [STATUS_TO_DB[status], id],
    );

    return res.json({
      ok: true,
      message: `Task marked ${status}.`,
      record: toTask({ ...task, task_status: STATUS_TO_DB[status] }),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
