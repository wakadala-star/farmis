const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

function toRecord(row) {
  return {
    id: String(row.crop_id),
    name: row.name,
    variety: row.variety ?? '',
    areaHa: row.area_ha == null ? null : Number(row.area_ha),
    plantedDate: row.planted_date ? toIsoDate(row.planted_date) : null,
    notes: row.notes ?? '',
    createdBy: row.creator,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * GET /api/crops — the owner's crop registry (newest first).
 * Shown as the list section on Crop Management.
 */
router.get('/', requireAuth, requireRole('owner'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.crop_id, c.name, c.variety, c.area_ha, c.planted_date,
              c.notes, c.created_at,
              u.first_name || ' ' || u.last_name AS creator
         FROM crops c
         JOIN users u ON u.user_id = c.created_by
        ORDER BY c.created_at DESC, c.crop_id DESC`,
    );
    res.json({ ok: true, crops: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/crops — owner "Add Crop" quick action.
 * Body: { name, variety?, areaHa?, plantedDate?, notes? }
 */
router.post('/', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? '').trim();
    const variety = String(body.variety ?? '').trim();
    const notes = String(body.notes ?? '').trim();
    const plantedDate = body.plantedDate == null ? '' : String(body.plantedDate);

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ ok: false, message: 'Enter a crop name (2–120 characters).' });
    }
    if (variety.length > 120) {
      return res.status(400).json({ ok: false, message: 'Variety must be 120 characters or fewer.' });
    }
    if (notes.length > 500) {
      return res.status(400).json({ ok: false, message: 'Notes must be 500 characters or fewer.' });
    }
    if (plantedDate && !isIsoDate(plantedDate)) {
      return res.status(400).json({ ok: false, message: 'Planted date must be YYYY-MM-DD.' });
    }

    const areaRaw = body.areaHa;
    let areaHa = null;
    if (areaRaw != null && areaRaw !== '') {
      areaHa = Number(areaRaw);
      if (!Number.isFinite(areaHa) || areaHa < 0) {
        return res.status(400).json({ ok: false, message: 'Area must be 0 or more hectares.' });
      }
    }

    const { rows } = await query(
      `INSERT INTO crops (name, variety, area_ha, planted_date, notes, created_by)
       VALUES ($1, $2, $3, NULLIF($4, '')::date, $5, $6)
       RETURNING crop_id, name, variety, area_ha, planted_date, notes, created_at`,
      [name, variety || null, areaHa, plantedDate, notes || null, req.user.id],
    );

    const record = toRecord({ ...rows[0], creator: req.user.fullName });
    return res.status(201).json({ ok: true, message: `${name} added to the crop registry.`, record });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
