const { Router } = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { query } = require('../db/pool');
const { departmentCode, departmentName } = require('../db/departments');
const { toIsoDate } = require('../db/dates');

const router = Router();

/** Department pages this endpoint serves. */
const DEPT_CODES = ['crops', 'livestock'];

/**
 * GET /api/owner/summary — everything the owner dashboard renders in
 * one round trip: stat-card numbers, the 6-month sales series, recent
 * sales, low-stock rows, pending approvals, tasks due soon and a mixed
 * recent-activity feed (entries + expenses + sales).
 */
router.get('/summary', requireAuth, requireRole('owner'), async (_req, res, next) => {
  try {
    const [employees, stock, pending, month, series, sales, lowStock, tasks, feed] =
      await Promise.all([
        // Employees = active accounts that are not owners.
        query(
          `SELECT count(*)::int AS n
             FROM users u JOIN roles r ON r.role_id = u.role_id
            WHERE u.employment_status = 'active' AND r.role_name <> 'owner'`,
        ),
        // Low stock = at or below the reorder level.
        query(
          `SELECT count(*)::int AS n
             FROM inventory_items
            WHERE quantity_on_hand <= reorder_level`,
        ),
        // Awaiting a decision: clock-outs + credit requests.
        query(
          `SELECT
             (SELECT count(*)::int FROM attendance
               WHERE approval_status = 'pending' AND check_out IS NOT NULL) AS attendance,
             (SELECT count(*)::int FROM credit_requests WHERE status = 'pending') AS credit`,
        ),
        // This month vs last month (drives the MoM trend on the card).
        query(
          `SELECT
             COALESCE(sum(total_amount) FILTER (
               WHERE sale_date >= date_trunc('month', now())), 0) AS this_month,
             COALESCE(sum(total_amount) FILTER (
               WHERE sale_date >= date_trunc('month', now()) - interval '1 month'
                 AND sale_date <  date_trunc('month', now())), 0) AS last_month
             FROM sales`,
        ),
        // Six calendar months of sales totals for the chart.
        query(
          `SELECT to_char(m.month, 'YYYY-MM') AS month,
                  COALESCE(s.total, 0)::numeric AS value
             FROM generate_series(date_trunc('month', now()) - interval '5 months',
                                  date_trunc('month', now()),
                                  interval '1 month') AS m(month)
             LEFT JOIN (
                   SELECT date_trunc('month', sale_date) AS mon,
                          sum(total_amount) AS total
                     FROM sales GROUP BY 1
                 ) s ON s.mon = m.month
            ORDER BY m.month`,
        ),
        // Latest sales with customer + up to two line descriptions.
        query(
          `SELECT sa.sale_id, sa.sale_date, sa.total_amount, sa.payment_status,
                  c.customer_name,
                  (SELECT string_agg(si.item_description, ' + ' ORDER BY si.sale_item_id)
                     FROM (SELECT item_description, sale_item_id
                             FROM sale_items WHERE sale_id = sa.sale_id
                            ORDER BY sale_item_id LIMIT 2) si) AS items,
                  (SELECT count(*) FROM sale_items WHERE sale_id = sa.sale_id) AS line_count
             FROM sales sa
             LEFT JOIN customers c ON c.customer_id = sa.customer_id
            ORDER BY sa.sale_date DESC, sa.sale_id DESC
            LIMIT 5`,
        ),
        // Items at or below their reorder level (dashboard alerts).
        query(
          `SELECT item_name, quantity_on_hand, unit, reorder_level, updated_at
             FROM inventory_items
            WHERE quantity_on_hand <= reorder_level
            ORDER BY (quantity_on_hand / nullif(reorder_level, 0)) ASC, item_name
            LIMIT 5`,
        ),
        // Tasks due within the next 7 days across the farm.
        query(
          `SELECT t.task_id, t.title, t.due_date,
                  u.first_name || ' ' || u.last_name AS assignee,
                  d.department_name
             FROM tasks t
             LEFT JOIN users u ON u.user_id = t.assigned_to
             LEFT JOIN departments d ON d.department_id = t.department_id
            WHERE t.task_status IN ('pending', 'in_progress')
              AND t.due_date IS NOT NULL
              AND t.due_date <= CURRENT_DATE + 7
            ORDER BY t.due_date, t.task_id
            LIMIT 6`,
        ),
        // Newest events across entries, expenses and sales.
        query(
          `SELECT * FROM (
             SELECT 'entry' AS kind, e.activity AS title,
                    COALESCE(e.place, e.subject) AS sub,
                    e.created_at AS at, d.department_name AS dept,
                    NULL::numeric AS amount
               FROM field_entries e
               LEFT JOIN departments d ON d.department_id = e.department_id
             UNION ALL
             SELECT 'expense', x.description, initcap(x.category),
                    x.created_at, NULL, x.amount
               FROM expenses x
             UNION ALL
             SELECT 'sale', 'Sale ' || s.receipt_number, c.customer_name,
                    s.sale_date, NULL, s.total_amount
               FROM sales s
               LEFT JOIN customers c ON c.customer_id = s.customer_id
           ) feed
           ORDER BY at DESC
           LIMIT 6`,
        ),
      ]);

    const prev = Number(month.rows[0].last_month);
    const now = Number(month.rows[0].this_month);

    res.json({
      ok: true,
      stats: {
        employees: employees.rows[0].n,
        lowStock: stock.rows[0].n,
        pendingApprovals: pending.rows[0].attendance + pending.rows[0].credit,
        monthSales: now,
        prevMonthSales: prev,
      },
      series: series.rows.map((r) => ({ month: r.month, value: Number(r.value) })),
      sales: sales.rows.map((r) => ({
        id: String(r.sale_id),
        date: toIsoDate(r.sale_date),
        customer: r.customer_name ?? 'Walk-in',
        item: r.items ?? '—',
        lineCount: r.line_count,
        amount: Number(r.total_amount),
        status: r.payment_status,
      })),
      lowStock: lowStock.rows.map((r) => ({
        name: r.item_name,
        qty: Number(r.quantity_on_hand),
        unit: r.unit,
        reorderLevel: Number(r.reorder_level),
        updatedAt: new Date(r.updated_at).getTime(),
      })),
      pending: {
        attendance: pending.rows[0].attendance,
        credit: pending.rows[0].credit,
      },
      activities: tasks.rows.map((r) => ({
        id: String(r.task_id),
        title: r.title,
        assignee: r.assignee ?? 'Unassigned',
        dept: departmentCode(r.department_name),
        due: toIsoDate(r.due_date),
      })),
      recent: feed.rows.map((r) => ({
        kind: r.kind,
        title: r.title,
        sub: r.sub ?? '',
        at: new Date(r.at).getTime(),
        dept: departmentCode(r.dept),
        amount: r.amount == null ? null : Number(r.amount),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/owner/department/:code — one owner management page
 * (Crop / Livestock Management): meta-tile numbers, low-stock items
 * scoped to the department (plus farm-wide ones), tasks due soon for
 * the department, and the latest supervisor entries.
 */
router.get(
  '/department/:code',
  requireAuth,
  requireRole('owner'),
  async (req, res, next) => {
    try {
      const code = String(req.params.code);
      if (!DEPT_CODES.includes(code)) {
        return res.status(400).json({ ok: false, message: 'Unknown department.' });
      }
      const deptIdRes = await query(
        'SELECT department_id FROM departments WHERE department_name = $1',
        [departmentName(code)],
      );
      const deptId = deptIdRes.rows[0].department_id;

      const [week, last, lowStock, dueTasks, updates] = await Promise.all([
        // Entries filed this calendar week (Mon-start) + distinct activities.
        query(
          `SELECT count(*)::int AS n,
                  COALESCE(array_agg(DISTINCT activity ORDER BY activity)
                    FILTER (WHERE entry_date >= date_trunc('week', now())::date), '{}')
                    AS activities
             FROM field_entries
            WHERE department_id = $1
              AND entry_date >= date_trunc('week', now())::date`,
          [deptId],
        ),
        // Most recent entry, for the "last supervisor entry" tile.
        query(
          `SELECT e.created_at, e.place,
                  u.first_name || ' ' || u.last_name AS worker
             FROM field_entries e
             JOIN users u ON u.user_id = e.user_id
            WHERE e.department_id = $1
            ORDER BY e.created_at DESC, e.entry_id DESC
            LIMIT 1`,
          [deptId],
        ),
        // Low stock in this department's categories + farm-wide ones.
        query(
          `SELECT i.item_name, i.quantity_on_hand, i.unit, i.reorder_level, i.updated_at
             FROM inventory_items i
             JOIN inventory_categories ic ON ic.category_id = i.category_id
            WHERE i.quantity_on_hand <= i.reorder_level
              AND (ic.department_id IS NULL OR ic.department_id = $1)
            ORDER BY i.item_name
            LIMIT 6`,
          [deptId],
        ),
        // Open tasks for this department due within the next 7 days.
        query(
          `SELECT t.task_id, t.title, t.due_date,
                  u.first_name || ' ' || u.last_name AS assignee
             FROM tasks t
             LEFT JOIN users u ON u.user_id = t.assigned_to
            WHERE t.department_id = $1
              AND t.task_status IN ('pending', 'in_progress')
              AND t.due_date IS NOT NULL
              AND t.due_date <= CURRENT_DATE + 7
            ORDER BY t.due_date, t.task_id
            LIMIT 5`,
          [deptId],
        ),
        // Latest entries for the "Recent Updates" feed.
        query(
          `SELECT e.entry_id, e.created_at, e.activity, e.place, e.subject,
                  e.measure, e.notes,
                  u.first_name || ' ' || u.last_name AS worker
             FROM field_entries e
             JOIN users u ON u.user_id = e.user_id
            WHERE e.department_id = $1
            ORDER BY e.created_at DESC, e.entry_id DESC
            LIMIT 8`,
          [deptId],
        ),
      ]);

      const meta = week.rows[0];
      const lastEntry = last.rows[0] ?? null;

      res.json({
        ok: true,
        dept: code,
        meta: {
          entriesThisWeek: meta.n,
          activities: meta.activities.filter(Boolean),
          lastEntryAt: lastEntry ? new Date(lastEntry.created_at).getTime() : null,
          lastEntryBy: lastEntry?.worker ?? null,
          lastEntryPlace: lastEntry?.place ?? null,
          openAlerts: lowStock.rows.length + dueTasks.rows.length,
        },
        lowStock: lowStock.rows.map((r) => ({
          name: r.item_name,
          qty: Number(r.quantity_on_hand),
          unit: r.unit,
          reorderLevel: Number(r.reorder_level),
          updatedAt: new Date(r.updated_at).getTime(),
        })),
        dueTasks: dueTasks.rows.map((r) => ({
          id: String(r.task_id),
          title: r.title,
          due: toIsoDate(r.due_date),
          assignee: r.assignee ?? 'Unassigned',
          overdue: new Date(r.due_date) < startOfToday(),
        })),
        updates: updates.rows.map((r) => ({
          id: String(r.entry_id),
          at: new Date(r.created_at).getTime(),
          author: r.worker,
          activity: r.activity,
          place: r.place ?? '',
          subject: r.subject ?? '',
          measure: r.measure ?? '',
          notes: r.notes ?? '',
        })),
      });
    } catch (err) {
      next(err);
    }
  },
);

/** Local midnight today — for the overdue flag on due tasks. */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

module.exports = router;
