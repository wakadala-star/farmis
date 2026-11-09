import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth.guard';
import { OwnerDashboard } from './features/dashboard/owner-dashboard/owner-dashboard';
import { SignIn } from './features/auth/sign-in/sign-in';
import { SignUp } from './features/auth/sign-up/sign-up';
import { AuthLayout } from './layouts/auth-layout/auth-layout';
import { OwnerLayout } from './layouts/owner-layout/owner-layout';

/**
 * FARMIS routes.
 *
 * The system opens on the sign-in form by default. Sign-in currently
 * authenticates against the mock auth service and always lands on the
 * owner dashboard — supervisor/worker dashboards will be added as
 * their screens are built (role routing then switches on session role).
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'signin' },

  // Authentication
  {
    path: '',
    component: AuthLayout,
    children: [
      { path: 'signin', component: SignIn, canActivate: [guestGuard] },
      { path: 'signup', component: SignUp, canActivate: [guestGuard] },
    ],
  },

  // Owner workspace
  {
    path: 'dashboard',
    component: OwnerLayout,
    canActivate: [authGuard],
    children: [{ path: '', component: OwnerDashboard }],
  },

  { path: '**', redirectTo: 'signin' },
];
