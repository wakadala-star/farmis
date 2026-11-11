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

/**
 * GET /api/expenses — the expense ledger (newest first). Feeds the
 * dashboard's recent-activity feed and smoke verification.
 */
router.get('/', requireAuth, requireRole('owner'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT e.expense_id, e.category, e.description, e.amount,
              e.expense_date, e.payment_method, e.created_at,
              u.first_name || ' ' || u.last_name AS creator
         FROM expenses e
         JOIN users u ON u.user_id = e.created_by
        ORDER BY e.expense_date DESC, e.expense_id DESC
        LIMIT 50`,
    );
    res.json({ ok: true, expenses: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/expenses — owner "Add Expense" quick action.
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
       VALUES ($1, $2, $3, NULLIF($4, '')::date, $5, $6)
       RETURNING expense_id, category, description, amount, expense_date, payment_method, created_at`,
      [category, description, amount, date, method, req.user.id],
    );

    const record = toRecord({ ...rows[0], creator: req.user.fullName });
    return res.status(201).json({ ok: true, message: 'Expense recorded.', record });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
