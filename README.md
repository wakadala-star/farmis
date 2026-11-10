# FARMIS 🌱

**Farm Management Information System (MIS) for Mukwasi Agri Business**

[![Deploy frontend to GitHub Pages](https://github.com/wakadala-star/farmis/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/wakadala-star/farmis/actions/workflows/deploy-pages.yml)

### 🌐 Live preview: **https://wakadala-star.github.io/farmis/**

The preview is rebuilt and deployed automatically by GitHub Actions on every
push to `main` that touches `frontend/`.

---

## About

FARMIS makes agriculture easy to handle and manage with just clicks. It gives
a farm owner a live overview of livestock, crops, sales and upcoming
activities, while supervisors run their department and workers record the
day's work — all through role-based workspaces.

## Screens included

- **Sign in / Sign up** — clean reactive form, password reveal, role
  selection and department pick (Crops · Livestock)
- **Owner workspace** — dashboard with stat cards, Farm Performance chart,
  alerts, recent sales and quick actions, plus Crop and Livestock
  management pages (meta tiles, alerts, supervisor updates feed)
- **Supervisor workspace** (crop & livestock supervisors share it, scoped to
  their department) — Dashboard, Tasks (assign & track), Reports (generate
  operations reports), Attendance (confirm clock-ins/outs), Transactions
  (approve worker credit requests), Workers (recruit, assign, remove)
- **Worker workspace** — My Tasks, Data Entry (crop/livestock stats),
  Daily Reports, Attendance with a topbar clock button: one tap starts a
  live h:mm:ss work timer, tapping again turns the button red for **Clock
  Out**, and the time record waits in the supervisor's Attendance page for
  approval
- **Responsive shell** — collapsible sidebar on desktop, drawer + bottom
  navigation with centre FAB on mobile

Role-based routing is live: each role lands on, and is locked to, its own
workspace. Sign-in/sign-up talk to the real backend API (JWT + bcrypt);
the farm data itself is still a mock layer (`FarmDataService`) shared
through `localStorage`, so tasks, clock-ins and approvals flow between
roles during the demo.

## Tech stack

- Angular 22 (standalone components, signals, new control flow)
- Node.js 24 + Express 5 backend (`backend/`) with JWT (httpOnly cookie)
  authentication, bcrypt password hashing and role/department authorization
- PostgreSQL (`mukwasi_agri_business`) — 12 tables, schema + demo users
  applied by `npm run setup-db`
- SCSS design-token system · Font Awesome 7 · Inter
- Mock farm data via `FarmDataService` — the single place left to swap in
  real HTTP calls once the API grows beyond auth

## Getting started

Requires PostgreSQL running locally (see `backend/.env`).

```bash
# 1. API — creates the DB, applies the schema, seeds the demo users
cd backend
npm install
npm run setup-db
npm start            # http://localhost:4000/api/health

# 2. UI — in a second terminal
cd frontend
npm install
npm start            # http://localhost:4200 (opens on /signin)
npm run build        # production build → dist/frontend/browser
```

The frontend reaches the API at `http://localhost:4000/api`
(`frontend/src/environments/environment.ts`); the production build uses
`environment.prod.ts` instead (see Deployment).

**Demo accounts** (seeded into the database by `npm run setup-db` — sign-in
is a clean form, password `Farmis123` for all five):

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Farm Owner | `owner@farmis.com` | `Farmis123` | `/dashboard` |
| Crop Supervisor | `crops@farmis.com` | `Farmis123` | `/supervisor` |
| Livestock Supervisor | `livestock@farmis.com` | `Farmis123` | `/supervisor` |
| Crops Worker | `crops.worker@farmis.com` | `Farmis123` | `/worker` |
| Livestock Worker | `livestock.worker@farmis.com` | `Farmis123` | `/worker` |

Sign-up also works: new supervisor/worker accounts choose a department and
route to the matching workspace. Owner sign-up is restricted — the first
owner bootstraps, later owners are created by an existing owner session
(see `backend/README.md`).

## Project structure

```
backend/            Express API (auth + authorization)
├── db/schema.sql   PostgreSQL schema (12 tables + role/department seeds)
├── src/            routes, controllers, middleware, config
└── scripts/ …      npm run setup-db (schema + demo users)
frontend/
├── public/images/        logo, favicon, promo photo, placeholder uploads
├── src/app/
│   ├── core/             AuthService (HTTP), api.ts, guards, models
│   ├── features/         auth, owner dashboard + crops/livestock,
│   │                     supervisor (6 screens), worker (4 screens)
│   ├── layouts/          auth layout, owner shell, supervisor shell,
│   │                     worker shell (topbar clock control)
│   └── shared/           brand, management view, performance chart
└── src/styles/           design tokens + component SCSS
```

## Placeholder assets

`promo-farm.jpg` and `logo.png` are in place — `avatar.png` is the last
placeholder; see the [assets README](frontend/public/images/README.md).

## Deployment

Two services, both auto-deployed from `main`:

| Piece | Where | Trigger |
| --- | --- | --- |
| Frontend (Angular) | **GitHub Pages** — https://wakadala-star.github.io/farmis/ | `.github/workflows/deploy-pages.yml` on pushes touching `frontend/` |
| Backend (Express) | **Render** free web service — https://farmis-backend.onrender.com | `render.yaml` blueprint, builds only `backend/` |
| Database (PostgreSQL) | **Neon** (serverless Postgres) | connection string stored as `DATABASE_URL` on Render |

The Pages build uses `environment.prod.ts`, which points the app at the
Render API; the backend allows that origin via `CLIENT_ORIGIN` and sets the
session cookie `SameSite=None; Secure` (the two sites are cross-site).
Deep links work via a generated `404.html` SPA fallback.

First-time backend setup on Render/Neon: create the Neon project, run
`npm run setup-db` against its connection string (locally, with
`DATABASE_URL=…`), then create the Blueprint in Render — it prompts for
`DATABASE_URL` and generates `JWT_SECRET`. See `backend/README.md` for
details. Note the free Render service sleeps after ~15 min idle, so the
first request takes ~50 s to wake up.
