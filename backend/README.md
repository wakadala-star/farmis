# FARMIS Backend

Express + PostgreSQL + JWT authentication & authorization API for the FARMIS
frontend (Angular).

## Stack

| Piece      | Choice                          |
| ---------- | ------------------------------- |
| Runtime    | Node.js 24                      |
| Framework  | Express 5                       |
| Database   | PostgreSQL 18 (`mukwasi_agri_business`) |
| Passwords  | bcrypt (10 rounds)              |
| Sessions   | JWT (7 days) in an **httpOnly cookie** |
| CORS       | credentialed, locked to the origin in `CLIENT_ORIGIN` |

## Setup

```bash
cd backend
npm install
npm run setup-db      # migrations + demo users + demo farm data (idempotent)
npm start             # or: npm run dev  (auto-restart on changes)
```

`npm run setup-db` is **non-destructive** and safe to re-run: pending
migrations are applied (recorded in `schema_migrations`), demo accounts are
created only if missing, and demo farm data only fills tables that are still
empty. `npm run migrate` applies pending migrations without seeding.

Requires the PostgreSQL service running locally with the credentials in
`.env` (defaults: `postgres` / `postgres` on port 5432).

## API

| Method | Route              | Auth            | Purpose                                    |
| ------ | ------------------ | --------------- | ------------------------------------------ |
| GET    | `/api/health`      | —               | Liveness check                             |
| POST   | `/api/auth/signup` | optional owner  | Create account (supervisor/worker open; owner only by first-bootstraps or existing owner) |
| POST   | `/api/auth/signin` | —               | Verify credentials → sets httpOnly cookie  |
| POST   | `/api/auth/signout`| —               | Clears the cookie                          |
| GET    | `/api/auth/me`     | required        | Current session (fresh from DB)            |
| PATCH  | `/api/auth/me`     | required        | Update own phone number (`''` clears; names/passwords stay owned by signup — no password-change flow) |
| POST   | `/api/auth/avatar` | required        | Replace profile photo — raw JPG/PNG/WebP bytes, **max 1 MB** (route-level `express.raw` + magic-byte sniff) |
| GET    | `/api/auth/avatar` | required        | Own profile photo (404 when none; `private, max-age=300`) |
| DELETE | `/api/auth/avatar` | required        | Remove profile photo → avatar reverts to initials |
| GET    | `/api/users`       | owner/supervisor| Owner: all users · Supervisor: own department · Worker: 403 |
| GET    | `/api/users/:id/avatar` | required  | Team member's profile photo (team lists; 404 when none) |
| POST   | `/api/users`       | owner/supervisor| Recruit — supervisor: creates an active **worker** in their own department and chooses the initial password · owner: worker/supervisor + department |
| DELETE | `/api/users/:id`   | owner/supervisor| Remove from the team by deactivating the account (`inactive` blocks signin, history kept) — supervisor: own-dept workers only, owner: anyone but owners |
| GET    | `/api/tasks/mine`  | required        | Tasks assigned to the signed-in user (cancelled hidden, mapped to open/in-progress/done) |
| GET    | `/api/tasks/department` | supervisor | Every live task of the supervisor's department |
| POST   | `/api/tasks`       | supervisor      | Assign work to an active team worker (assignee by email, required due date) |
| PATCH  | `/api/tasks/:id/status` | supervisor | Cycle status `open → in-progress → done` (own department; cancelled tasks locked) |
| GET    | `/api/attendance/mine` | required    | Own clock records, newest first (`running` while open, then approval state) |
| POST   | `/api/attendance/clock-in` | worker   | Open today's shift — one shift per day, idempotent while running |
| POST   | `/api/attendance/clock-out` | worker   | Close the open shift → awaits supervisor approval |
| GET    | `/api/attendance/department` | supervisor | Team clock records, newest first (approval feed + dashboard tiles) |
| POST   | `/api/attendance/:id/decision` | supervisor | Approve/reject a clock-out awaiting approval (pending only, own department) |
| GET    | `/api/entries`     | required        | Activity feed, newest first (owner: every department, others: own) — filters `dept` (owner picks any; others locked to their own, foreign → 403), `dateFrom`/`dateTo` (inclusive days), `activity` (exact), `q` (subject/place/notes search), `limit` (1–500, default 100) + `count` + `stats` (total / this week Mon-start / distinct activities) |
| GET    | `/api/entries/activities` | required | Distinct activity names for the feed filter, in the caller's scope |
| POST   | `/api/entries`     | worker          | Record a field/livestock activity (department from session) |
| GET    | `/api/transactions/mine` | required  | Own credit requests, newest first |
| POST   | `/api/transactions`| worker          | Request credit for a farm purchase (amount > 0, reason ≤ 200 chars) |
| GET    | `/api/transactions/department` | supervisor | Department credit requests, newest first (pending + decided) |
| GET    | `/api/transactions`| owner       | Farm-wide credit requests across departments, newest first (pending + decided) |
| POST   | `/api/transactions/:id/decision` | owner/supervisor | Approve/reject a pending request — **409** once decided; supervisor: own department only, owner: farm-wide |
| GET    | `/api/reports/mine`| required        | Own daily reports, newest first            |
| POST   | `/api/reports`     | worker          | File a daily report (free-text task, 1–24 h) |
| GET    | `/api/reports/department` | supervisor | Daily reports filed by the team, newest first |
| GET    | `/api/reports/operations` | supervisor | Generated operations-report history (8 label/value lines) |
| POST   | `/api/reports/operations` | supervisor | Compute + store the report over department data from `periodStart` |
| GET    | `/api/owner/summary` | owner     | Dashboard aggregate — stat cards, 6-month sales series, recent sales, low-stock rows, pending approvals, tasks due soon, recent activity feed |
| GET    | `/api/owner/finance` | owner     | Month summary (`?month=YYYY-MM`, default current) — sales/expenses/net this month vs last, expense breakdown by category |
| GET    | `/api/owner/department/:code` | owner | One management page (`crops`\|`livestock`) — meta numbers, dept-scoped low stock, tasks due soon, latest entries |
| GET    | `/api/sales`        | owner/supervisor| Sales list, newest first — optional filters `dateFrom`/`dateTo` (inclusive days), `status`, `method`, `limit` (1–500, default 20); `count` = full match count |
| GET    | `/api/sales/:id`    | owner/supervisor| Sale detail — receipt, customer, seller, line items, and the stock movements the sale produced |
| GET    | `/api/sales/options`| owner/supervisor| Record Sale form pickers — customers + inventory items (stock levels) |
| POST   | `/api/sales`        | owner/supervisor| Record a sale — total recomputed server-side; lines linked to inventory deduct stock in one transaction (409 when insufficient); free-text lines don't touch stock |
| GET    | `/api/customers`    | owner/supervisor| Customer list with per-customer sale counts |
| POST   | `/api/customers`    | owner/supervisor| Add a customer (name required; phone/email/address optional) |
| PATCH  | `/api/customers/:id`| owner/supervisor| Edit a customer's name and contact details |
| DELETE | `/api/customers/:id`| owner/supervisor| Remove a customer — **409** while they have sales (history keeps the name attached) |
| GET    | `/api/inventory`     | owner/supervisor| Item list — optional filters `category`, `low` (at/below reorder level), `q` (name/code), `limit` (1–500, default 50) + `count` · supervisor: own department's categories only |
| GET    | `/api/inventory/categories` | owner/supervisor| Categories, **read-only** (name, department, item count) — supervisor: own department |
| POST   | `/api/inventory`     | owner/supervisor| Add an item (name, unit, category, opening qty ≥ 0, reorder level, unit cost, optional code — **409** on a duplicate code); supervisor: own department only |
| PATCH  | `/api/inventory/:id` | owner/supervisor| Edit an item's details — quantity is **not** editable (stock moves through movements only); **403** across departments |
| DELETE | `/api/inventory/:id` | owner/supervisor| Remove an item — **409** while sales or movements reference it (history outlives edits) |
| GET    | `/api/inventory/movements` | owner/supervisor| Movement log, newest first — filters `item`, `type` (`stock_in`\|`stock_out`\|`adjustment`), `dateFrom`/`dateTo` (inclusive), `limit` + `count`; mixes manual rows with sale `stock_out`s |
| POST   | `/api/inventory/movements` | owner/supervisor| Record a movement atomically (item row locked): in/out qty > 0, **stock_out ≤ on-hand → 409**, adjustment = signed delta that never takes stock below zero (**409**) |
| GET    | `/api/crops`        | owner       | Crop registry, newest first |
| POST   | `/api/crops`        | owner       | Add a crop (name, optional variety/area/planted date/notes) |
| GET    | `/api/livestock`    | owner       | Livestock registry, newest first |
| POST   | `/api/livestock`    | owner       | Add an animal record (species, optional breed/quantity/location/acquired date/notes) |
| GET    | `/api/expenses`     | owner       | Expense ledger, newest first — filters `dateFrom`/`dateTo` (inclusive days), `category`, `method`, `q` (description search), `limit` (1–500, default 50) + `count` |
| POST   | `/api/expenses`     | owner       | Record an expense (category, description, amount > 0, date, payment method) |
| PATCH  | `/api/expenses/:id` | owner       | Edit an expense's category, description, amount, date or payment method |
| DELETE | `/api/expenses/:id` | owner       | Remove an expense — hard delete (nothing references expense rows) |

All responses are JSON: `{ ok: boolean, message: string, ... }`.

Clock and entry writes carry the **client's wall clock** (`date: 'YYYY-MM-DD'`,
`time: 'HH:MM'`) so the stored DATE + TIME are the farm's local time, exactly
what the worker's screen renders back.

Every signup/signin attempt is recorded in the `auth_attempts` table
(action, outcome, email, reason code, IP — never passwords), so failures
such as a closed owner bootstrap or a validation error leave a trace.

## Signup rules (roles ↔ screens)

The frontend has **3 roles** (`owner`, `supervisor`, `worker`) and **4 routable
screens** (owner, crop supervisor, livestock supervisor, worker). The bridge is
the **department** field:

- `owner` — no department, single `/dashboard` workspace.
- `supervisor` + `crops` → crop supervisor (shared `/supervisor` shell, data scoped to Crop Production).
- `supervisor` + `livestock` → livestock supervisor (same shell, Animal Rearing data).
- `worker` + department → `/worker` workspace scoped to their department.

Signup only offers `crops` / `livestock` (the two departmental screens). The
other three DB departments (Stores, Sales, Administration) are reserved for
later.

**Owner accounts:** the very first owner may self-register (bootstrap). After
that, `signup` with `role: owner` returns 403 unless the request carries a
valid owner session cookie — owners create owners.

## Demo accounts (seeded by `npm run setup-db`)

| Role       | Email                       | Password  |
| ---------- | --------------------------- | --------- |
| Owner      | `owner@farmis.com`          | Farmis123 |
| Crops supervisor | `crops@farmis.com`    | Farmis123 |
| Livestock supervisor | `livestock@farmis.com` | Farmis123 |
| Crops worker | `crops.worker@farmis.com` | Farmis123 |
| Livestock worker | `livestock.worker@farmis.com` | Farmis123 |

## Environment (`.env`)

Copy `.env.example` → `.env`. Key values:

- `PORT=4000`
- `CLIENT_ORIGIN=http://localhost:4200` — origins allowed to call this API
  with credentials (comma-separated list supported)
- `DATABASE_URL` — **or** the individual `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE`.
  `DATABASE_URL` (Neon/Render style) takes precedence when set.
- `JWT_SECRET` — random 96-hex string, **never commit `.env`**
- `JWT_TTL=7d`, `COOKIE_NAME=farmis_token`

## Deployment (Render + Neon)

Production is described by [`render.yaml`](../render.yaml) at the repo root:

| Piece | Value |
| --- | --- |
| Service | `farmis-backend`, Node runtime, **free** plan, `rootDir: backend` |
| Build / start | `npm ci` → `npm start` |
| Health check | `GET /api/health` |
| `NODE_ENV` | `production` |
| `CLIENT_ORIGIN` | `https://wakadala-star.github.io` |
| `DATABASE_URL` | prompted at Blueprint creation (`sync: false`) |
| `JWT_SECRET` | generated once by Render (`generateValue: true`) |

Steps (first time only):

1. **Neon** — create a project, copy the connection string
   (contains `?sslmode=require`; `pg` handles it).
2. **Seed Neon** from your machine:
   `DATABASE_URL="postgres://…" npm run setup-db` (migrations + 5 demo
   users + demo farm data; creation of the database is skipped because
   Neon already provides it).
3. **Render** — New → Blueprint → pick this repo. Render reads
   `render.yaml`, prompts for `DATABASE_URL` (paste the Neon string), and
   deploys `backend/` only — frontend changes never rebuild the API.
4. Note the final service URL (e.g. `https://farmis-backend.onrender.com`) and
   keep `frontend/src/environments/environment.prod.ts` pointing at it
   (`…/api`).

Behaviour differences in production:

- The cookie is `SameSite=None; Secure` (GitHub Pages ↔ Render is a
  cross-site pair); local dev stays `SameSite=Lax` over http.
- CORS allows exactly the origin in `CLIENT_ORIGIN`.
- The free plan sleeps after ~15 min idle (first request ~50 s).

## Database

The schema is managed by **migrations** in [`db/migrations/`](db/migrations/):

| File | Adds |
| --- | --- |
| `001_initial_schema.sql` | The original 12 tables + role/department seeds (guards: `IF NOT EXISTS`) |
| `002_attendance_approval.sql` | `attendance.approval_status/approved_by/approved_at` (clock-in → approve workflow) |
| `003_field_entries.sql` | `field_entries` — worker data-entry records |
| `004_credit_requests.sql` | `credit_requests` — supervisor transaction approvals |
| `005_daily_reports.sql` | `daily_reports` — worker daily work logs (hours + summary) |
| `006_operations_reports.sql` | `operations_reports` — generated report snapshots (JSONB lines) |
| `007_auth_attempts.sql` | `auth_attempts` — signup/signin audit log |

Rules:

- Applied by `npm run migrate` (or `npm run setup-db`); each file runs in
  its own transaction and is recorded in `schema_migrations`, so re-running
  is a no-op.
- **Migrations never drop or rewrite existing data.** New schema changes go
  in as a new numbered file — never edit an applied one.
- `db/schema.sql` is the legacy full-reset script (it drops everything);
  keep it for wiping a **local** database only, never one with real data.
- To change the production schema: add a migration, run
  `DATABASE_URL="postgres://…" npm run migrate` from your machine, then
  push (Render deploys the code; the DB is already migrated).

`schema.sql` is a PostgreSQL port of the original MySQL script
(`../db/mkwasi_agri_business.sql`) — same 12 tables, with:

- `INT UNSIGNED AUTO_INCREMENT` → `BIGSERIAL`
- `ENUM(...)` → `VARCHAR` + `CHECK` constraints
- `ON UPDATE CURRENT_TIMESTAMP` → `set_updated_at()` trigger
- roles seeded as `owner / supervisor / worker` (frontend-aligned)
- case-insensitive unique email index for sign-in lookups
