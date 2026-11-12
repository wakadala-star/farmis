const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pool, query } = require('../db/pool');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

const PAYMENT_METHODS = ['cash', 'mobile_money', 'bank_transfer', 'other'];
const PAYMENT_STATUSES = ['paid', 'pending', 'partial'];

/* Sales + customers are owner AND supervisor territory (Phase 3A
   extension: supervisors get the full screen, record sales included). */

/** Error that should surface as its own HTTP status (e.g. 409 stock). */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * GET /api/sales/options — the Record Sale form's pickers: existing
 * customers and the inventory items that can be linked to a line
 * (linking a line to an item deducts stock when the sale is recorded).
 */
router.get('/options', requireAuth, requireRole('owner', 'supervisor'), async (_req, res, next) => {
  try {
    const [customers, items] = await Promise.all([
      query(
        `SELECT customer_id, customer_name, phone
           FROM customers
          ORDER BY customer_name`,
      ),
      query(
        `SELECT item_id, item_name, item_code, unit,
                quantity_on_hand, reorder_level, unit_cost
           FROM inventory_items
          ORDER BY item_name`,
      ),
    ]);

    res.json({
      ok: true,
      customers: customers.rows.map((r) => ({
        id: String(r.customer_id),
        name: r.customer_name,
        phone: r.phone ?? '',
      })),
      items: items.rows.map((r) => ({
        id: String(r.item_id),
        name: r.item_name,
        code: r.item_code ?? '',
        unit: r.unit,
        qty: Number(r.quantity_on_hand),
        reorderLevel: Number(r.reorder_level),
        unitCost: Number(r.unit_cost),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sales — the sales list (newest first). The dashboard asks
 * for the default 20 most recent; the Sales screen passes filters and
 * a bigger limit. Query: dateFrom, dateTo (YYYY-MM-DD, inclusive),
 * status (paid|pending|partial), method (cash|…), limit (1–500, def 20).
 * `count` is the full match count (rows are limit-truncated).
 */
router.get('/', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const q = req.query;
    const where = [];
    const params = [];

    const pushDate = (value, col, op) => {
      if (value == null || value === '') return;
      if (!isIsoDate(String(value))) {
        return res.status(400).json({ ok: false, message: 'Dates must be YYYY-MM-DD.' });
      }
      params.push(String(value));
      // Compare as calendar days: `sale_date <= '2026-11-05'` would drop
      // every sale after midnight on the last day.
      where.push(`${col}::date ${op} $${params.length}`);
    };
    if (pushDate(q.dateFrom, 'sa.sale_date', '>=')) return undefined;
    if (pushDate(q.dateTo, 'sa.sale_date', '<=')) return undefined;

    if (q.status != null && q.status !== '') {
      if (!PAYMENT_STATUSES.includes(String(q.status))) {
        return res.status(400).json({ ok: false, message: 'Unknown payment status.' });
      }
      params.push(String(q.status));
      where.push(`sa.payment_status = $${params.length}`);
    }
    if (q.method != null && q.method !== '') {
      if (!PAYMENT_METHODS.includes(String(q.method))) {
        return res.status(400).json({ ok: false, message: 'Unknown payment method.' });
      }
      params.push(String(q.method));
      where.push(`sa.payment_method = $${params.length}`);
    }

    const limitRaw = Number(q.limit ?? 20);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
      : 20;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [list, count] = await Promise.all([
      query(
        `SELECT sa.sale_id, sa.sale_date, sa.receipt_number, sa.total_amount,
                sa.payment_method, sa.payment_status, c.customer_name,
                (SELECT string_agg(si.item_description, ' + ' ORDER BY si.sale_item_id)
                   FROM (SELECT item_description, sale_item_id
                           FROM sale_items WHERE sale_id = sa.sale_id
                          ORDER BY sale_item_id LIMIT 2) si) AS items
           FROM sales sa
           LEFT JOIN customers c ON c.customer_id = sa.customer_id
           ${whereSql}
          ORDER BY sa.sale_date DESC, sa.sale_id DESC
          LIMIT ${limit}`,
        params,
      ),
      query(`SELECT count(*)::int AS n FROM sales sa ${whereSql}`, params),
    ]);

    res.json({
      ok: true,
      count: count.rows[0].n,
      sales: list.rows.map((r) => ({
        id: String(r.sale_id),
        date: toIsoDate(r.sale_date),
        receipt: r.receipt_number,
        customer: r.customer_name ?? 'Walk-in',
        item: r.items ?? '—',
        amount: Number(r.total_amount),
        method: r.payment_method,
        status: r.payment_status,
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sales/:id — sale detail for the Sales screen's expandable
 * row: header (receipt, customer, seller, method/status, notes), every
 * line item, and the stock movements the sale produced (linked lines
 * carry their receipt number as the reference).
 */
router.get('/:id', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ ok: false, message: 'Invalid sale id.' });
    }

    const { rows } = await query(
      `SELECT sa.sale_id, sa.receipt_number, sa.sale_date, sa.total_amount,
              sa.payment_method, sa.payment_status, sa.notes,
              c.customer_id, c.customer_name, c.phone AS customer_phone,
              u.first_name || ' ' || u.last_name AS seller
         FROM sales sa
         LEFT JOIN customers c ON c.customer_id = sa.customer_id
         JOIN users u ON u.user_id = sa.user_id
        WHERE sa.sale_id = $1`,
      [id],
    );
    const sale = rows[0];
    if (!sale) {
      return res.status(404).json({ ok: false, message: 'Sale not found.' });
    }

    const [items, stock] = await Promise.all([
      query(
        `SELECT si.item_description, si.quantity, si.unit_price, si.subtotal,
                si.item_id, ii.item_name, ii.unit
           FROM sale_items si
           LEFT JOIN inventory_items ii ON ii.item_id = si.item_id
          WHERE si.sale_id = $1
          ORDER BY si.sale_item_id`,
        [id],
      ),
      query(
        `SELECT st.quantity, st.unit_cost, st.transaction_date,
                ii.item_name, ii.unit
           FROM stock_transactions st
           JOIN inventory_items ii ON ii.item_id = st.item_id
          WHERE st.reference_number = $1
          ORDER BY st.transaction_id`,
        [sale.receipt_number],
      ),
    ]);

    res.json({
      ok: true,
      sale: {
        id: String(sale.sale_id),
        receipt: sale.receipt_number,
        date: toIsoDate(sale.sale_date),
        customer: sale.customer_name ?? 'Walk-in',
        customerId: sale.customer_id != null ? String(sale.customer_id) : null,
        customerPhone: sale.customer_phone ?? '',
        seller: sale.seller,
        method: sale.payment_method,
        status: sale.payment_status,
        notes: sale.notes ?? '',
        total: Number(sale.total_amount),
        items: items.rows.map((r) => ({
          description: r.item_description,
          quantity: Number(r.quantity),
          unitPrice: Number(r.unit_price),
          subtotal: Number(r.subtotal),
          linked: r.item_id != null,
          item: r.item_name ?? null,
          unit: r.unit ?? '',
        })),
        stockMovements: stock.rows.map((r) => ({
          item: r.item_name,
          quantity: Number(r.quantity),
          unit: r.unit,
          unitCost: Number(r.unit_cost ?? 0),
          date: toIsoDate(r.transaction_date),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sales — record a sale (owner dashboard "Record Sale").
 *
 * Body: {
 *   customerName?: string, customerId?: string,
 *   lines: [{ itemId?, description, quantity, unitPrice }],  1–20
 *   paymentMethod?, paymentStatus?, notes?
 * }
 *
 * The total is recomputed server-side. Lines linked to an inventory
 * item are deducted inside ONE transaction together with a stock_out
 * row — insufficient stock rolls everything back with 409. Free-text
 * lines (no itemId) never touch stock. A new customer name creates
 * the customer row when no customerId is given.
 */
router.post('/', requireAuth, requireRole('owner', 'supervisor'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const lines = Array.isArray(body.lines) ? body.lines : [];

    if (lines.length < 1 || lines.length > 20) {
      return res.status(400).json({ ok: false, message: 'Add between 1 and 20 sale lines.' });
    }

    const method = String(body.paymentMethod ?? 'cash');
    const status = String(body.paymentStatus ?? 'paid');
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ ok: false, message: 'Unknown payment method.' });
    }
    if (!PAYMENT_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, message: 'Unknown payment status.' });
    }

    const notes = String(body.notes ?? '').trim();
    if (notes.length > 500) {
      return res.status(400).json({ ok: false, message: 'Notes must be 500 characters or fewer.' });
    }

    /* ---- validate + normalise the lines ---- */
    const parsed = [];
    for (const [index, raw] of lines.entries()) {
      const line = raw ?? {};
      const quantity = Number(line.quantity);
      const unitPrice = Number(line.unitPrice);
      const description = String(line.description ?? '').trim();
      const itemId = line.itemId == null || line.itemId === '' ? null : Number(line.itemId);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({
          ok: false,
          message: `Line ${index + 1}: quantity must be greater than 0.`,
        });
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return res.status(400).json({
          ok: false,
          message: `Line ${index + 1}: price cannot be negative.`,
        });
      }
      if (itemId != null && !Number.isInteger(itemId)) {
        return res.status(400).json({ ok: false, message: `Line ${index + 1}: invalid item.` });
      }
      if (description.length > 180) {
        return res.status(400).json({
          ok: false,
          message: `Line ${index + 1}: description must be 180 characters or fewer.`,
        });
      }
      if (!description && itemId == null) {
        return res.status(400).json({
          ok: false,
          message: `Line ${index + 1}: enter an item description.`,
        });
      }
      parsed.push({ itemId, description, quantity, unitPrice });
    }

    const total = parsed.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

    /* ---- customer: existing id, new name, or walk-in ---- */
    let customerId = body.customerId == null || body.customerId === ''
      ? null
      : Number(body.customerId);
    const customerName = String(body.customerName ?? '').trim();

    if (customerId != null && !Number.isInteger(customerId)) {
      return res.status(400).json({ ok: false, message: 'Invalid customer.' });
    }
    if (customerName && customerName.length > 150) {
      return res.status(400).json({ ok: false, message: 'Customer name is too long.' });
    }

    /* ---- receipt number: date + random suffix, unique ---- */
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    const receipt = `RCP-${stamp}-${suffix}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      /* customer: existing id → verify; typed name → reuse the record
         on file (case-insensitive) or create it; nothing → walk-in */
      if (customerId == null && customerName) {
        const dup = await client.query(
          'SELECT customer_id FROM customers WHERE lower(customer_name) = lower($1)',
          [customerName],
        );
        if (dup.rows.length > 0) {
          customerId = dup.rows[0].customer_id;
        } else {
          const ins = await client.query(
            `INSERT INTO customers (customer_name) VALUES ($1) RETURNING customer_id`,
            [customerName],
          );
          customerId = ins.rows[0].customer_id;
        }
      } else if (customerId != null) {
        const exists = await client.query('SELECT 1 FROM customers WHERE customer_id = $1', [
          customerId,
        ]);
        if (exists.rows.length === 0) {
          throw httpError(400, 'That customer no longer exists.');
        }
      }

      /* linked lines: lock + verify stock before writing anything */
      const stockLines = [];
      for (const line of parsed) {
        if (line.itemId == null) continue;
        const { rows } = await client.query(
          `SELECT item_id, item_name, quantity_on_hand, unit, unit_cost
             FROM inventory_items
            WHERE item_id = $1
            FOR UPDATE`,
          [line.itemId],
        );
        const item = rows[0];
        if (!item) {
          throw httpError(400, 'One of the inventory items no longer exists.');
        }
        if (Number(item.quantity_on_hand) < line.quantity) {
          throw httpError(
            409,
            `Not enough stock for ${item.item_name}: only ` +
              `${Number(item.quantity_on_hand)} ${item.unit} left.`,
          );
        }
        stockLines.push({ line, item });
      }

      /* sale + line items */
      const sale = await client.query(
        `INSERT INTO sales (customer_id, user_id, receipt_number, sale_date,
                            total_amount, payment_method, payment_status, notes)
         VALUES ($1, $2, $3, now(), $4, $5, $6, $7)
         RETURNING sale_id`,
        [customerId, req.user.id, receipt, total, method, status, notes || null],
      );
      const saleId = sale.rows[0].sale_id;

      for (const line of parsed) {
        const description =
          line.description || stockLines.find((s) => s.line === line)?.item.item_name || 'Item';
        await client.query(
          `INSERT INTO sale_items (sale_id, item_id, item_description, quantity, unit_price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [saleId, line.itemId, description, line.quantity, line.unitPrice, line.quantity * line.unitPrice],
        );
      }

      /* deduct linked stock + record stock_out rows */
      for (const { line, item } of stockLines) {
        await client.query(
          `UPDATE inventory_items
              SET quantity_on_hand = quantity_on_hand - $1
            WHERE item_id = $2`,
          [line.quantity, item.item_id],
        );
        await client.query(
          `INSERT INTO stock_transactions
             (item_id, user_id, transaction_type, quantity, unit_cost, reference_number, notes)
           VALUES ($1, $2, 'stock_out', $3, $4, $5, $6)`,
          [
            item.item_id,
            req.user.id,
            line.quantity,
            item.unit_cost,
            receipt,
            `Sold on ${receipt}`,
          ],
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({
        ok: true,
        message: `Sale ${receipt} recorded.`,
        record: {
          id: String(saleId),
          receipt,
          total,
          lines: parsed.length,
          stockDeducted: stockLines.length,
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
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
