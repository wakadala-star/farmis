# FARMIS — Frontend (Angular)

Management Information System for **Mukwasi Agri Business**.
This is the frontend for FARMIS: role-based farm management for the
Farm Owner, Supervisors and Workers.

## Running it

```bash
npm install
npm start        # ng serve → http://localhost:4200
npm run build    # production build → dist/frontend
```

## Screens implemented so far

| Route | Screen | Notes |
| --- | --- | --- |
| `/signin` | Sign in (default entry) | Clean form — demo logins documented below |
| `/signup` | Sign up (role + department dropdown) | Stores the account, then routes to sign in |
| `/dashboard`, `/crops`, `/livestock` | Owner workspace | Dashboard + crop/livestock management, `roleGuard('owner')` |
| `/supervisor/*` | Supervisor workspace | Dashboard · Tasks · Reports · Attendance · Transactions · Workers, `roleGuard('supervisor')` |
| `/worker/*` | Worker workspace | My Tasks · Data Entry · Daily Reports · Attendance, `roleGuard('worker')` |

Open the app at `http://localhost:4200` — it redirects to **`/signin`**
by default, and each role lands on its own workspace after sign-in.

### Demo credentials (type them in — nothing is prefilled)

| Role | Email | Password |
| --- | --- | --- |
| Farm Owner | `owner@farmis.com` | `Farmis123` |
| Crop Supervisor | `crops@farmis.com` | `Farmis123` |
| Livestock Supervisor | `livestock@farmis.com` | `Farmis123` |
| Crops Worker | `crops.worker@farmis.com` | `Farmis123` |
| Livestock Worker | `livestock.worker@farmis.com` | `Farmis123` |

Accounts created on the sign-up screen are stored in `localStorage`
as the stand-in database and can sign in immediately. Routing switches
on the session's role — supervisors and workers can never open the
owner side (and vice versa).

## Structure

```
src/app/
├── core/                  # models, mock AuthService, FarmDataService (mock DB), guards
├── layouts/
│   ├── auth-layout/       # split brand + form shell
│   ├── owner-layout/      # owner sidebar · topbar · drawer · bottom nav
│   ├── supervisor-layout/ # department-scoped shell for both supervisors
│   └── worker-layout/     # worker shell with the topbar clock control
├── features/
│   ├── auth/              # sign-in, sign-up
│   ├── dashboard/         # owner dashboard
│   ├── crops/, livestock/ # owner management pages (shared ManagementView)
│   ├── supervisor/        # dashboard, tasks, reports, attendance,
│   │                      # transactions, workers
│   └── worker/            # tasks, data-entry, reports, attendance
└── shared/                # brand (logo), management view, performance chart
src/styles/                # design tokens + global partials
public/images/             # drop-in image replacements (see README there)
```

## Design & responsiveness

- Visual system follows the FARMIS inspo: green theme, sidebar on
  desktop, bottom navigation with centre FAB on tablet/mobile.
- Breakpoints: ≥1280 full desktop · 992–1279 compact laptop ·
  768–991 tablet (drawer + bottom nav) · <768 phone.
- Icons: Font Awesome 7 (bundled via `angular.json`).
- Chart: hand-built CSS bars, no extra dependencies.

## Placeholders awaiting your assets

Put real images in `frontend/public/images/` (see the README there):

- `promo-farm.jpg` — ✅ in place (dashboard promo card background)
- `logo.png` — ✅ in place (FARMIS mark)
- `avatar.png` — user photo (currently initials)

## What is mocked (backend comes later)

- `AuthService` validates against `localStorage` — `signUp`, `signIn`
  and `signOut` are the only three methods to replace with HTTP calls.
- `FarmDataService` is the shared mock database (tasks, workers,
  attendance, data entries, reports, transactions) persisted to
  `localStorage` — its action methods are the ones to replace with API
  endpoints later.

Route guards, forms and navigation stay exactly as they are.
