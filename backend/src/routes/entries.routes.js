const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode, departmentName } = require('../db/departments');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

const TEXT_FIELDS = ['activity', 'place', 'subject', 'measure'];

function toRecord(row) {
  return {
    id: String(row.entry_id),
    worker: row.worker,
    dept: departmentCode(row.department_name),
    date: toIsoDate(row.entry_date),
    activity: row.activity,
    place: row.place,
    subject: row.subject,
    measure: row.measure,
    notes: row.notes ?? '',
  };
}

const SELECT_ENTRY = `
  SELECT e.entry_id, e.entry_date, e.activity, e.place, e.subject,
         e.measure, e.notes,
         u.first_name || ' ' || u.last_name AS worker,
         d.department_name
    FROM field_entries e
    JOIN users u ON u.user_id = e.user_id
    LEFT JOIN departments d ON d.department_id = e.department_id`;

/**
 * GET /api/entries — the department feed (newest first).
 * Workers and supervisors see their own department; owners see all.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.user.role !== 'owner') {
      where = 'WHERE d.department_name = $1';
      params.push(departmentName(req.user.department));
    }
    params.push(100);

    const { rows } = await query(
      `${SELECT_ENTRY}
        ${where}
        ORDER BY e.entry_date DESC, e.entry_id DESC
        LIMIT $${params.length}`,
      params,
    );
    res.json({ ok: true, entries: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/entries — record an activity (worker Data Entry screen).
 * Body: { date, activity, place, subject, measure, notes? }.
 * The department comes from the session, never from the client.
 */
router.post('/', requireAuth, requireRole('worker'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const date = body.date;
    const values = {};
    for (const field of TEXT_FIELDS) {
      const value = String(body[field] ?? '').trim();
      if (!value) {
        return res.status(400).json({ ok: false, message: `${field} is required.` });
      }
      if (value.length > 120) {
        return res.status(400).json({ ok: false, message: `${field} must be 120 characters or fewer.` });
      }
      values[field] = value;
    }
    if (values.measure.length < 2) {
      return res.status(400).json({ ok: false, message: 'Measure must be at least 2 characters.' });
    }
    if (!isIsoDate(date)) {
      return res.status(400).json({ ok: false, message: 'A valid date is required.' });
    }
    if (!req.user.departmentId) {
      return res.status(403).json({ ok: false, message: 'No department is assigned to your account.' });
    }

    const notes = String(body.notes ?? '').trim();
    const { rows } = await query(
      `INSERT INTO field_entries (user_id, department_id, entry_date, activity, place, subject, measure, notes)
       VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
       RETURNING entry_id, entry_date, activity, place, subject, measure, notes`,
      [req.user.id, req.user.departmentId, date, values.activity, values.place, values.subject, values.measure, notes || null],
    );

    const record = toRecord({
      ...rows[0],
      worker: req.user.fullName,
      department_name: null,
    });
    record.dept = req.user.department;

    return res.status(201).json({ ok: true, message: 'Entry recorded.', record });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
