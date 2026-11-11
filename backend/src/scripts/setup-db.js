/**
 * One-shot database setup — idempotent and NON-destructive:
 *   1. creates the database (local dev only — skipped when DATABASE_URL is set)
 *   2. applies db/migrations/*.sql in order (recorded in schema_migrations)
 *   3. seeds the 5 demo accounts (password: Farmis123)
 *   4. seeds demo farm data — tasks, attendance, field entries, daily
 *      reports, credit requests, inventory, sales, crops, livestock and
 *      expenses — but only into tables that are still empty, so real
 *      data is never touched.
 *
 * Run: npm run setup-db    (safe to re-run any time)
 *      npm run migrate     (migrations only, no seeds)
 */
const bcrypt = require('bcrypt');
const { Client } = require('pg');
const { env } = require('../config/env');
const { pool } = require('../db/pool');
const { runMigrations } = require('../db/migrate');

const DEMO_PASSWORD = 'Farmis123';
const BCRYPT_ROUNDS = 10;

/** The demo accounts that ship with the Angular UI (core/models.ts). */
const DEMO_USERS = [
  { firstName: 'Wakadala', lastName: 'Mark', email: 'owner@farmis.com', role: 'owner', department: null },
  { firstName: 'Grace', lastName: 'Nakato', email: 'crops@farmis.com', role: 'supervisor', department: 'Crop Production' },
  { firstName: 'Sam', lastName: 'Wasswa', email: 'livestock@farmis.com', role: 'supervisor', department: 'Animal Rearing' },
  { firstName: 'Peter', lastName: 'Ssegomba', email: 'crops.worker@farmis.com', role: 'worker', department: 'Crop Production' },
  { firstName: 'Daniel', lastName: 'Okello', email: 'livestock.worker@farmis.com', role: 'worker', department: 'Animal Rearing' },
];

/** Local dev: create the database if it does not exist yet. */
async function ensureDatabase() {
  const admin = new Client({
    host: env.pg.host,
    port: env.pg.port,
    user: env.pg.user,
    password: env.pg.password,
    database: 'postgres',
  });
  await admin.connect();
  try {
    const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.pg.database]);
    if (rows.length === 0) {
      // Identifier can't be parameterised — validated against a safe pattern first.
      if (!/^[a-z_][a-z0-9_]*$/i.test(env.pg.database)) {
        throw new Error(`Unsafe database name: ${env.pg.database}`);
      }
      await admin.query(`CREATE DATABASE ${env.pg.database}`);
      console.log(`[setup] created database ${env.pg.database}`);
    } else {
      console.log(`[setup] database ${env.pg.database} already exists`);
    }
  } finally {
    await admin.end();
  }
}

async function seedDemoUsers() {
  const hash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  for (const user of DEMO_USERS) {
    const username = user.email.split('@')[0];

    const { rows: roleRows } = await pool.query(
      'SELECT role_id FROM roles WHERE role_name = $1',
      [user.role],
    );
    if (roleRows.length === 0) throw new Error(`Role missing after migrations: ${user.role}`);

    let departmentId = null;
    if (user.department) {
      const { rows: deptRows } = await pool.query(
        'SELECT department_id FROM departments WHERE department_name = $1',
        [user.department],
      );
      if (deptRows.length === 0) throw new Error(`Department missing after migrations: ${user.department}`);
      departmentId = deptRows[0].department_id;
    }

    const { rowCount } = await pool.query(
      `INSERT INTO users (role_id, department_id, first_name, last_name, username, email, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (email) DO NOTHING`,
      [roleRows[0].role_id, departmentId, user.firstName, user.lastName, username, user.email, hash],
    );
    console.log(`[setup] ${rowCount > 0 ? 'seeded' : 'exists '} demo user ${user.email} (${user.role}${user.department ? ', ' + user.department : ''})`);
  }
}

/* =====================================================================
   Demo farm data — every block runs only while its table is empty,
   so re-running setup never duplicates or overwrites anything.
   ===================================================================== */

/** Local-date offset as YYYY-MM-DD (avoids UTC off-by-one near midnight). */
function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function countIn(table) {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function seedDemoData() {
  // Actors (created by seedDemoUsers just above).
  const { rows: userRows } = await pool.query(
    `SELECT u.user_id, u.email, d.department_id
       FROM users u
       LEFT JOIN departments d ON d.department_id = u.department_id
      WHERE u.email = ANY($1)`,
    [DEMO_USERS.map((u) => u.email)],
  );
  const actor = Object.fromEntries(userRows.map((r) => [r.email, r]));
  const need = (email) => {
    const row = actor[email];
    if (!row) throw new Error(`demo user missing: ${email}`);
    return row.user_id;
  };
  const deptId = async (name) => {
    const { rows } = await pool.query('SELECT department_id FROM departments WHERE department_name = $1', [name]);
    if (!rows[0]) throw new Error(`department missing: ${name}`);
    return rows[0].department_id;
  };

  const owner = need('owner@farmis.com');
  const cropsSup = need('crops@farmis.com');
  const liveSup = need('livestock@farmis.com');
  const cropsWorker = need('crops.worker@farmis.com');
  const liveWorker = need('livestock.worker@farmis.com');
  const cropsDept = await deptId('Crop Production');
  const liveDept = await deptId('Animal Rearing');

  // ---- Tasks --------------------------------------------------------
  if ((await countIn('tasks')) === 0) {
    const tasks = [
      ['Weed the maize field', 'Clear weeds between the rows and heap soil around the stems.', cropsWorker, cropsSup, cropsDept, -2, 2, 'pending'],
      ['Irrigate the tomato seedbeds', 'Two rounds of drip irrigation, morning and late afternoon.', cropsWorker, cropsSup, cropsDept, -1, 1, 'in_progress'],
      ['Harvest the matooke bunches', 'Cut, weigh and move the bunches to the store.', cropsWorker, cropsSup, cropsDept, 0, 3, 'pending'],
      ['Repair the drip irrigation lines', 'Replace the two burst connectors in Section C.', cropsWorker, cropsSup, cropsDept, -5, -1, 'completed'],
      ['Clean and disinfect the poultry pens', 'Remove litter, wash troughs and disinfect.', liveWorker, liveSup, liveDept, -1, 0, 'in_progress'],
      ['Vaccinate the goat herd', 'Newcastle dose for the 12 goats — morning only.', liveWorker, liveSup, liveDept, 0, 4, 'pending'],
    ];
    for (const [title, description, to, by, dept, start, due, status] of tasks) {
      await pool.query(
        `INSERT INTO tasks (title, description, assigned_to, assigned_by, department_id, start_date, due_date, task_status)
         VALUES ($1, $2, $3, $4, $5, $6::date, $7::date, $8)`,
        [title, description, to, by, dept, isoOffset(start), isoOffset(due), status],
      );
    }
    console.log(`[setup] seeded ${tasks.length} demo tasks`);
  }

  // ---- Attendance (natural key: user + day) -------------------------
  if ((await countIn('attendance')) === 0) {
    const rows = [
      // yesterday: approved by the crops supervisor
      [cropsWorker, isoOffset(-1), '08:02', '17:10', 'present', 'approved', cropsSup, isoOffset(-1)],
      // yesterday: still awaiting livestock supervisor approval
      [liveWorker, isoOffset(-1), '07:55', '16:45', 'present', 'pending', null, null],
      // today: clocked in, still running (no check-out yet)
      [cropsWorker, isoOffset(0), '08:00', null, 'present', 'pending', null, null],
      // today: livestock worker clocked out, pending approval
      [liveWorker, isoOffset(0), '07:58', '16:30', 'present', 'pending', null, null],
    ];
    for (const [user, day, inT, outT, status, approval, approvedBy, approvedAt] of rows) {
      await pool.query(
        `INSERT INTO attendance (user_id, attendance_date, check_in, check_out, attendance_status, approval_status, approved_by, approved_at)
         VALUES ($1, $2::date, $3::time, $4::time, $5, $6, $7, $8::date)
         ON CONFLICT (user_id, attendance_date) DO NOTHING`,
        [user, day, inT, outT, status, approval, approvedBy, approvedAt ? `${approvedAt} 17:30` : null],
      );
    }
    console.log(`[setup] seeded ${rows.length} demo attendance records`);
  }

  // ---- Field entries (worker Data Entry screen) ----------------------
  if ((await countIn('field_entries')) === 0) {
    const rows = [
      [cropsWorker, cropsDept, 'Weeding', 'Field B (maize)', 'Maize', '2 acres', 'Weeds heap-piled between rows.'],
      [cropsWorker, cropsDept, 'Irrigation', 'Field A', 'Tomatoes', '30 min drip', 'Tank 2 refilled before the round.'],
      [liveWorker, liveDept, 'Feeding', 'Poultry pen 1', 'Broilers', '45 kg feed', 'Water troughs cleaned after feeding.'],
    ];
    for (const [user, dept, activity, place, subject, measure, notes] of rows) {
      await pool.query(
        `INSERT INTO field_entries (user_id, department_id, entry_date, activity, place, subject, measure, notes)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, $6, $7)`,
        [user, dept, activity, place, subject, measure, notes],
      );
    }
    console.log(`[setup] seeded ${rows.length} demo field entries`);
  }

  // ---- Daily reports (worker Daily Reports screen) -------------------
  if ((await countIn('daily_reports')) === 0) {
    const rows = [
      [cropsWorker, cropsDept, 'Weeding the maize field', 5.5, 'Completed Field B; irrigation checked.'],
      [liveWorker, liveDept, 'Poultry feeding and pen cleaning', 6, 'All pens done; broilers active and feeding well.'],
    ];
    for (const [user, dept, taskTitle, hours, summary] of rows) {
      await pool.query(
        `INSERT INTO daily_reports (user_id, department_id, report_date, task_title, hours, summary)
         VALUES ($1, $2, CURRENT_DATE, $3, $4, $5)`,
        [user, dept, taskTitle, hours, summary],
      );
    }
    console.log(`[setup] seeded ${rows.length} demo daily reports`);
  }

  // ---- Credit requests (supervisor Transactions screen) --------------
  if ((await countIn('credit_requests')) === 0) {
    const rows = [
      [cropsWorker, cropsDept, 150000, 'School fees balance for the term.', 'pending', null, null],
      [liveWorker, liveDept, 80000, 'Transport to the weekly market.', 'approved', liveSup, isoOffset(-1)],
      [cropsWorker, cropsDept, 40000, 'Emergency home visit transport.', 'rejected', cropsSup, isoOffset(-1)],
    ];
    for (const [user, dept, amount, reason, status, decidedBy, decidedAt] of rows) {
      await pool.query(
        `INSERT INTO credit_requests (user_id, department_id, amount, reason, status, decided_by, decided_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date)`,
        [user, dept, amount, reason, status, decidedBy, decidedAt],
      );
    }
    console.log(`[setup] seeded ${rows.length} demo credit requests`);
  }

  // ---- Inventory (natural keys: category name, item code) -----------
  const cats = [
    ['Seeds', 'Planting material for the seasons'],
    ['Animal Feed', 'Poultry, cattle and goat feed'],
  ];
  for (const [name, description] of cats) {
    await pool.query(
      'INSERT INTO inventory_categories (category_name, description) VALUES ($1, $2) ON CONFLICT (category_name) DO NOTHING',
      [name, description],
    );
  }
  const catId = async (name) => {
    const { rows } = await pool.query('SELECT category_id FROM inventory_categories WHERE category_name = $1', [name]);
    return rows[0].category_id;
  };
  const items = [
    ['Seeds', 'Hybrid Maize Seed', 'SEED-MAIZE-01', 'kg', 120, 30, 4500],
    ['Animal Feed', 'Broiler Starter Feed', 'FEED-BRO-01', 'kg', 45, 50, 8200], // below reorder → low-stock alert
    ['Animal Feed', 'Laying Pellets', 'FEED-LAY-01', 'kg', 80, 40, 7900],
  ];
  let seededItems = 0;
  for (const [category, name, code, unit, qty, reorder, cost] of items) {
    const { rowCount } = await pool.query(
      `INSERT INTO inventory_items (category_id, item_name, item_code, unit, quantity_on_hand, reorder_level, unit_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (item_code) DO NOTHING`,
      [await catId(category), name, code, unit, qty, reorder, cost],
    );
    seededItems += rowCount;
  }
  if (seededItems > 0) console.log(`[setup] seeded ${seededItems} inventory items`);

  // ---- Customers + sales (owner dashboard) --------------------------
  const { rows: custRows } = await pool.query(
    "SELECT customer_id FROM customers WHERE customer_name = 'Nakato Trading Store'",
  );
  let customerId = custRows[0]?.customer_id ?? null;
  if (!customerId) {
    const ins = await pool.query(
      "INSERT INTO customers (customer_name, phone, address) VALUES ('Nakato Trading Store', '0772 415 908', 'Jinja Road, Kampala') RETURNING customer_id",
    );
    customerId = ins.rows[0].customer_id;
  }

  const itemIdByCode = async (code) => {
    const { rows } = await pool.query('SELECT item_id FROM inventory_items WHERE item_code = $1', [code]);
    return rows[0]?.item_id ?? null;
  };
  const sales = [
    ['RCP-2026-001', customerId, owner, isoOffset(-2), 'cash', 'paid',
      [['SEED-MAIZE-01', 'Hybrid Maize Seed', 10, 4500], ['FEED-BRO-01', 'Broiler Starter Feed', 20, 8200]]],
    ['RCP-2026-002', null, owner, isoOffset(-1), 'mobile_money', 'paid',
      [['FEED-LAY-01', 'Laying Pellets', 25, 7900]]],
    ['RCP-2026-003', customerId, owner, isoOffset(0), 'cash', 'pending',
      [['FEED-BRO-01', 'Broiler Starter Feed', 5, 8200]]],
    // Historical months — so the owner dashboard's 6-month sales chart
    // has a shape beyond the current month (idempotent via ON CONFLICT).
    ['RCP-2026-004', customerId, owner, isoOffset(-35), 'mobile_money', 'paid',
      [['FEED-BRO-01', 'Broiler Starter Feed', 40, 8200]]],
    ['RCP-2026-005', null, owner, isoOffset(-65), 'cash', 'paid',
      [['SEED-MAIZE-01', 'Hybrid Maize Seed', 60, 4500]]],
    ['RCP-2026-006', customerId, owner, isoOffset(-95), 'cash', 'paid',
      [['FEED-LAY-01', 'Laying Pellets', 150, 7900]]],
    ['RCP-2026-007', null, owner, isoOffset(-125), 'mobile_money', 'paid',
      [['SEED-MAIZE-01', 'Hybrid Maize Seed', 80, 4500], ['FEED-LAY-01', 'Laying Pellets', 30, 7900]]],
    ['RCP-2026-008', customerId, owner, isoOffset(-155), 'cash', 'paid',
      [['FEED-BRO-01', 'Broiler Starter Feed', 100, 8200]]],
  ];
  let seededSales = 0;
  for (const [receipt, cust, user, day, method, payment, lines] of sales) {
    const total = lines.reduce((sum, [, , qty, price]) => sum + qty * price, 0);
    const { rowCount } = await pool.query(
      `INSERT INTO sales (receipt_number, customer_id, user_id, sale_date, total_amount, payment_method, payment_status)
       VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7)
       ON CONFLICT (receipt_number) DO NOTHING`,
      [receipt, cust, user, `${day} 10:00`, total, method, payment],
    );
    if (rowCount > 0) seededSales += 1;

    // Ensure the sale has its line items (repairs a sale seeded without them).
    const { rows: saleRows } = await pool.query('SELECT sale_id FROM sales WHERE receipt_number = $1', [receipt]);
    const saleId = saleRows[0].sale_id;
    const { rows: existing } = await pool.query(
      'SELECT count(*)::int AS n FROM sale_items WHERE sale_id = $1',
      [saleId],
    );
    if (existing[0].n > 0) continue;

    for (const [code, description, qty, price] of lines) {
      await pool.query(
        `INSERT INTO sale_items (sale_id, item_id, item_description, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [saleId, await itemIdByCode(code), description, qty, price, qty * price],
      );
    }
  }
  if (seededSales > 0) console.log(`[setup] seeded ${seededSales} demo sales with line items`);

  // ---- Owner registries: crops, livestock, expenses (Phase 2D) ------
  if ((await countIn('crops')) === 0) {
    const rows = [
      ['Maize', 'Hybrid 614', 5, -40, 'Plot A — well weeded, drip lines checked.'],
      ['Beans', 'Sugar bean', 2, -20, 'Plot C — intercropped with young maize.'],
      ['Tomatoes', 'Rio Grande', 0.5, -10, 'Seedbeds under shade net.'],
    ];
    for (const [name, variety, area, planted, notes] of rows) {
      await pool.query(
        `INSERT INTO crops (name, variety, area_ha, planted_date, notes, created_by)
         VALUES ($1, $2, $3, $4::date, $5, $6)`,
        [name, variety, area, isoOffset(planted), notes, owner],
      );
    }
    console.log(`[setup] seeded ${rows.length} demo crops`);
  }

  if ((await countIn('livestock')) === 0) {
    const rows = [
      ['Cattle', 'Holstein-Friesian', 120, 'Dairy Unit', -120, 'Milking herd, 2× daily.'],
      ['Broilers', 'Cobb 500', 2500, 'Poultry House A', -35, 'Batch 14 on feed.'],
      ['Goats', 'Saanen', 12, 'Goat Pen', -60, 'Dairy goats, kidding season soon.'],
    ];
    for (const [species, breed, qty, location, acquired, notes] of rows) {
      await pool.query(
        `INSERT INTO livestock (species, breed, quantity, location, acquired_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5::date, $6, $7)`,
        [species, breed, qty, location, isoOffset(acquired), notes, owner],
      );
    }
    console.log(`[setup] seeded ${rows.length} demo livestock records`);
  }

  if ((await countIn('expenses')) === 0) {
    const rows = [
      ['feed', 'Broiler starter feed — 2 bags', 16400, -3, 'cash'],
      ['medicine', 'Newcastle vaccine (10 vials)', 45000, -2, 'mobile_money'],
      ['fuel', 'Tractor fuel — 40 L', 78000, -1, 'cash'],
    ];
    for (const [category, description, amount, day, method] of rows) {
      await pool.query(
        `INSERT INTO expenses (category, description, amount, expense_date, payment_method, created_by)
         VALUES ($1, $2, $3, $4::date, $5, $6)`,
        [category, description, amount, isoOffset(day), method, owner],
      );
    }
    console.log(`[setup] seeded ${rows.length} demo expenses`);
  }

  // ---- Operations report (supervisor Reports screen) ----------------
  if ((await countIn('operations_reports')) === 0) {
    await pool.query(
      `INSERT INTO operations_reports (department_id, report_type, period, lines, generated_by, generated_at)
       VALUES ($1, 'Task completion', 'This week', $2::jsonb, $3, now() - interval '2 days')`,
      [
        cropsDept,
        JSON.stringify([
          { label: 'Tasks completed', value: '1 of 4' },
          { label: 'Attendance rate', value: '92%' },
          { label: 'Field entries filed', value: '2' },
        ]),
        cropsSup,
      ],
    );
    console.log('[setup] seeded 1 demo operations report');
  }
}

async function main() {
  // DATABASE_URL (Neon/Render): the database already exists — connect straight to it.
  // Local dev: individual PG* vars — create the database first if missing.
  const useConnectionString = Boolean(env.pg.connectionString);
  if (useConnectionString) {
    const url = new URL(env.pg.connectionString);
    console.log(`[setup] target (DATABASE_URL): ${url.username}@${url.host}:${url.port || 5432}${url.pathname}`);
  } else {
    console.log(`[setup] target: ${env.pg.user}@${env.pg.host}:${env.pg.port}/${env.pg.database}`);
    await ensureDatabase();
  }

  await runMigrations();
  await seedDemoUsers();
  await seedDemoData();
  console.log(`[setup] done — demo password for all accounts: ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error('[setup] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
