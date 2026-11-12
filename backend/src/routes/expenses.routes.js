const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { toIsoDate, isIsoDate } = require('../db/dates');

const router = Router();

const CATEGORIES = ['feed', 'medicine', 'fuel', 'salaries', 'maintenance', 'equipment', 'other'];
const PAYMENT_METHODS = ['cash', 'mobile_money', 'bank_transfer', 'other'];

function toRecord(row) {
  return {
    id: String(row.expense_id),
    category: row.category,
    description: row.description,
    amount: Number(row.amount),
    date: toIsoDate(row.expense_date),
    method: row.payment_method,
    createdBy: row.creator,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/* The expense ledger is owner-only (Phase 3C: full CRUD screen).
   Expenses are farm-wide by design — the table has no department
   column — so nothing here is scoped per department. */

/**
 * GET /api/expenses — the expense ledger (newest first). Phase 3C adds
 * filters for the Finance screen: dateFrom/dateTo (inclusive days),
 * category, method, q (description search), limit (1–500, default 50)
 * + count. Still feeds the dashboard's recent-activity feed.
 */
router.get('/', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const q = req.query;
    const where = [];
    const params = [];

    const pushDate = (value, op) => {
      if (value == null || value === '') return;
      if (!isIsoDate(String(value))) {
        return res.status(400).json({ ok: false, message: 'Dates must be YYYY-MM-DD.' });
      }
      params.push(String(value));
      // Compare as calendar days (see sales.routes.js).
      where.push(`e.expense_date::date ${op} $${params.length}`);
    };
    if (pushDate(q.dateFrom, '>=')) return undefined;
    if (pushDate(q.dateTo, '<=')) return undefined;

    if (q.category != null && q.category !== '') {
      if (!CATEGORIES.includes(String(q.category))) {
        return res.status(400).json({ ok: false, message: 'Unknown expense category.' });
      }
      params.push(String(q.category));
      where.push(`e.category = $${params.length}`);
    }
    if (q.method != null && q.method !== '') {
      if (!PAYMENT_METHODS.includes(String(q.method))) {
        return res.status(400).json({ ok: false, message: 'Unknown payment method.' });
      }
      params.push(String(q.method));
      where.push(`e.payment_method = $${params.length}`);
    }
    if (q.q != null && q.q !== '') {
      params.push(`%${String(q.q).trim()}%`);
      where.push(`e.description ILIKE $${params.length}`);
    }

    const limitRaw = Number(q.limit ?? 50);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500)
      : 50;
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const from = `FROM expenses e
        JOIN users u ON u.user_id = e.created_by`;

    const [list, count] = await Promise.all([
      query(
        `SELECT e.expense_id, e.category, e.description, e.amount,
                e.expense_date, e.payment_method, e.created_at,
                u.first_name || ' ' || u.last_name AS creator
           ${from}
           ${whereSql}
          ORDER BY e.expense_date DESC, e.expense_id DESC
          LIMIT ${limit}`,
        params,
      ),
      query(`SELECT count(*)::int AS n ${from} ${whereSql}`, params),
    ]);

    res.json({ ok: true, count: count.rows[0].n, expenses: list.rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/expenses — owner "Add Expense" quick action + the Finance
 * screen's form.
 * Body: { category, description, amount, date?, paymentMethod? }
 */
router.post('/', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const category = String(body.category ?? '').trim();
    const description = String(body.description ?? '').trim();
    const method = String(body.paymentMethod ?? 'cash');
    const date = body.date == null ? '' : String(body.date);

    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ ok: false, message: 'Choose an expense category.' });
    }
    if (!PAYMENT_METHODS.includes(method)) {
      return res.status(400).json({ ok: false, message: 'Unknown payment method.' });
    }
    if (description.length < 2 || description.length > 255) {
      return res.status(400).json({
        ok: false,
        message: 'Describe the expense (2–255 characters).',
      });
    }
    if (date && !isIsoDate(date)) {
      return res.status(400).json({ ok: false, message: 'Date must be YYYY-MM-DD.' });
    }

    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, message: 'Amount must be greater than 0.' });
    }

    const { rows } = await query(
      `INSERT INTO expenses (category, description, amount, expense_date, payment_method, created_by)
       VALUES ($1, $2, $3, COALESCE(NULLIF($4, '')::date, CURRENT_DATE), $5, $6)
       RETURNING expense_id, category, description, amount, expense_date, payment_method, created_at`,
      [category, description, amount, date, method, req.user.id],
    );

    const record = toRecord({ ...rows[0], creator: req.user.fullName });
    return res.status(201).json({ ok: true, message: 'Expense recorded.', record });
  } catch (err) {
    return next(err);
  }
});

/**
 * PATCH /api/expenses/:id — edit an expense's fields (Phase 3C).
 * Body: any of category / description / amount / date / paymentMethod.
 */
router.patch('/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, message: 'Expense id must be a number.' });
    }

    const current = await query(
      `SELECT expense_id, description
         FROM expenses
        WHERE expense_id = $1`,
      [id],
    );
    if (!current.rows[0]) {
      return res.status(404).json({ ok: false, message: 'That expense no longer exists.' });
    }

    const body = req.body ?? {};
    const set = [];
    const params = [];
    const push = (frag, value) => {
      params.push(value);
      set.push(`${frag} = $${params.length}`);
    };

    if ('category' in body) {
      const category = String(body.category ?? '').trim();
      if (!CATEGORIES.includes(category)) {
        return res.status(400).json({ ok: false, message: 'Choose an expense category.' });
      }
      push('category', category);
    }
    if ('description' in body) {
      const description = String(body.description ?? '').trim();
      if (description.length < 2 || description.length > 255) {
        return res.status(400).json({
          ok: false,
          message: 'Describe the expense (2–255 characters).',
        });
      }
      push('description', description);
    }
    if ('amount' in body) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ ok: false, message: 'Amount must be greater than 0.' });
      }
      push('amount', amount);
    }
    if ('date' in body) {
      const date = body.date == null ? '' : String(body.date);
      if (!isIsoDate(date)) {
        return res.status(400).json({ ok: false, message: 'Date must be YYYY-MM-DD.' });
      }
      push('expense_date', date);
    }
    if ('paymentMethod' in body) {
      const method = String(body.paymentMethod ?? '').trim();
      if (!PAYMENT_METHODS.includes(method)) {
        return res.status(400).json({ ok: false, message: 'Unknown payment method.' });
      }
      push('payment_method', method);
    }

    if (!set.length) {
      return res.status(400).json({ ok: false, message: 'Nothing to update.' });
    }
    params.push(id);

    await query(
      `UPDATE expenses SET ${set.join(', ')} WHERE expense_id = $${params.length}`,
      params,
    );

    const updated = await query(
      `SELECT e.expense_id, e.category, e.description, e.amount,
              e.expense_date, e.payment_method, e.created_at,
              u.first_name || ' ' || u.last_name AS creator
         FROM expenses e
         JOIN users u ON u.user_id = e.created_by
        WHERE e.expense_id = $1`,
      [id],
    );
    return res.json({
      ok: true,
      message: 'Expense updated.',
      record: toRecord(updated.rows[0]),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/expenses/:id — hard delete (Phase 3C ruling: any date,
 * nothing references expense rows). The row disappears from the
 * ledger and month totals immediately.
 */
router.delete('/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ ok: false, message: 'Expense id must be a number.' });
    }

    const current = await query(
      `SELECT expense_id, description FROM expenses WHERE expense_id = $1`,
      [id],
    );
    if (!current.rows[0]) {
      return res.status(404).json({ ok: false, message: 'That expense no longer exists.' });
    }

    await query('DELETE FROM expenses WHERE expense_id = $1', [id]);
    return res.json({
      ok: true,
      message: `Expense "${current.rows[0].description}" removed.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
