/**
 * One-shot database setup:
 *   1. creates the database (mukwasi_agri_business) if missing
 *   2. applies db/schema.sql  (12 tables + roles/departments seeds)
 *   3. seeds the 5 demo accounts from the frontend (password: Farmis123)
 *
 * Run: npm run setup-db     (safe to re-run: everything is idempotent)
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { Client, Pool } = require('pg');
const { env } = require('../config/env');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'db', 'schema.sql');
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

async function applySchema(pool) {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  await pool.query(sql);
  console.log('[setup] schema applied (12 tables, roles + departments seeded)');
}

async function seedDemoUsers(pool) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);

  for (const user of DEMO_USERS) {
    const username = user.email.split('@')[0];

    const { rows: roleRows } = await pool.query(
      'SELECT role_id FROM roles WHERE role_name = $1',
      [user.role],
    );
    if (roleRows.length === 0) throw new Error(`Role missing after schema apply: ${user.role}`);

    let departmentId = null;
    if (user.department) {
      const { rows: deptRows } = await pool.query(
        'SELECT department_id FROM departments WHERE department_name = $1',
        [user.department],
      );
      if (deptRows.length === 0) throw new Error(`Department missing after schema apply: ${user.department}`);
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

  const pool = useConnectionString
    ? new Pool({ connectionString: env.pg.connectionString })
    : new Pool({
        host: env.pg.host,
        port: env.pg.port,
        user: env.pg.user,
        password: env.pg.password,
        database: env.pg.database,
      });

  try {
    await applySchema(pool);
    await seedDemoUsers(pool);
    console.log(`[setup] done — demo password for all accounts: ${DEMO_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[setup] failed:', err.message);
  process.exit(1);
});
