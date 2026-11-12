import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth.guard';
import { SignIn } from './features/auth/sign-in/sign-in';
import { SignUp } from './features/auth/sign-up/sign-up';
import { AuthLayout } from './layouts/auth-layout/auth-layout';
import { OwnerLayout } from './layouts/owner-layout/owner-layout';
import { SupervisorLayout } from './layouts/supervisor-layout/supervisor-layout';
import { WorkerLayout } from './layouts/worker-layout/worker-layout';

/**
 * FARMIS routes.
 *
 * The system opens on the sign-in form by default. Sign-in
 * authenticates against the backend auth service and each role lands
 * on its own workspace:
 *
 *   owner      → /dashboard  (+ /crops, /livestock, /workers)
 *   supervisor → /supervisor (+ /tasks, /reports, /attendance,
 *                             /transactions, /workers)
 *   worker     → /worker     (+ /data-entry, /reports, /attendance,
 *                             /transactions)
 *
 * Each workspace uses a single shell instance so the sidebar, topbar,
 * drawer and bottom-nav state survive navigation between its pages.
 * roleGuard keeps every role on its own side of the system.
 *
 * Workspace screens load lazily (`loadComponent`) — the initial
 * bundle carries the shells, guards and sign-in only, and each page
 * arrives as its own route chunk on first navigation.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'signin' },

  // Authentication (eager: this is the app's entry page)
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
    path: '',
    component: OwnerLayout,
    canActivate: [roleGuard('owner')],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/owner-dashboard/owner-dashboard').then(
            (m) => m.OwnerDashboard,
          ),
      },
      {
        path: 'crops',
        loadComponent: () =>
          import('./features/crops/owner-crops/owner-crops').then(
            (m) => m.OwnerCrops,
          ),
      },
      {
        path: 'livestock',
        loadComponent: () =>
          import('./features/livestock/owner-livestock/owner-livestock').then(
            (m) => m.OwnerLivestock,
          ),
      },
      {
        path: 'workers',
        loadComponent: () =>
          import('./features/hr/owner-workers/owner-workers').then(
            (m) => m.OwnerWorkers,
          ),
      },
      {
        path: 'sales',
        loadComponent: () =>
          import('./features/sales/sales-screen/sales-screen').then(
            (m) => m.SalesScreen,
          ),
      },
    ],
  },

  // Supervisor workspace (crop & livestock supervisors share it —
  // the session's department scopes every page)
  {
    path: 'supervisor',
    component: SupervisorLayout,
    canActivate: [roleGuard('supervisor')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/supervisor/dashboard/supervisor-dashboard').then(
            (m) => m.SupervisorDashboard,
          ),
      },
      {
        path: 'tasks',
        loadComponent: () =>
          import('./features/supervisor/tasks/supervisor-tasks').then(
            (m) => m.SupervisorTasks,
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/supervisor/reports/supervisor-reports').then(
            (m) => m.SupervisorReports,
          ),
      },
      {
        path: 'attendance',
        loadComponent: () =>
          import('./features/supervisor/attendance/supervisor-attendance').then(
            (m) => m.SupervisorAttendance,
          ),
      },
      {
        path: 'transactions',
        loadComponent: () =>
          import(
            './features/supervisor/transactions/supervisor-transactions'
          ).then((m) => m.SupervisorTransactions),
      },
      {
        path: 'workers',
        loadComponent: () =>
          import('./features/supervisor/workers/supervisor-workers').then(
            (m) => m.SupervisorWorkers,
          ),
      },
    ],
  },

  // Worker workspace
  {
    path: 'worker',
    component: WorkerLayout,
    canActivate: [roleGuard('worker')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tasks' },
      {
        path: 'tasks',
        loadComponent: () =>
          import('./features/worker/tasks/worker-tasks').then(
            (m) => m.WorkerTasks,
          ),
      },
      {
        path: 'data-entry',
        loadComponent: () =>
          import('./features/worker/data-entry/worker-data-entry').then(
            (m) => m.WorkerDataEntry,
          ),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/worker/reports/worker-reports').then(
            (m) => m.WorkerReports,
          ),
      },
      {
        path: 'attendance',
        loadComponent: () =>
          import('./features/worker/attendance/worker-attendance').then(
            (m) => m.WorkerAttendance,
          ),
      },
      {
        path: 'transactions',
        loadComponent: () =>
          import('./features/worker/transactions/worker-transactions').then(
            (m) => m.WorkerTransactions,
          ),
      },
    ],
  },

  { path: '**', redirectTo: 'signin' },
];
