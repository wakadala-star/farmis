const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

/** How often a planned activity repeats (010 migration CHECK). */
const CADENCES = ['once', 'weekly', 'monthly'];

/**
 * Live portion counts for the plan rows in `a` — how many tasks have
 * been carved out of the activity and how many of those are done.
 * Cancelled portions don't count (same rule as the task lists).
 */
const COUNTS = `
  (SELECT COUNT(*) FROM tasks t
    WHERE t.activity_id = a.activity_id
      AND t.task_status <> 'cancelled') AS assigned,
  (SELECT COUNT(*) FROM tasks t
    WHERE t.activity_id = a.activity_id
      AND t.task_status = 'completed') AS done`;

const SELECT_ACTIVITY = `
  SELECT a.activity_id, a.title, a.notes, a.cadence, a.anchor_date,
         ${COUNTS}
    FROM farm_activities a`;

/** Map a joined plan row to the frontend's PlanActivity shape. */
function toActivity(row) {
  return {
    id: String(row.activity_id),
    title: row.title,
    notes: row.notes ?? '',
    cadence: row.cadence,
    date: toIsoDate(row.anchor_date), // anchor: first occurrence
    assigned: Number(row.assigned ?? 0),
    done: Number(row.done ?? 0),
  };
}

/** Read + validate a :id route parameter (digits only). */
function readId(param) {
  const id = String(param ?? '');
  return /^\d+$/.test(id) ? id : null;
}

/**
 * GET /api/activities — the farm-wide plan (owner + supervisor).
 * No department scoping: every activity is visible to both teams, and
 * the calendar expands occurrences client-side from cadence + anchor.
 */
router.get('/', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const { rows } = await query(
      `${SELECT_ACTIVITY}
        ORDER BY a.anchor_date ASC, a.activity_id ASC`,
    );
    res.json({ ok: true, activities: rows.map(toActivity) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/activities — owner adds an activity to the plan.
 * Body: { title, notes?, cadence, date } — date is the day clicked on
 * the calendar and doubles as the anchor for weekly/monthly repeats.
 */
router.post('/', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const title = String(body.title ?? '').trim();
    const notes = String(body.notes ?? '').trim();
    const cadence = String(body.cadence ?? '');
    const date = body.date;

    const errors = [];
    if (title.length < 3 || title.length > 150) {
      errors.push('Give the activity a short title (3–150 characters).');
    }
    if (!CADENCES.includes(cadence)) errors.push('Cadence must be once, weekly or monthly.');
    if (!isIsoDate(date)) errors.push('Pick the date for this activity.');
    if (notes.length > 500) errors.push('Notes must be 500 characters or fewer.');
    if (errors.length) return res.status(400).json({ ok: false, message: errors.join(' ') });

    const { rows } = await query(
      `INSERT INTO farm_activities (title, notes, cadence, anchor_date, created_by)
       VALUES ($1, $2, $3, $4::date, $5)
       RETURNING activity_id, title, notes, cadence, anchor_date`,
      [title, notes || null, cadence, date, req.user.id],
    );

    const record = toActivity({ ...rows[0], assigned: 0, done: 0 });
    return res.status(201).json({ ok: true, message: 'Activity added to the plan.', record });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/activities/:id — owner edits a plan row.
 * Body: any of { title, notes, cadence } (the date is fixed: the modal
 * is opened from that day, moving it means re-adding it there).
 */
router.patch('/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const id = readId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: 'Invalid activity id.' });

    const body = req.body ?? {};
    const sets = [];
    const params = [];
    const add = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    const errors = [];
    if (body.title !== undefined) {
      const title = String(body.title ?? '').trim();
      if (title.length < 3 || title.length > 150) {
        errors.push('Give the activity a short title (3–150 characters).');
      } else add('title', title);
    }
    if (body.notes !== undefined) {
      const notes = String(body.notes ?? '').trim();
      if (notes.length > 500) errors.push('Notes must be 500 characters or fewer.');
      else add('notes', notes || null);
    }
    if (body.cadence !== undefined) {
      const cadence = String(body.cadence ?? '');
      if (!CADENCES.includes(cadence)) errors.push('Cadence must be once, weekly or monthly.');
      else add('cadence', cadence);
    }
    if (errors.length) return res.status(400).json({ ok: false, message: errors.join(' ') });
    if (!sets.length) return res.status(400).json({ ok: false, message: 'Nothing to update.' });

    params.push(id);
    const { rows } = await query(
      `UPDATE farm_activities
          SET ${sets.join(', ')}, updated_at = now()
        WHERE activity_id = $${params.length}
        RETURNING activity_id, title, notes, cadence, anchor_date`,
      params,
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Activity not found.' });

    const { rows: counts } = await query(
      `SELECT (SELECT COUNT(*) FROM tasks t
                WHERE t.activity_id = $1::bigint
                  AND t.task_status <> 'cancelled') AS assigned,
              (SELECT COUNT(*) FROM tasks t
                WHERE t.activity_id = $1::bigint
                  AND t.task_status = 'completed') AS done`,
      [id],
    );

    const record = toActivity({ ...rows[0], ...counts[0] });
    return res.json({ ok: true, message: 'Activity updated.', record });
  } catch (err) {
    return next(err);
  }
});

/**
 * DELETE /api/activities/:id — owner removes a plan row. Tasks already
 * carved from it survive: the FK is ON DELETE SET NULL, so the link is
 * cleared but the assigned work stays in every queue.
 */
router.delete('/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const id = readId(req.params.id);
    if (!id) return res.status(400).json({ ok: false, message: 'Invalid activity id.' });

    const { rows } = await query(
      'DELETE FROM farm_activities WHERE activity_id = $1 RETURNING activity_id',
      [id],
    );
    if (!rows.length) return res.status(404).json({ ok: false, message: 'Activity not found.' });

    return res.json({
      ok: true,
      message: 'Activity removed from the plan. Assigned tasks stay in the queue.',
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
