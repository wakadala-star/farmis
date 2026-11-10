import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth.guard';
import { OwnerDashboard } from './features/dashboard/owner-dashboard/owner-dashboard';
import { OwnerCrops } from './features/crops/owner-crops/owner-crops';
import { OwnerLivestock } from './features/livestock/owner-livestock/owner-livestock';
import { SupervisorDashboard } from './features/supervisor/dashboard/supervisor-dashboard';
import { SupervisorTasks } from './features/supervisor/tasks/supervisor-tasks';
import { SupervisorReports } from './features/supervisor/reports/supervisor-reports';
import { SupervisorAttendance } from './features/supervisor/attendance/supervisor-attendance';
import { SupervisorTransactions } from './features/supervisor/transactions/supervisor-transactions';
import { SupervisorWorkers } from './features/supervisor/workers/supervisor-workers';
import { WorkerTasks } from './features/worker/tasks/worker-tasks';
import { WorkerDataEntry } from './features/worker/data-entry/worker-data-entry';
import { WorkerReports } from './features/worker/reports/worker-reports';
import { WorkerAttendance } from './features/worker/attendance/worker-attendance';
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
 * authenticates against the mock auth service and each role lands on
 * its own workspace:
 *
 *   owner      → /dashboard  (+ /crops, /livestock)
 *   supervisor → /supervisor (+ /tasks, /reports, /attendance,
 *                             /transactions, /workers)
 *   worker     → /worker     (+ /data-entry, /reports, /attendance)
 *
 * Each workspace uses a single shell instance so the sidebar, topbar,
 * drawer and bottom-nav state survive navigation between its pages.
 * roleGuard keeps every role on its own side of the system.
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
    path: '',
    component: OwnerLayout,
    canActivate: [roleGuard('owner')],
    children: [
      { path: 'dashboard', component: OwnerDashboard },
      { path: 'crops', component: OwnerCrops },
      { path: 'livestock', component: OwnerLivestock },
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
      { path: 'dashboard', component: SupervisorDashboard },
      { path: 'tasks', component: SupervisorTasks },
      { path: 'reports', component: SupervisorReports },
      { path: 'attendance', component: SupervisorAttendance },
      { path: 'transactions', component: SupervisorTransactions },
      { path: 'workers', component: SupervisorWorkers },
    ],
  },

  // Worker workspace
  {
    path: 'worker',
    component: WorkerLayout,
    canActivate: [roleGuard('worker')],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'tasks' },
      { path: 'tasks', component: WorkerTasks },
      { path: 'data-entry', component: WorkerDataEntry },
      { path: 'reports', component: WorkerReports },
      { path: 'attendance', component: WorkerAttendance },
    ],
  },

  { path: '**', redirectTo: 'signin' },
];
