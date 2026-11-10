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
npm run setup-db     # creates the DB, applies schema, seeds demo users
npm start             # or: npm run dev  (auto-restart on changes)
```

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
| GET    | `/api/users`       | owner/supervisor| Owner: all users · Supervisor: own department · Worker: 403 |

All responses are JSON: `{ ok: boolean, message: string, ... }`.

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
| Service | `farmis-api`, Node runtime, **free** plan, `rootDir: backend` |
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
   `DATABASE_URL="postgres://…" npm run setup-db` (schema + 5 demo users;
   creation of the database is skipped because Neon already provides it).
3. **Render** — New → Blueprint → pick this repo. Render reads
   `render.yaml`, prompts for `DATABASE_URL` (paste the Neon string), and
   deploys `backend/` only — frontend changes never rebuild the API.
4. Note the final service URL (e.g. `https://farmis-api.onrender.com`) and
   keep `frontend/src/environments/environment.prod.ts` pointing at it
   (`…/api`).

Behaviour differences in production:

- The cookie is `SameSite=None; Secure` (GitHub Pages ↔ Render is a
  cross-site pair); local dev stays `SameSite=Lax` over http.
- CORS allows exactly the origin in `CLIENT_ORIGIN`.
- The free plan sleeps after ~15 min idle (first request ~50 s).

## Database

`db/schema.sql` is a PostgreSQL port of the original MySQL script
(`../db/mkwasi_agri_business.sql`) — same 12 tables, with:

- `INT UNSIGNED AUTO_INCREMENT` → `BIGSERIAL`
- `ENUM(...)` → `VARCHAR` + `CHECK` constraints
- `ON UPDATE CURRENT_TIMESTAMP` → `set_updated_at()` trigger
- roles seeded as `owner / supervisor / worker` (frontend-aligned)
- case-insensitive unique email index for sign-in lookups
