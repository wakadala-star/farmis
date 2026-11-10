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
workspace. The mock data layer (`FarmDataService`) is shared through
`localStorage`, so tasks, clock-ins and approvals flow between roles during
the demo.

## Tech stack

- Angular 22 (standalone components, signals, new control flow)
- SCSS design-token system · Font Awesome 7 · Inter
- Mock authentication via `localStorage` (`AuthService`) and mock farm data
  via `FarmDataService` — the two single places to swap in real HTTP calls
  when the backend arrives

## Getting started

```bash
cd frontend
npm install
npm start        # http://localhost:4200 (opens on /signin)
npm run build    # production build → dist/frontend/browser
```

**Demo accounts** (sign-in is a clean form — enter any of these):

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Farm Owner | `owner@farmis.com` | `Farmis123` | `/dashboard` |
| Crop Supervisor | `crops@farmis.com` | `Farmis123` | `/supervisor` |
| Livestock Supervisor | `livestock@farmis.com` | `Farmis123` | `/supervisor` |
| Crops Worker | `crops.worker@farmis.com` | `Farmis123` | `/worker` |
| Livestock Worker | `livestock.worker@farmis.com` | `Farmis123` | `/worker` |

Sign-up also works: new supervisor/worker accounts choose a department and
route to the matching workspace.

## Project structure

```
frontend/
├── public/images/        logo, favicon, promo photo, placeholder uploads
├── src/app/
│   ├── core/             AuthService, FarmDataService (mock DB), guards, models
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

`.github/workflows/deploy-pages.yml` builds the app with a `--base-href`
matching the repository name and publishes it to **GitHub Pages** on every
push. Deep links work via a generated `404.html` SPA fallback.
