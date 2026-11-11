const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

function toRecord(row) {
  return {
    id: String(row.animal_id),
    species: row.species,
    breed: row.breed ?? '',
    quantity: row.quantity,
    location: row.location ?? '',
    acquiredDate: row.acquired_date ? toIsoDate(row.acquired_date) : null,
    notes: row.notes ?? '',
    createdBy: row.creator,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * GET /api/livestock — the owner's livestock registry (newest first).
 * Shown as the list section on Livestock Management.
 */
router.get('/', requireAuth, requireRole('owner'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT l.animal_id, l.species, l.breed, l.quantity, l.location,
              l.acquired_date, l.notes, l.created_at,
              u.first_name || ' ' || u.last_name AS creator
         FROM livestock l
         JOIN users u ON u.user_id = l.created_by
        ORDER BY l.created_at DESC, l.animal_id DESC`,
    );
    res.json({ ok: true, livestock: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/livestock — owner "Add Animal" quick action.
 * Body: { species, breed?, quantity?, location?, acquiredDate?, notes? }
 */
router.post('/', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const species = String(body.species ?? '').trim();
    const breed = String(body.breed ?? '').trim();
    const location = String(body.location ?? '').trim();
    const notes = String(body.notes ?? '').trim();
    const acquiredDate = body.acquiredDate == null ? '' : String(body.acquiredDate);

    if (species.length < 2 || species.length > 80) {
      return res.status(400).json({ ok: false, message: 'Enter a species (2–80 characters).' });
    }
    if (breed.length > 80) {
      return res.status(400).json({ ok: false, message: 'Breed must be 80 characters or fewer.' });
    }
    if (location.length > 120) {
      return res.status(400).json({ ok: false, message: 'Location must be 120 characters or fewer.' });
    }
    if (notes.length > 500) {
      return res.status(400).json({ ok: false, message: 'Notes must be 500 characters or fewer.' });
    }
    if (acquiredDate && !isIsoDate(acquiredDate)) {
      return res.status(400).json({ ok: false, message: 'Acquired date must be YYYY-MM-DD.' });
    }

    const quantity = body.quantity == null || body.quantity === '' ? 0 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ ok: false, message: 'Quantity must be 0 or more.' });
    }

    const { rows } = await query(
      `INSERT INTO livestock (species, breed, quantity, location, acquired_date, notes, created_by)
       VALUES ($1, $2, $3, $4, NULLIF($5, '')::date, $6, $7)
       RETURNING animal_id, species, breed, quantity, location, acquired_date, notes, created_at`,
      [species, breed || null, quantity, location || null, acquiredDate, notes || null, req.user.id],
    );

    const record = toRecord({ ...rows[0], creator: req.user.fullName });
    return res.status(201).json({ ok: true, message: `${quantity} ${species} added to the registry.`, record });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
