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
 * GET /api/reports/operations — generated report history
 * (Phase 3E: widened to the owner). Supervisor: own department's
 * snapshots; owner: the farm-wide ones (department_id IS NULL) —
 * department reports stay on their own screens.
 */
router.get('/operations', requireAuth, requireRole('supervisor', 'owner'), async (req, res, next) => {
  try {
    const isOwner = req.user.role === 'owner';
    if (!isOwner && !req.user.departmentId) return res.json({ ok: true, generated: [] });
    const { rows } = await query(
      `SELECT report_id, report_type, period, lines, generated_at
         FROM operations_reports
        WHERE ${isOwner ? 'department_id IS NULL' : 'department_id = $1'}
        ORDER BY generated_at DESC, report_id DESC
        LIMIT 50`,
      isOwner ? [] : [req.user.departmentId],
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

/** The four report types the screens offer — type decides the lines. */
const REPORT_TYPES = [
  'Daily operations summary',
  'Task performance',
  'Attendance hours',
  'Inputs & expenses',
];

/**
 * POST /api/reports/operations — compute the report lines over the
 * scope's data from periodStart, store the snapshot, return it.
 * Phase 3E: each of the four types computes its own lines (Daily
 * operations keeps the full 8-line snapshot); the owner generates
 * farm-wide reports (department_id NULL), supervisors their own
 * department's.
 * Body: { type, period, periodStart: 'YYYY-MM-DD' }.
 */
router.post('/operations', requireAuth, requireRole('supervisor', 'owner'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const type = String(body.type ?? '').trim();
    const period = String(body.period ?? '').trim();
    const periodStart = body.periodStart;

    const errors = [];
    if (!REPORT_TYPES.includes(type)) errors.push('Choose a report type.');
    if (!period || period.length > 60) errors.push('Choose a period.');
    if (!isIsoDate(periodStart)) errors.push('A valid period start is required.');
    if (errors.length) return res.status(400).json({ ok: false, message: errors.join(' ') });

    const isOwner = req.user.role === 'owner';
    if (!isOwner && !req.user.departmentId) {
      return res.status(403).json({ ok: false, message: 'No department is assigned to your account.' });
    }
    const dept = isOwner ? null : req.user.departmentId;

    // Scope fragments: supervisor = own department ($1), owner = none.
    const pDept = dept == null ? [] : [dept];
    const pBoth = [...pDept, periodStart];
    const deptAt = (col) => (dept == null ? '' : ` AND ${col} = $1`);
    const dateAt = (col, params) => ` AND ${col} >= $${params.length}::date`;

    const [
      team,
      att,
      taskCounts,
      entriesCount,
      reportsCount,
      pendingValue,
      expenses,
      stock,
    ] = await Promise.all([
      query(
        `SELECT count(*)::int AS n
           FROM users u JOIN roles r ON r.role_id = u.role_id
          WHERE r.role_name = 'worker' AND u.employment_status = 'active'
            ${deptAt('u.department_id')}`,
        pDept,
      ),
      query(
        `SELECT a.user_id, a.check_in, a.check_out, a.approval_status
           FROM attendance a
           JOIN users u ON u.user_id = a.user_id
          WHERE 1 = 1${dateAt('a.attendance_date', pBoth)}${deptAt('u.department_id')}`,
        pBoth,
      ),
      query(
        `SELECT count(*) FILTER (WHERE task_status = 'completed')::int AS done,
                count(*) FILTER (WHERE task_status IN ('pending', 'in_progress'))::int AS open
           FROM tasks${dept == null ? '' : ' WHERE department_id = $1'}`,
        pDept,
      ),
      query(
        `SELECT count(*)::int AS n FROM field_entries
          WHERE 1 = 1${dateAt('entry_date', pBoth)}${deptAt('department_id')}`,
        pBoth,
      ),
      query(
        `SELECT count(*)::int AS n FROM daily_reports
          WHERE 1 = 1${dateAt('report_date', pBoth)}${deptAt('department_id')}`,
        pBoth,
      ),
      query(
        `SELECT COALESCE(SUM(cr.amount), 0) AS total
           FROM credit_requests cr
           JOIN users u ON u.user_id = cr.user_id
          WHERE cr.status = 'pending'${
            dept == null
              ? ''
              : ' AND (cr.department_id = $1 OR (cr.department_id IS NULL AND u.department_id = $1))'
          }`,
        pDept,
      ),
      // Expenses are farm-wide (no department column) and owner-only
      // data (the 3C ruling) — only the owner's report shows them.
      query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS total, count(*)::int AS n
           FROM expenses
          WHERE expense_date >= $1::date`,
        [periodStart],
      ),
      query(
        `SELECT COALESCE(SUM(i.quantity_on_hand * COALESCE(i.unit_cost, 0)), 0)::numeric AS value,
                (count(*) FILTER (WHERE i.quantity_on_hand <= i.reorder_level))::int AS low
           FROM inventory_items i
           JOIN inventory_categories c ON c.category_id = i.category_id
          ${dept == null ? '' : 'WHERE c.department_id = $1'}`,
        pDept,
      ),
    ]);

    const present = new Set(
      att.rows
        .filter((row) => row.approval_status !== 'rejected')
        .map((row) => String(row.user_id)),
    ).size;
    // Worked time by approval state (rejected rows excluded, like the
    // dashboard's attendance hours) — approved + pending is the total.
    const secondsFor = (status) =>
      att.rows
        .filter((row) => row.check_out && row.approval_status === status)
        .reduce((sum, row) => sum + (timeMs(row.check_out) - timeMs(row.check_in)) / 1000, 0);
    const workedApproved = secondsFor('approved');
    const workedPending = secondsFor('pending');
    const worked = workedApproved + workedPending;

    const done = taskCounts.rows[0].done;
    const open = taskCounts.rows[0].open;
    const taskTotal = done + open;

    let lines;
    if (type === 'Task performance') {
      lines = [
        { label: 'Tasks completed', value: String(done) },
        { label: 'Tasks still open', value: String(open) },
        {
          label: 'Completion rate',
          value: taskTotal === 0 ? '—' : `${Math.round((done / taskTotal) * 100)}%`,
        },
        { label: 'Data entries logged', value: String(entriesCount.rows[0].n) },
        { label: 'Daily reports filed', value: String(reportsCount.rows[0].n) },
      ];
    } else if (type === 'Attendance hours') {
      lines = [
        { label: 'Workers present', value: String(present) },
        { label: 'Attendance hours (approved & pending)', value: fmtDuration(worked) },
        { label: 'Approved hours', value: fmtDuration(workedApproved) },
        { label: 'Awaiting approval hours', value: fmtDuration(workedPending) },
      ];
    } else if (type === 'Inputs & expenses') {
      // Expenses are owner-only data (the 3C ruling): the supervisor's
      // version carries dept-scoped input lines only.
      lines = [
        ...(isOwner
          ? [
              { label: 'Expenses (period)', value: fmtMoney(Number(expenses.rows[0].total)) },
              { label: 'Expense entries', value: String(expenses.rows[0].n) },
            ]
          : []),
        { label: 'Pending transaction value', value: fmtMoney(Number(pendingValue.rows[0].total)) },
        { label: 'Stock on hand value', value: fmtMoney(Number(stock.rows[0].value)) },
        { label: 'Low-stock items', value: String(stock.rows[0].low) },
      ];
    } else {
      // Daily operations summary — the full 8-line snapshot (unchanged).
      lines = [
        { label: 'Workers on the team', value: String(team.rows[0].n) },
        { label: 'Workers present', value: String(present) },
        { label: 'Tasks completed', value: String(done) },
        { label: 'Tasks still open', value: String(open) },
        { label: 'Data entries logged', value: String(entriesCount.rows[0].n) },
        { label: 'Daily reports filed', value: String(reportsCount.rows[0].n) },
        { label: 'Attendance hours (approved & pending)', value: fmtDuration(worked) },
        { label: 'Pending transaction value', value: fmtMoney(Number(pendingValue.rows[0].total)) },
      ];
    }

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
