const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode } = require('../db/departments');

const router = Router();

/**
 * Credit requests (the supervisor "Transactions" screen): a worker asks
 * for money for a farm purchase, the supervisor decides. Not the same
 * as stock_transactions — that table tracks inventory movement.
 */
const SELECT_TX = `
  SELECT cr.request_id, cr.amount, cr.reason, cr.status, cr.created_at,
         u.first_name || ' ' || u.last_name AS worker,
         COALESCE(d.department_name, du.department_name) AS department_name
    FROM credit_requests cr
    JOIN users u ON u.user_id = cr.user_id
    LEFT JOIN departments d ON d.department_id = cr.department_id
    LEFT JOIN departments du ON du.department_id = u.department_id`;

/** Map a credit-request row to the frontend's TransactionRec shape. */
function toRecord(row) {
  return {
    id: String(row.request_id),
    worker: row.worker,
    dept: departmentCode(row.department_name),
    amount: Number(row.amount),
    reason: row.reason,
    when: new Date(row.created_at).getTime(),
    status: row.status,
  };
}

/** GET /api/transactions/mine — my credit requests, newest first. */
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `${SELECT_TX}
        WHERE cr.user_id = $1
        ORDER BY cr.created_at DESC, cr.request_id DESC
        LIMIT 100`,
      [req.user.id],
    );
    res.json({ ok: true, transactions: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/transactions/department — the supervisor's department feed
 * (pending + decided; the screen splits them client-side).
 */
router.get('/department', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    if (!req.user.departmentId) return res.json({ ok: true, transactions: [] });
    const { rows } = await query(
      `${SELECT_TX}
        WHERE cr.department_id = $1
           OR (cr.department_id IS NULL AND u.department_id = $1)
        ORDER BY cr.created_at DESC, cr.request_id DESC
        LIMIT 100`,
      [req.user.departmentId],
    );
    res.json({ ok: true, transactions: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/transactions — worker submits a credit request.
 * Body: { amount, reason }.
 */
router.post('/', requireAuth, requireRole('worker'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const amount = Number(body.amount);
    const reason = String(body.reason ?? '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, message: 'Enter an amount greater than zero.' });
    }
    if (amount > 999_999_999_999.99) {
      return res.status(400).json({ ok: false, message: 'That amount is too large.' });
    }
    if (!reason || reason.length > 200) {
      return res.status(400).json({ ok: false, message: 'Say what the money is for (200 characters or fewer).' });
    }
    if (!req.user.departmentId) {
      return res.status(403).json({ ok: false, message: 'No department is assigned to your account.' });
    }

    const { rows } = await query(
      `INSERT INTO credit_requests (user_id, department_id, amount, reason, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING request_id, amount, reason, status, created_at`,
      [req.user.id, req.user.departmentId, amount, reason],
    );

    const record = toRecord({
      ...rows[0],
      worker: req.user.fullName,
      department_name: null,
    });
    record.dept = req.user.department;

    return res.status(201).json({
      ok: true,
      message: 'Credit request submitted for approval.',
      record,
    });
  } catch (err) {
    return next(err);
  }
});

/**
 * POST /api/transactions/:id/decision — supervisor approves or rejects
 * a pending request (own department only).
 * Body: { decision: 'approved' | 'rejected' }.
 */
router.post('/:id/decision', requireAuth, requireRole('supervisor'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) return res.status(400).json({ ok: false, message: 'Invalid request id.' });

    const decision = String(req.body?.decision ?? '');
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(400).json({ ok: false, message: 'Decision must be approved or rejected.' });
    }

    const { rows } = await query(
      `${SELECT_TX}
        WHERE cr.request_id = $1::bigint
          AND (cr.department_id = $2
               OR (cr.department_id IS NULL AND u.department_id = $2))`,
      [id, req.user.departmentId],
    );
    const rec = rows[0];
    if (!rec) {
      return res.status(404).json({ ok: false, message: 'Credit request not found in your department.' });
    }
    if (rec.status !== 'pending') {
      return res.status(409).json({ ok: false, message: 'This request has already been decided.' });
    }

    await query(
      `UPDATE credit_requests
          SET status = $1, decided_by = $2, decided_at = now()
        WHERE request_id = $3::bigint AND status = 'pending'`,
      [decision, req.user.id, id],
    );

    return res.json({
      ok: true,
      message: decision === 'approved' ? 'Credit request approved.' : 'Credit request rejected.',
      record: toRecord({ ...rec, status: decision }),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
