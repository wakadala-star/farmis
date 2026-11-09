# FARMIS — Frontend (Angular)

Management Information System for **Mkwasi Agri Business**.
This is the frontend for FARMIS: role-based farm management for the
Farm Owner, Supervisors and Workers.

## Running it

```bash
npm install
npm start        # ng serve → http://localhost:4200
npm run build    # production build → dist/frontend
```

## Screens implemented so far

| Route      | Screen                     | Notes                                     |
| ---------- | -------------------------- | ----------------------------------------- |
| `/signin`  | Sign in (default entry)    | Prefilled demo owner credentials          |
| `/signup`  | Sign up (role dropdown)    | Stores the account, then routes to sign in |
| `/dashboard` | Owner dashboard          | Protected by `authGuard`                  |

Open the app at `http://localhost:4200` — it redirects to **`/signin`**
by default.

### Demo credentials (sign-in is prefilled)

- Email: `owner@farmis.com`
- Password: `Farmis123`

Accounts created on the sign-up screen are stored in `localStorage`
as the stand-in database and can sign in immediately. **Every role
currently lands on the owner dashboard** — supervisor and worker
screens arrive next, at which point routing switches to the session's
role.

## Structure

```
src/app/
├── core/                  # models, mock AuthService, route guards
├── layouts/
│   ├── auth-layout/       # split brand + form shell
│   └── owner-layout/      # sidebar · topbar · mobile drawer · bottom nav
├── features/
│   ├── auth/              # sign-in, sign-up
│   └── dashboard/         # owner dashboard
└── shared/                # brand (logo), performance chart (pure CSS)
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

- `promo-farm.jpg` — dashboard promo card photo (gradient shows until then)
- `logo.png` — FARMIS logo (currently a leaf icon)
- `avatar.png` — user photo (currently initials)

## What is mocked (backend comes later)

`AuthService` validates against `localStorage` — `signUp`, `signIn`
and `signOut` are the only three methods to replace with HTTP calls.
Route guards, forms and navigation stay exactly as they are.
