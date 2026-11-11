const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode } = require('../db/departments');
const { toIsoDate, isIsoDate, isClockTime, shortClock } = require('../db/dates');

const router = Router();

/**
 * Shape an attendance row the way the frontend AttendanceRec expects:
 * the DB stores a DATE + wall-clock times, so the raw pieces are sent
 * and the client rebuilds epochs in its own timezone.
 *
 * Status: still running (no clock-out yet) → 'running',
 * otherwise the approval workflow state.
 */
function toRecord(row) {
  return {
    id: String(row.attendance_id),
    worker: row.worker,
    dept: departmentCode(row.department_name),
    date: toIsoDate(row.attendance_date),
    checkIn: shortClock(row.check_in),
    checkOut: shortClock(row.check_out),
    status: row.check_out ? row.approval_status : 'running',
  };
}

const SELECT_RECORD = `
  SELECT a.attendance_id, a.attendance_date, a.check_in, a.check_out,
         a.approval_status,
         u.first_name || ' ' || u.last_name AS worker,
         d.department_name
    FROM attendance a
    JOIN users u ON u.user_id = a.user_id
    LEFT JOIN departments d ON d.department_id = u.department_id`;

/** The most recent shift that is still open (clocked in, no clock-out). */
async function openRecord(userId) {
  const { rows } = await query(
    `${SELECT_RECORD}
      WHERE a.user_id = $1 AND a.check_out IS NULL
      ORDER BY a.attendance_date DESC
      LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
}

/** GET /api/attendance/mine — my clock records, newest first. */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `${SELECT_RECORD}
        WHERE a.user_id = $1
        ORDER BY a.attendance_date DESC, a.check_in DESC NULLS LAST`,
      [req.user.id],
    );
    res.json({ ok: true, attendance: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/attendance/clock-in — open today's shift.
 * Body (client wall clock): { date: 'YYYY-MM-DD', time: 'HH:MM' }.
 *
 * One shift per day: an open row is returned as-is (idempotent); if
 * today's row is already clocked out, 409 — clock-out is final for the day.
 */
router.post('/clock-in', requireAuth, requireRole('worker'), async (req, res, next) => {
  try {
    const { date, time } = req.body ?? {};
    if (!isIsoDate(date) || !isClockTime(time)) {
      return res.status(400).json({ ok: false, message: 'A valid date and time are required.' });
    }

    const open = await openRecord(req.user.id);
    if (open) {
      // Still on shift (today or a forgotten clock-out) — idempotent.
      return res.json({ ok: true, message: 'Already clocked in.', record: toRecord(open) });
    }

    const { rows: today } = await query(
      'SELECT 1 FROM attendance WHERE user_id = $1 AND attendance_date = $2::date',
      [req.user.id, date],
    );
    if (today.length > 0) {
      return res.status(409).json({
        ok: false,
        message: 'You have already clocked out today — one shift per day.',
      });
    }

    const { rows } = await query(
      `INSERT INTO attendance (user_id, attendance_date, check_in, attendance_status, approval_status)
       VALUES ($1, $2::date, $3::time, 'present', 'pending')
       RETURNING attendance_id, attendance_date, check_in, check_out, approval_status`,
      [req.user.id, date, time],
    );

    const record = toRecord({
      ...rows[0],
      worker: req.user.fullName,
      department_name: null,
    });
    // Department comes from the session, not a join, on the insert path.
    record.dept = req.user.department;

    return res.status(201).json({ ok: true, message: 'Clocked in.', record });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/attendance/clock-out — close the open shift.
 * Body: { time: 'HH:MM' } (client wall clock).
 */
router.post('/clock-out', requireAuth, requireRole('worker'), async (req, res, next) => {
  try {
    const { time } = req.body ?? {};
    if (!isClockTime(time)) {
      return res.status(400).json({ ok: false, message: 'A valid time is required.' });
    }

    const open = await openRecord(req.user.id);
    if (!open) {
      return res.status(409).json({ ok: false, message: 'You are not clocked in.' });
    }

    const { rows } = await query(
      `UPDATE attendance
          SET check_out = $2::time
        WHERE attendance_id = $1
        RETURNING attendance_id, attendance_date, check_in, check_out, approval_status`,
      [open.attendance_id, time],
    );

    const record = toRecord({
      ...rows[0],
      worker: req.user.fullName,
      department_name: null,
    });
    record.dept = req.user.department;

    return res.json({ ok: true, message: 'Clocked out — awaiting approval.', record });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
