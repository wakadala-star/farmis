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

/* ---- exact ports of the frontend's formatters (report values are
        stored display-ready, like the mock's generated reports) ---- */

function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function fmtMoney(amount) {
  return `UGX ${amount.toLocaleString('en-US')}`;
}

/** '08:02:00' → ms past midnight. */
function timeMs(clock) {
  if (!clock) return 0;
  const [h, m, s] = String(clock).split(':').map(Number);
  return ((h * 60 + (m || 0)) * 60 + (s || 0)) * 1000;
}

/**
 * GET /api/reports/department — daily reports filed by the
 * supervisor's team (newest first), for the "Filed by workers" list.
 */
router.get('/department', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    if (!req.user.departmentId) return res.json({ ok: true, reports: [] });
    const { rows } = await query(
      `${SELECT_REPORT}
        WHERE u.department_id = $1
        ORDER BY r.report_date DESC, r.report_id DESC
        LIMIT 50`,
      [req.user.departmentId],
    );
    res.json({ ok: true, reports: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/operations — generated report history for the
 * department (newest first).
 */
router.get('/operations', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    if (!req.user.departmentId) return res.json({ ok: true, generated: [] });
    const { rows } = await query(
      `SELECT report_id, report_type, period, lines, generated_at
         FROM operations_reports
        WHERE department_id = $1
        ORDER BY generated_at DESC, report_id DESC
        LIMIT 50`,
      [req.user.departmentId],
    );
    res.json({
      ok: true,
      generated: rows.map((row) => ({
        id: String(row.report_id),
        dept: req.user.department,
        type: row.report_type,
        period: row.period,
        when: new Date(row.generated_at).getTime(),
        lines: Array.isArray(row.lines) ? row.lines : [],
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reports/operations — compute the eight report lines over
 * the department's data from periodStart, store the snapshot, return it.
 * Body: { type, period, periodStart: 'YYYY-MM-DD' }.
 */
router.post('/operations', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const type = String(body.type ?? '').trim();
    const period = String(body.period ?? '').trim();
    const periodStart = body.periodStart;

    const errors = [];
    if (!type || type.length > 60) errors.push('Choose a report type.');
    if (!period || period.length > 60) errors.push('Choose a period.');
    if (!isIsoDate(periodStart)) errors.push('A valid period start is required.');
    if (errors.length) return res.status(400).json({ ok: false, message: errors.join(' ') });

    if (!req.user.departmentId) {
      return res.status(403).json({ ok: false, message: 'No department is assigned to your account.' });
    }
    const dept = req.user.departmentId;

    const [team, att, taskCounts, entriesCount, reportsCount, pendingValue] = await Promise.all([
      query(
        `SELECT count(*)::int AS n
           FROM users u JOIN roles r ON r.role_id = u.role_id
          WHERE u.department_id = $1 AND r.role_name = 'worker'
            AND u.employment_status = 'active'`,
        [dept],
      ),
      query(
        `SELECT a.user_id, a.check_in, a.check_out, a.approval_status
           FROM attendance a
           JOIN users u ON u.user_id = a.user_id
          WHERE u.department_id = $1 AND a.attendance_date >= $2::date`,
        [dept, periodStart],
      ),
      query(
        `SELECT count(*) FILTER (WHERE task_status = 'completed')::int AS done,
                count(*) FILTER (WHERE task_status IN ('pending', 'in_progress'))::int AS open
           FROM tasks WHERE department_id = $1`,
        [dept],
      ),
      query(
        'SELECT count(*)::int AS n FROM field_entries WHERE department_id = $1 AND entry_date >= $2::date',
        [dept, periodStart],
      ),
      query(
        'SELECT count(*)::int AS n FROM daily_reports WHERE department_id = $1 AND report_date >= $2::date',
        [dept, periodStart],
      ),
      query(
        `SELECT COALESCE(SUM(cr.amount), 0) AS total
           FROM credit_requests cr
           JOIN users u ON u.user_id = cr.user_id
          WHERE cr.status = 'pending'
            AND (cr.department_id = $1
                 OR (cr.department_id IS NULL AND u.department_id = $1))`,
        [dept],
      ),
    ]);

    const present = new Set(
      att.rows
        .filter((row) => row.approval_status !== 'rejected')
        .map((row) => String(row.user_id)),
    ).size;
    const worked = att.rows
      .filter(
        (row) =>
          row.check_out &&
          (row.approval_status === 'approved' || row.approval_status === 'pending'),
      )
      .reduce((sum, row) => sum + (timeMs(row.check_out) - timeMs(row.check_in)) / 1000, 0);

    const lines = [
      { label: 'Workers on the team', value: String(team.rows[0].n) },
      { label: 'Workers present', value: String(present) },
      { label: 'Tasks completed', value: String(taskCounts.rows[0].done) },
      { label: 'Tasks still open', value: String(taskCounts.rows[0].open) },
      { label: 'Data entries logged', value: String(entriesCount.rows[0].n) },
      { label: 'Daily reports filed', value: String(reportsCount.rows[0].n) },
      { label: 'Attendance hours (approved & pending)', value: fmtDuration(worked) },
      { label: 'Pending transaction value', value: fmtMoney(Number(pendingValue.rows[0].total)) },
    ];

    const { rows } = await query(
      `INSERT INTO operations_reports (department_id, report_type, period, lines, generated_by)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING report_id, generated_at`,
      [dept, type, period, JSON.stringify(lines), req.user.id],
    );

    return res.status(201).json({
      ok: true,
      message: `${period} report generated.`,
      record: {
        id: String(rows[0].report_id),
        dept: req.user.department,
        type,
        period,
        when: new Date(rows[0].generated_at).getTime(),
        lines,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
