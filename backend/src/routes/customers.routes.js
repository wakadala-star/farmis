const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { toIsoDate } = require('../db/dates');

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Collect validation problems for a customer payload. */
function validate(body, partial) {
  const errors = [];
  const out = {};

  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name) {
      errors.push('Customer name is required.');
    } else if (name.length > 150) {
      errors.push('Customer name must be 150 characters or fewer.');
    }
    out.name = name;
  }

  if (!partial || body.phone !== undefined) {
    const phone = body.phone == null ? '' : String(body.phone).trim();
    if (phone.length > 25) errors.push('Phone must be at most 25 characters.');
    out.phone = phone === '' ? null : phone;
  }

  if (!partial || body.email !== undefined) {
    const email = body.email == null ? '' : String(body.email).trim().toLowerCase();
    if (email !== '' && (!EMAIL_RE.test(email) || email.length > 120)) {
      errors.push('Enter a valid email address (or leave it empty).');
    }
    out.email = email === '' ? null : email;
  }

  if (!partial || body.address !== undefined) {
    const address = body.address == null ? '' : String(body.address).trim();
    if (address.length > 255) errors.push('Address must be 255 characters or fewer.');
    out.address = address === '' ? null : address;
  }

  return { errors, out };
}

function toRecord(row) {
  return {
    id: String(row.customer_id),
    name: row.customer_name,
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    createdAt: toIsoDate(row.created_at),
    saleCount: row.sale_count ?? 0,
  };
}

const SELECT_CUSTOMER = `
  SELECT c.customer_id, c.customer_name, c.phone, c.email, c.address,
         c.created_at,
         (SELECT count(*)::int FROM sales s WHERE s.customer_id = c.customer_id)
           AS sale_count
    FROM customers c`;

/**
 * GET /api/customers — the Customers tab of the Sales screen (owner):
 * everyone on file, newest contacts included, with how many sales each
 * one has on record.
 */
router.get('/', requireAuth, requireRole('owner'), async (_req, res, next) => {
  try {
    const { rows } = await query(
      `${SELECT_CUSTOMER} ORDER BY c.customer_name`,
    );
    res.json({ ok: true, customers: rows.map(toRecord) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/customers — add a customer up front (no sale needed). */
router.post('/', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const { errors, out } = validate(req.body ?? {}, false);
    if (errors.length) {
      return res.status(400).json({ ok: false, message: errors.join(' ') });
    }

    const { rows } = await query(
      `INSERT INTO customers (customer_name, phone, email, address)
       VALUES ($1, $2, $3, $4)
       RETURNING customer_id`,
      [out.name, out.phone, out.email, out.address],
    );
    const { rows: fresh } = await query(
      `${SELECT_CUSTOMER} WHERE c.customer_id = $1`,
      [rows[0].customer_id],
    );

    return res.status(201).json({
      ok: true,
      message: `${out.name} was added to your customers.`,
      record: toRecord(fresh[0]),
    });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/customers/:id — edit name and contact details. */
router.patch('/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ ok: false, message: 'Invalid customer id.' });
    }

    const { errors, out } = validate(req.body ?? {}, true);
    if (errors.length) {
      return res.status(400).json({ ok: false, message: errors.join(' ') });
    }
    if (Object.keys(out).length === 0) {
      return res.status(400).json({ ok: false, message: 'Nothing to update.' });
    }

    const fields = [];
    const params = [];
    const set = (column, value) => {
      params.push(value);
      fields.push(`${column} = $${params.length}`);
    };
    if (out.name !== undefined) set('customer_name', out.name);
    if (out.phone !== undefined) set('phone', out.phone);
    if (out.email !== undefined) set('email', out.email);
    if (out.address !== undefined) set('address', out.address);
    params.push(id);

    const { rows } = await query(
      `UPDATE customers SET ${fields.join(', ')}
        WHERE customer_id = $${params.length}
        RETURNING customer_id`,
      params,
    );
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    const { rows: fresh } = await query(
      `${SELECT_CUSTOMER} WHERE c.customer_id = $1`,
      [id],
    );
    return res.json({
      ok: true,
      message: `${fresh[0].customer_name} was updated.`,
      record: toRecord(fresh[0]),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/customers/:id — remove a customer. Blocked with 409 while
 * sales reference them: their name must stay attached to the history
 * (the FK would otherwise detach those sales to "Walk-in").
 */
router.delete('/:id', requireAuth, requireRole('owner'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (!/^\d+$/.test(id)) {
      return res.status(400).json({ ok: false, message: 'Invalid customer id.' });
    }

    const { rows: target } = await query(
      'SELECT customer_name FROM customers WHERE customer_id = $1',
      [id],
    );
    if (target.length === 0) {
      return res.status(404).json({ ok: false, message: 'Customer not found.' });
    }

    const { rows: sales } = await query(
      'SELECT count(*)::int AS n FROM sales WHERE customer_id = $1',
      [id],
    );
    const saleCount = sales[0].n;
    if (saleCount > 0) {
      return res.status(409).json({
        ok: false,
        message:
          `${target[0].customer_name} has ${saleCount} sale(s) on record — ` +
          'keep the customer so the history stays intact.',
      });
    }

    await query('DELETE FROM customers WHERE customer_id = $1', [id]);
    return res.json({
      ok: true,
      message: `${target[0].customer_name} was removed from your customers.`,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
