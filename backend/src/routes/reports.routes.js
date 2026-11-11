const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode } = require('../db/departments');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

function toRecord(row) {
  return {
    id: String(row.report_id),
    worker: row.worker,
    dept: departmentCode(row.department_name),
    date: toIsoDate(row.report_date),
    task: row.task_title,
    hours: Number(row.hours),
    summary: row.summary ?? '',
  };
}

const SELECT_REPORT = `
  SELECT r.report_id, r.report_date, r.task_title, r.hours, r.summary,
         u.first_name || ' ' || u.last_name AS worker,
         d.department_name
    FROM daily_reports r
    JOIN users u ON u.user_id = r.user_id
    LEFT JOIN departments d ON d.department_id = r.department_id`;

/** GET /api/reports/mine — my daily reports, newest first. */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `${SELECT_REPORT}
        WHERE r.user_id = $1
        ORDER BY r.report_date DESC, r.report_id DESC`,
      [req.user.id],
    );
    res.json({ ok: true, reports: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reports — file a daily report (free-text task, suggestions
 * come from the client's assigned-task list).
 * Body: { task, date, hours, summary }.
 */
router.post('/', requireAuth, requireRole('worker'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const task = String(body.task ?? '').trim();
    const summary = String(body.summary ?? '').trim();
    const date = body.date;
    const hours = Number(body.hours);

    if (!task || task.length > 150) {
      return res.status(400).json({ ok: false, message: 'Name the task you worked on (150 characters or fewer).' });
    }
    if (!isIsoDate(date)) {
      return res.status(400).json({ ok: false, message: 'A valid date is required.' });
    }
    if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
      return res.status(400).json({ ok: false, message: 'Hours must be between 1 and 24.' });
    }
    if (summary.length < 10) {
      return res.status(400).json({ ok: false, message: 'Write at least a sentence (10 characters or more).' });
    }
    if (!req.user.departmentId) {
      return res.status(403).json({ ok: false, message: 'No department is assigned to your account.' });
    }

    const { rows } = await query(
      `INSERT INTO daily_reports (user_id, department_id, report_date, task_title, hours, summary)
       VALUES ($1, $2, $3::date, $4, $5, $6)
       RETURNING report_id, report_date, task_title, hours, summary`,
      [req.user.id, req.user.departmentId, date, task, hours, summary],
    );

    const record = toRecord({
      ...rows[0],
      worker: req.user.fullName,
      department_name: null,
    });
    record.dept = req.user.department;

    return res.status(201).json({ ok: true, message: 'Daily report submitted to your supervisor.', record });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
