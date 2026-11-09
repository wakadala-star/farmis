# FARMIS 🌱

**Farm Management Information System (MIS) for Mkwasi Agri Business**

[![Deploy frontend to GitHub Pages](https://github.com/wakadala-star/farmis/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/wakadala-star/farmis/actions/workflows/deploy-pages.yml)

### 🌐 Live preview: **https://wakadala-star.github.io/farmis/**

The preview is rebuilt and deployed automatically by GitHub Actions on every
push to `main` that touches `frontend/`.

---

## About

FARMIS makes agriculture easy to handle and manage with just clicks. It gives
a farm owner a live overview of livestock, crops, sales, employees and
upcoming activities, with Supervisor and Worker roles planned next.

## Screens included

- **Sign in / Sign up** — reactive form validation, password reveal, role
  selection (Farm Owner · Supervisor · Worker), prefilled demo account
- **Owner dashboard** — stat cards, Farm Performance chart, alerts,
  recent sales, upcoming activities, quick actions
- **Responsive shell** — collapsible sidebar on desktop, drawer + bottom
  navigation with centre FAB on mobile

> Supervisor and Worker screens are on the way in a coming update.

## Tech stack

- Angular 22 (standalone components, signals, new control flow)
- SCSS design-token system · Font Awesome 7 · Inter
- Mock authentication via `localStorage` (`AuthService`) — the single place
  to swap in real HTTP calls when the backend arrives

## Getting started

```bash
cd frontend
npm install
npm start        # http://localhost:4200 (opens on /signin)
npm run build    # production build → dist/frontend/browser
```

**Demo account** (prefilled on the sign-in screen):

| Email | Password |
| --- | --- |
| `owner@farmis.com` | `Farmis123` |

## Project structure

```
frontend/
├── public/images/        logo, favicon, placeholder uploads
├── src/app/
│   ├── core/             AuthService, guards, models
│   ├── features/         auth (sign-in, sign-up), dashboard
│   ├── layouts/          auth layout, owner shell (sidebar/topbar/bottom nav)
│   └── shared/           brand, performance chart
└── src/styles/           design tokens + component SCSS
```

## Placeholder assets

Upload real photos into `frontend/public/images/` — see the
[assets README](frontend/public/images/README.md) for the expected files
(`promo-farm.jpg`, `avatar.png`). The UI falls back gracefully until then.

## Deployment

`.github/workflows/deploy-pages.yml` builds the app with a `--base-href`
matching the repository name and publishes it to **GitHub Pages** on every
push. Deep links work via a generated `404.html` SPA fallback.
