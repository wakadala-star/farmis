const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode, departmentName } = require('../db/departments');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

const TEXT_FIELDS = ['activity', 'place', 'subject', 'measure'];

/** Frontend department codes the feed can filter by. */
const DEPT_CODES = ['crops', 'livestock'];

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

const ENTRY_FROM = `
    FROM field_entries e
    JOIN users u ON u.user_id = e.user_id
    LEFT JOIN departments d ON d.department_id = e.department_id`;

const SELECT_ENTRY = `
  SELECT e.entry_id, e.entry_date, e.activity, e.place, e.subject,
         e.measure, e.notes,
         u.first_name || ' ' || u.last_name AS worker,
         d.department_name
    ${ENTRY_FROM}`;

/**
 * GET /api/entries — the activity feed (Phase 3D: filters + count +
 * tile stats). Workers and supervisors see their own department;
 * owners see all. Query: dept (owner picks any; everyone else is
 * locked to their own — a foreign department answers 403),
 * dateFrom/dateTo (inclusive days), activity (exact name),
 * q (subject/place/notes search), limit (1–500, default 100).
 * `stats` carries the tile numbers — total, this week (Mon-start)
 * and distinct activities — within the same scope + filters.
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const q = req.query;
    const params = [];
    const where = [];

    // Department: owner picks any; everyone else is locked to their own.
    if (q.dept != null && q.dept !== '') {
      const code = String(q.dept);
      if (!DEPT_CODES.includes(code)) {
        return res.status(400).json({ ok: false, message: 'Unknown department.' });
      }
      if (req.user.role !== 'owner' && req.user.department !== code) {
        return res
          .status(403)
          .json({ ok: false, message: 'You can only view your own department.' });
      }
      params.push(departmentName(code));
      where.push(`d.department_name = $${params.length}`);
    } else if (req.user.role !== 'owner') {
      params.push(departmentName(req.user.department));
      where.push(`d.department_name = $${params.length}`);
    }

    const pushDate = (value, op) => {
      if (value == null || value === '') return;
      if (!isIsoDate(String(value))) {
        return res.status(400).json({ ok: false, message: 'Dates must be YYYY-MM-DD.' });
      }
      params.push(String(value));
      // Compare as calendar days (see sales.routes.js).
      where.push(`e.entry_date::date ${op} $${params.length}`);
    };
    if (pushDate(q.dateFrom, '>=')) return undefined;
    if (pushDate(q.dateTo, '<=')) return undefined;

    if (q.activity != null && q.activity !== '') {
      const activity = String(q.activity).trim();
      if (activity.length > 120) {
        return res
          .status(400)
          .json({ ok: false, message: 'Activity must be 120 characters or fewer.' });
      }
      params.push(activity);
      where.push(`e.activity = $${params.length}`);
    }

    if (q.q != null && q.q !== '') {
      params.push(`%${String(q.q).trim()}%`);
      where.push(
        `(e.subject ILIKE $${params.length}
          OR e.place ILIKE $${params.length}
          OR COALESCE(e.notes, '') ILIKE $${params.length})`,
      );
    }

    const limitRaw = Number(q.limit ?? 100);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
      : 100;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [list, stats, count] = await Promise.all([
      query(
        `${SELECT_ENTRY}
         ${whereSql}
         ORDER BY e.entry_date DESC, e.entry_id DESC
         LIMIT ${limit}`,
        params,
      ),
      query(
        `SELECT count(*)::int AS total,
                (count(*) FILTER (
                  WHERE e.entry_date >= date_trunc('week', now())::date
                    AND e.entry_date <  date_trunc('week', now())::date + 7
                ))::int AS this_week,
                count(DISTINCT e.activity)::int AS activities
           ${ENTRY_FROM}
           ${whereSql}`,
        params,
      ),
      query(`SELECT count(*)::int AS n ${ENTRY_FROM} ${whereSql}`, params),
    ]);

    res.json({
      ok: true,
      count: count.rows[0].n,
      stats: {
        total: stats.rows[0].total,
        thisWeek: stats.rows[0].this_week,
        activities: stats.rows[0].activities,
      },
      entries: list.rows.map(toRecord),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entries/activities — distinct activity names for the
 * feed's filter dropdown (Phase 3D), within the caller's scope
 * (owner: farm-wide, everyone else: own department).
 */
router.get('/activities', requireAuth, async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.user.role !== 'owner') {
      where = 'WHERE d.department_name = $1';
      params.push(departmentName(req.user.department));
    }

    const { rows } = await query(
      `SELECT DISTINCT e.activity
         FROM field_entries e
         LEFT JOIN departments d ON d.department_id = e.department_id
         ${where}
        ORDER BY e.activity`,
      params,
    );
    res.json({ ok: true, activities: rows.map((r) => r.activity) });
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
