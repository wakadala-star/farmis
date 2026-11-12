const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pool, query } = require('../db/pool');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

const MOVEMENT_TYPES = ['stock_in', 'stock_out', 'adjustment'];
const MOVEMENT_LABELS = {
  stock_in: 'Stock in',
  stock_out: 'Stock out',
  adjustment: 'Adjustment',
};

/* Inventory & Stores (Phase 3B) — the owner sees and manages every
   department; supervisors get their own department's categories (the
   session's departmentId), workers are out (403). Categories are
   read-only, and an item's quantity NEVER changes through create or
   edit — only through movements, so stock_transactions stays the
   audit trail (sales write their own 'stock_out' rows already). */

/** Error that should surface as its own HTTP status (e.g. 409). */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Department scoping for supervisors: items are scoped through their
 * category's department (migration 008). Owners see everything. The
 * fragment slots into the caller's WHERE list; `params.push` returns
 * the next position so the `$n` lines up with the push order.
 */
function deptScope(req, params) {
  if (req.user.role !== 'supervisor') return '';
  params.push(req.user.departmentId);
  return `c.department_id = $${params.length}`;
}

/** Parse a positive integer path id (400 on junk like /abc). */
function pathId(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ ok: false, message: 'Item id must be a number.' });
    return null;
  }
  return id;
}

/** Number coercion for optional body fields (null when absent/blank). */
function numOr(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function mapItem(r) {
  const qty = Number(r.quantity_on_hand);
  const reorder = Number(r.reorder_level);
  return {
    id: String(r.item_id),
    code: r.item_code ?? '',
    name: r.item_name,
    categoryId: String(r.category_id),
    category: r.category_name,
    departmentId: r.department_id != null ? String(r.department_id) : null,
    department: r.department_name ?? '',
    unit: r.unit,
    qty,
    reorderLevel: reorder,
    unitCost: Number(r.unit_cost),
    description: r.description ?? '',
    low: qty <= reorder,
    updatedAt: toIsoDate(r.updated_at),
  };
}

/**
 * GET /api/inventory/categories — the category list, read-only.
 * Query: none. Supervisors only get their department's categories.
 */
router.get('/categories', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const params = [];
    const scope = deptScope(req, params);
    const whereSql = scope ? `WHERE ${scope}` : '';

    const list = await query(
      `SELECT c.category_id, c.category_name, c.description, c.department_id,
              d.department_name, COUNT(i.item_id)::int AS item_count
         FROM inventory_categories c
         LEFT JOIN departments d ON d.department_id = c.department_id
         LEFT JOIN inventory_items i ON i.category_id = c.category_id
         ${whereSql}
        GROUP BY c.category_id, d.department_id
        ORDER BY c.category_name`,
      params,
    );

    res.json({
      ok: true,
      categories: list.rows.map((r) => ({
        id: String(r.category_id),
        name: r.category_name,
        description: r.description ?? '',
        departmentId: r.department_id != null ? String(r.department_id) : null,
        department: r.department_name ?? '',
        itemCount: r.item_count,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/inventory/movements — the movement log (newest first),
 * mixing manual movements with the rows sales leave behind. Query:
 * item (id), type (stock_in|stock_out|adjustment), dateFrom/dateTo
 * (YYYY-MM-DD, inclusive days), limit (1–500, default 20) + count.
 */
router.get('/movements', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const q = req.query;
    const where = [];
    const params = [];

    const scope = deptScope(req, params);
    if (scope) where.push(scope);

    const pushDate = (value, op) => {
      if (value == null || value === '') return;
      if (!isIsoDate(String(value))) {
        return res.status(400).json({ ok: false, message: 'Dates must be YYYY-MM-DD.' });
      }
      params.push(String(value));
      // Compare as calendar days (see sales.routes.js).
      where.push(`st.transaction_date::date ${op} $${params.length}`);
    };
    if (pushDate(q.dateFrom, '>=')) return undefined;
    if (pushDate(q.dateTo, '<=')) return undefined;

    if (q.item != null && q.item !== '') {
      const itemId = Number(q.item);
      if (!Number.isInteger(itemId) || itemId < 1) {
        return res.status(400).json({ ok: false, message: 'Item id must be a number.' });
      }
      params.push(itemId);
      where.push(`st.item_id = $${params.length}`);
    }
    if (q.type != null && q.type !== '') {
      if (!MOVEMENT_TYPES.includes(String(q.type))) {
        return res.status(400).json({ ok: false, message: 'Unknown movement type.' });
      }
      params.push(String(q.type));
      where.push(`st.transaction_type = $${params.length}`);
    }

    const limitRaw = Number(q.limit ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
      : 20;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const from = `FROM stock_transactions st
        JOIN inventory_items i ON i.item_id = st.item_id
        JOIN inventory_categories c ON c.category_id = i.category_id
        JOIN users u ON u.user_id = st.user_id`;

    const [list, count] = await Promise.all([
      query(
        `SELECT st.transaction_id, st.item_id, st.transaction_type, st.quantity,
                st.unit_cost, st.reference_number, st.notes, st.transaction_date,
                i.item_name, i.item_code, i.unit,
                u.first_name, u.last_name
           ${from}
           ${whereSql}
          ORDER BY st.transaction_date DESC, st.transaction_id DESC
          LIMIT ${limit}`,
        params,
      ),
      query(`SELECT count(*)::int AS n ${from} ${whereSql}`, params),
    ]);

    res.json({
      ok: true,
      count: count.rows[0].n,
      movements: list.rows.map((r) => ({
        id: String(r.transaction_id),
        itemId: String(r.item_id),
        item: r.item_name,
        code: r.item_code ?? '',
        unit: r.unit,
        type: r.transaction_type,
        quantity: Number(r.quantity),
        unitCost: r.unit_cost != null ? Number(r.unit_cost) : null,
        reference: r.reference_number ?? '',
        notes: r.notes ?? '',
        date: toIsoDate(r.transaction_date),
        by: `${r.first_name} ${r.last_name}`.trim(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/inventory/movements — record one movement atomically:
 * the item row is locked, the new level is validated, and the update
 * + audit row commit together. Rules: stock_in/stock_out quantity > 0,
 * stock_out can't exceed the on-hand level (409), adjustments are a
 * signed delta and never take stock below zero (409).
 */
router.post('/movements', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  const body = req.body ?? {};
  const itemId = Number(body.itemId);
  const type = String(body.type ?? '');
  const qty = numOr(body.quantity, NaN);
  const unitCost = numOr(body.unitCost, null);
  const reference = body.reference != null ? String(body.reference).trim() : '';
  const notes = body.notes != null ? String(body.notes).trim() : '';

  if (!Number.isInteger(itemId) || itemId < 1) {
    return res.status(400).json({ ok: false, message: 'Pick an item to move stock for.' });
  }
  if (!MOVEMENT_TYPES.includes(type)) {
    return res.status(400).json({
      ok: false,
      message: 'Movement type must be stock_in, stock_out or adjustment.',
    });
  }
  if (!Number.isFinite(qty) || qty === 0) {
    return res.status(400).json({ ok: false, message: 'Quantity must be a non-zero number.' });
  }
  if ((type === 'stock_in' || type === 'stock_out') && qty < 0) {
    return res.status(400).json({
      ok: false,
      message: `${MOVEMENT_LABELS[type]} quantities are positive — use an adjustment for a decrease.`,
    });
  }
  if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    return res.status(400).json({ ok: false, message: 'Unit cost cannot be negative.' });
  }
  if (reference.length > 80) {
    return res.status(400).json({ ok: false, message: 'Reference must be 80 characters or fewer.' });
  }
  if (notes.length > 500) {
    return res.status(400).json({ ok: false, message: 'Notes must be 500 characters or fewer.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const item = await client.query(
      `SELECT i.item_id, i.item_name, i.unit, i.quantity_on_hand,
              c.department_id AS cat_department_id
         FROM inventory_items i
         JOIN inventory_categories c ON c.category_id = i.category_id
        WHERE i.item_id = $1
        FOR UPDATE`,
      [itemId],
    );
    const row = item.rows[0];
    if (!row) {
      throw httpError(404, 'That item no longer exists.');
    }
    if (
      req.user.role === 'supervisor' &&
      String(row.cat_department_id) !== String(req.user.departmentId)
    ) {
      throw httpError(403, 'That item belongs to another department.');
    }

    const current = Number(row.quantity_on_hand);
    const unit = row.unit;
    const name = row.item_name;
    if (type === 'stock_out' && qty > current) {
      throw httpError(409, `Only ${current} ${unit} of ${name} in stock.`);
    }
    const delta = type === 'stock_out' ? -qty : qty;
    if (current + delta < 0) {
      throw httpError(
        409,
        `That adjustment would take ${name} below zero (currently ${current} ${unit}).`,
      );
    }

    await client.query(
      `UPDATE inventory_items
          SET quantity_on_hand = quantity_on_hand + $1
        WHERE item_id = $2`,
      [delta, itemId],
    );
    // Adjustment rows keep the signed quantity; in/out rows are positive.
    const storedQty = type === 'stock_in' ? Math.abs(qty) : qty;
    const inserted = await client.query(
      `INSERT INTO stock_transactions
         (item_id, user_id, transaction_type, quantity, unit_cost, reference_number, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING transaction_id`,
      [itemId, req.user.id, type, storedQty, unitCost, reference || null, notes || null],
    );
    await client.query('COMMIT');

    const newQty = current + delta;
    return res.status(201).json({
      ok: true,
      message: `${MOVEMENT_LABELS[type]} recorded — ${name} now at ${newQty} ${unit}.`,
      record: {
        id: String(inserted.rows[0].transaction_id),
        itemId: String(itemId),
        type,
        quantity: storedQty,
        newQty,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.status) {
      return res.status(err.status).json({ ok: false, message: err.message });
    }
    throw err;
  } finally {
    client.release();
  }
});

/**
 * GET /api/inventory — the item list. Query: category (id), low (any
 * non-empty value → at/below reorder level, the dashboard's predicate),
 * q (name/code search), limit (1–500, default 50) + count.
 */
router.get('/', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const q = req.query;
    const where = [];
    const params = [];

    const scope = deptScope(req, params);
    if (scope) where.push(scope);

    if (q.category != null && q.category !== '') {
      const categoryId = Number(q.category);
      if (!Number.isInteger(categoryId) || categoryId < 1) {
        return res.status(400).json({ ok: false, message: 'Category id must be a number.' });
      }
      params.push(categoryId);
      where.push(`i.category_id = $${params.length}`);
    }
    if (q.low != null && q.low !== '' && q.low !== '0') {
      where.push('i.quantity_on_hand <= i.reorder_level');
    }
    if (q.q != null && q.q !== '') {
      params.push(`%${String(q.q).trim()}%`);
      where.push(
        `(i.item_name ILIKE $${params.length} OR i.item_code ILIKE $${params.length})`,
      );
    }

    const limitRaw = Number(q.limit ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
      : 50;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM inventory_items i
        JOIN inventory_categories c ON c.category_id = i.category_id
        LEFT JOIN departments d ON d.department_id = c.department_id`;

    const [list, count] = await Promise.all([
      query(
        `SELECT i.item_id, i.item_code, i.item_name, i.category_id,
                c.category_name, c.department_id, d.department_name,
                i.unit, i.quantity_on_hand, i.reorder_level, i.unit_cost,
                i.description, i.updated_at
           ${from}
           ${whereSql}
          ORDER BY i.item_name
          LIMIT ${limit}`,
        params,
      ),
      query(`SELECT count(*)::int AS n ${from} ${whereSql}`, params),
    ]);

    res.json({
      ok: true,
      count: count.rows[0].n,
      items: list.rows.map(mapItem),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/inventory — add an item. The category must exist (and
 * belong to the supervisor's department); an item code that's already
 * taken answers 409. The opening quantity becomes the first level —
 * no movement row is written (there is no "before" to compare to).
 */
router.post('/', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const name = String(body.name ?? '').trim();
    const unit = String(body.unit ?? '').trim();
    const code = body.code != null ? String(body.code).trim() : '';
    const description =
      body.description != null ? String(body.description).trim() : '';
    const categoryId = Number(body.categoryId);
    const qtyOnHand = numOr(body.qtyOnHand, 0);
    const reorderLevel = numOr(body.reorderLevel, 0);
    const unitCost = numOr(body.unitCost, 0);

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ ok: false, message: 'Item name must be 2–120 characters.' });
    }
    if (!unit || unit.length > 30) {
      return res.status(400).json({ ok: false, message: 'Pick a unit (e.g. kg, bags, litres).' });
    }
    if (!Number.isInteger(categoryId) || categoryId < 1) {
      return res.status(400).json({ ok: false, message: 'Pick a category.' });
    }
    if (!Number.isFinite(qtyOnHand) || qtyOnHand < 0) {
      return res.status(400).json({ ok: false, message: 'Opening quantity cannot be negative.' });
    }
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
      return res.status(400).json({ ok: false, message: 'Reorder level cannot be negative.' });
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      return res.status(400).json({ ok: false, message: 'Unit cost cannot be negative.' });
    }
    if (code.length > 50) {
      return res.status(400).json({ ok: false, message: 'Item code must be 50 characters or fewer.' });
    }
    if (description.length > 500) {
      return res.status(400).json({ ok: false, message: 'Description must be 500 characters or fewer.' });
    }

    const cat = await query(
      `SELECT category_id, department_id
         FROM inventory_categories
        WHERE category_id = $1`,
      [categoryId],
    );
    if (!cat.rows[0]) {
      return res.status(400).json({ ok: false, message: 'That category does not exist.' });
    }
    if (
      req.user.role === 'supervisor' &&
      String(cat.rows[0].department_id) !== String(req.user.departmentId)
    ) {
      return res.status(403).json({
        ok: false,
        message: 'You can only add items to your own department.',
      });
    }

    try {
      const inserted = await query(
        `INSERT INTO inventory_items
           (category_id, item_name, item_code, unit, quantity_on_hand,
            reorder_level, unit_cost, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING item_id`,
        [categoryId, name, code || null, unit, qtyOnHand, reorderLevel, unitCost, description || null],
      );
      const created = await query(
        `SELECT i.item_id, i.item_code, i.item_name, i.category_id,
                c.category_name, c.department_id, d.department_name,
                i.unit, i.quantity_on_hand, i.reorder_level, i.unit_cost,
                i.description, i.updated_at
           FROM inventory_items i
           JOIN inventory_categories c ON c.category_id = i.category_id
           LEFT JOIN departments d ON d.department_id = c.department_id
          WHERE i.item_id = $1`,
        [inserted.rows[0].item_id],
      );
      return res.status(201).json({
        ok: true,
        message: `Item "${name}" added.`,
        record: mapItem(created.rows[0]),
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          ok: false,
          message: `Item code "${code}" is already in use.`,
        });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/inventory/:id — edit an item's details (name, code,
 * unit, category, reorder level, unit cost, description). The
 * quantity is deliberately NOT editable here: stock moves through
 * movements only, so the audit trail stays complete.
 */
router.patch('/:id', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const id = pathId(req, res);
    if (id == null) return undefined;

    const body = req.body ?? {};
    if ('qty' in body || 'qtyOnHand' in body || 'quantityOnHand' in body || 'quantity' in body) {
      return res.status(400).json({
        ok: false,
        message: 'Stock levels change through movements — record an adjustment instead.',
      });
    }

    const current = await query(
      `SELECT i.item_id, i.item_name, c.department_id AS cat_department_id
         FROM inventory_items i
         JOIN inventory_categories c ON c.category_id = i.category_id
        WHERE i.item_id = $1`,
      [id],
    );
    const existing = current.rows[0];
    if (!existing) {
      return res.status(404).json({ ok: false, message: 'That item no longer exists.' });
    }
    if (
      req.user.role === 'supervisor' &&
      String(existing.cat_department_id) !== String(req.user.departmentId)
    ) {
      return res.status(403).json({ ok: false, message: 'That item belongs to another department.' });
    }

    const set = [];
    const params = [];
    const push = (frag, value) => {
      params.push(value);
      set.push(`${frag} = $${params.length}`);
    };

    if ('name' in body) {
      const name = String(body.name ?? '').trim();
      if (name.length < 2 || name.length > 120) {
        return res.status(400).json({ ok: false, message: 'Item name must be 2–120 characters.' });
      }
      push('item_name', name);
    }
    if ('unit' in body) {
      const unit = String(body.unit ?? '').trim();
      if (!unit || unit.length > 30) {
        return res.status(400).json({ ok: false, message: 'Pick a unit (e.g. kg, bags, litres).' });
      }
      push('unit', unit);
    }
    if ('code' in body) {
      const code = String(body.code ?? '').trim();
      if (code.length > 50) {
        return res.status(400).json({ ok: false, message: 'Item code must be 50 characters or fewer.' });
      }
      push('item_code', code || null);
    }
    if ('description' in body) {
      const description = String(body.description ?? '').trim();
      if (description.length > 500) {
        return res.status(400).json({ ok: false, message: 'Description must be 500 characters or fewer.' });
      }
      push('description', description || null);
    }
    if ('reorderLevel' in body) {
      const reorderLevel = numOr(body.reorderLevel, NaN);
      if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
        return res.status(400).json({ ok: false, message: 'Reorder level cannot be negative.' });
      }
      push('reorder_level', reorderLevel);
    }
    if ('unitCost' in body) {
      const unitCost = numOr(body.unitCost, NaN);
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        return res.status(400).json({ ok: false, message: 'Unit cost cannot be negative.' });
      }
      push('unit_cost', unitCost);
    }
    if ('categoryId' in body) {
      const categoryId = Number(body.categoryId);
      if (!Number.isInteger(categoryId) || categoryId < 1) {
        return res.status(400).json({ ok: false, message: 'Pick a category.' });
      }
      const cat = await query(
        `SELECT category_id, department_id
           FROM inventory_categories
          WHERE category_id = $1`,
        [categoryId],
      );
      if (!cat.rows[0]) {
        return res.status(400).json({ ok: false, message: 'That category does not exist.' });
      }
      if (
        req.user.role === 'supervisor' &&
        String(cat.rows[0].department_id) !== String(req.user.departmentId)
      ) {
        return res.status(403).json({
          ok: false,
          message: 'You can only move items within your own department.',
        });
      }
      push('category_id', categoryId);
    }

    if (!set.length) {
      return res.status(400).json({ ok: false, message: 'Nothing to update.' });
    }
    params.push(id);

    try {
      await query(
        `UPDATE inventory_items SET ${set.join(', ')} WHERE item_id = $${params.length}`,
        params,
      );
    } catch (err) {
      if (err.code === '23505') {
        const code = String(body.code ?? '').trim();
        return res.status(409).json({
          ok: false,
          message: `Item code "${code}" is already in use.`,
        });
      }
      throw err;
    }

    const updated = await query(
      `SELECT i.item_id, i.item_code, i.item_name, i.category_id,
              c.category_name, c.department_id, d.department_name,
              i.unit, i.quantity_on_hand, i.reorder_level, i.unit_cost,
              i.description, i.updated_at
         FROM inventory_items i
         JOIN inventory_categories c ON c.category_id = i.category_id
         LEFT JOIN departments d ON d.department_id = c.department_id
        WHERE i.item_id = $1`,
      [id],
    );
    return res.json({
      ok: true,
      message: `Item "${updated.rows[0].item_name}" updated.`,
      record: mapItem(updated.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/inventory/:id — remove an item. **409** while sales or
 * movements reference it (the FKs are RESTRICT, same policy as the
 * customer-with-sales guard: history outlives edits).
 */
router.delete('/:id', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const id = pathId(req, res);
    if (id == null) return undefined;

    const current = await query(
      `SELECT i.item_id, i.item_name, c.department_id AS cat_department_id
         FROM inventory_items i
         JOIN inventory_categories c ON c.category_id = i.category_id
        WHERE i.item_id = $1`,
      [id],
    );
    const existing = current.rows[0];
    if (!existing) {
      return res.status(404).json({ ok: false, message: 'That item no longer exists.' });
    }
    if (
      req.user.role === 'supervisor' &&
      String(existing.cat_department_id) !== String(req.user.departmentId)
    ) {
      return res.status(403).json({ ok: false, message: 'That item belongs to another department.' });
    }

    const refs = await query(
      `SELECT EXISTS (SELECT 1 FROM stock_transactions WHERE item_id = $1)
              OR EXISTS (SELECT 1 FROM sale_items WHERE item_id = $1) AS referenced`,
      [id],
    );
    if (refs.rows[0].referenced) {
      return res.status(409).json({
        ok: false,
        message: `Item "${existing.item_name}" has sales or stock history and can't be removed.`,
      });
    }

    try {
      await query('DELETE FROM inventory_items WHERE item_id = $1', [id]);
    } catch (err) {
      if (err.code === '23503') {
        return res.status(409).json({
          ok: false,
          message: `Item "${existing.item_name}" has sales or stock history and can't be removed.`,
        });
      }
      throw err;
    }

    return res.json({
      ok: true,
      message: `Item "${existing.item_name}" removed.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
