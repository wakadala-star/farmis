import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './api';
import {
  AttendanceRec,
  DataEntryRec,
  FarmTask,
  GeneratedReport,
  TaskStatus,
  TransactionRec,
  WorkerRec,
  WorkerReportRec,
  dayKey,
  startOfDay,
} from './farm-data.service';
import { Department } from './models';

/* ============================================================
   REAL FARM DATA against the FARMIS backend (Phase 2B + 2C).

   Phase 2B moved the worker screens here; Phase 2C adds the
   supervisor loop (department tasks, attendance approvals,
   credit decisions, recruit/offboard, operations reports) and
   the worker's own credit requests.

   The record shapes match FarmDataService's types exactly, so
   the page templates keep rendering the same way.
   ============================================================ */

export interface ActionResult {
  ok: boolean;
  message: string;
}

type Collection =
  | 'tasks'
  | 'attendance'
  | 'entries'
  | 'reports'
  | 'workers'
  | 'deptTasks'
  | 'deptAttendance'
  | 'transactions'
  | 'myTransactions'
  | 'deptReports'
  | 'opsReports';

interface LoadState {
  loading: boolean;
  loaded: boolean;
  error: string;
}

/* --- raw API payloads (before mapping) --- */

interface ApiAttendance {
  id: string;
  worker: string;
  dept: Department;
  date: string; // YYYY-MM-DD
  checkIn: string; // HH:MM
  checkOut: string | null; // HH:MM — null while running
  status: 'running' | 'pending' | 'approved' | 'rejected';
}

/** A row of GET /api/users (supervisor's team + owner's full list). */
interface ApiUser {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: string;
  department: Department | null;
  employmentStatus: 'active' | 'inactive';
  hireDate: string | null;
  createdAt: string;
}

interface RecordResponse<T> {
  ok: boolean;
  message: string;
  record?: T;
}

const fresh = (): LoadState => ({ loading: false, loaded: false, error: '' });

/** '08:02' → milliseconds past local midnight. */
function timeMs(clock: string): number {
  const [h, m, s] = clock.split(':').map(Number);
  return ((h * 60 + (m || 0)) * 60 + (s || 0)) * 1000;
}

/** The stored DATE + wall-clock times → an epoch in *this* browser's zone. */
function toAttendanceRec(raw: ApiAttendance): AttendanceRec {
  const start = startOfDay(raw.date);
  return {
    id: raw.id,
    worker: raw.worker,
    dept: raw.dept,
    date: raw.date,
    clockIn: start + timeMs(raw.checkIn),
    clockOut: raw.checkOut ? start + timeMs(raw.checkOut) : undefined,
    status: raw.status,
  };
}

/**
 * GET /users row → WorkerRec, keeping only the ACTIVE workers with a
 * department (supervisors see their own team; inactive/offboarded
 * accounts and non-worker roles drop out of the team list).
 */
function toWorkerRec(row: ApiUser): WorkerRec | null {
  if (row.role !== 'worker' || row.employmentStatus !== 'active' || !row.department) {
    return null;
  }
  return {
    id: row.id,
    name: row.fullName,
    email: row.email,
    dept: row.department,
    joined: String(row.createdAt).slice(0, 10), // 'YYYY-MM-DD'
  };
}

/** 'HH:MM' for the client wall clock (matches what the DB stores). */
function localClock(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Extract the backend's { ok, message } body from an HTTP error. */
function apiMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string } | null;
    if (body?.message) return body.message;
    if (err.status === 0) return 'Cannot reach the FARMIS server. Please try again.';
    return `Request failed (${err.status}).`;
  }
  return 'Something went wrong. Please try again.';
}

@Injectable({ providedIn: 'root' })
export class FarmApiService {
  private readonly http = inject(HttpClient);

  /* --- worker collections (Phase 2B) --- */
  private readonly _tasks = signal<FarmTask[]>([]);
  private readonly _attendance = signal<AttendanceRec[]>([]);
  private readonly _entries = signal<DataEntryRec[]>([]);
  private readonly _reports = signal<WorkerReportRec[]>([]);

  /* --- supervisor loop + worker credit (Phase 2C) --- */
  private readonly _workers = signal<WorkerRec[]>([]);
  private readonly _deptTasks = signal<FarmTask[]>([]);
  private readonly _deptAttendance = signal<AttendanceRec[]>([]);
  private readonly _transactions = signal<TransactionRec[]>([]);
  private readonly _myTransactions = signal<TransactionRec[]>([]);
  private readonly _deptReports = signal<WorkerReportRec[]>([]);
  private readonly _opsReports = signal<GeneratedReport[]>([]);

  private readonly _state = signal<Record<Collection, LoadState>>({
    tasks: fresh(),
    attendance: fresh(),
    entries: fresh(),
    reports: fresh(),
    workers: fresh(),
    deptTasks: fresh(),
    deptAttendance: fresh(),
    transactions: fresh(),
    myTransactions: fresh(),
    deptReports: fresh(),
    opsReports: fresh(),
  });

  /* ---------------- read-only views ---------------- */

  readonly tasks = this._tasks.asReadonly();
  readonly attendance = this._attendance.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly reports = this._reports.asReadonly();
  readonly workers = this._workers.asReadonly();
  readonly deptTasks = this._deptTasks.asReadonly();
  readonly deptAttendance = this._deptAttendance.asReadonly();
  readonly transactions = this._transactions.asReadonly();
  readonly myTransactions = this._myTransactions.asReadonly();
  readonly deptReports = this._deptReports.asReadonly();
  readonly opsReports = this._opsReports.asReadonly();

  readonly tasksLoading = computed(() => this._state().tasks.loading);
  readonly tasksError = computed(() => this._state().tasks.error);
  readonly attendanceLoading = computed(() => this._state().attendance.loading);
  readonly attendanceError = computed(() => this._state().attendance.error);
  readonly entriesLoading = computed(() => this._state().entries.loading);
  readonly entriesError = computed(() => this._state().entries.error);
  readonly reportsLoading = computed(() => this._state().reports.loading);
  readonly reportsError = computed(() => this._state().reports.error);
  readonly workersLoading = computed(() => this._state().workers.loading);
  readonly workersError = computed(() => this._state().workers.error);
  readonly deptTasksLoading = computed(() => this._state().deptTasks.loading);
  readonly deptTasksError = computed(() => this._state().deptTasks.error);
  readonly deptAttendanceLoading = computed(() => this._state().deptAttendance.loading);
  readonly deptAttendanceError = computed(() => this._state().deptAttendance.error);
  readonly transactionsLoading = computed(() => this._state().transactions.loading);
  readonly transactionsError = computed(() => this._state().transactions.error);
  readonly myTransactionsLoading = computed(() => this._state().myTransactions.loading);
  readonly myTransactionsError = computed(() => this._state().myTransactions.error);
  readonly deptReportsLoading = computed(() => this._state().deptReports.loading);
  readonly deptReportsError = computed(() => this._state().deptReports.error);
  readonly opsReportsLoading = computed(() => this._state().opsReports.loading);
  readonly opsReportsError = computed(() => this._state().opsReports.error);

  /** The shift that is open right now (clocked in, no clock-out). */
  readonly runningRecord = computed<AttendanceRec | null>(
    () => this.attendance().find((rec) => rec.status === 'running') ?? null,
  );

  /** Own records waiting for the supervisor's approval (topbar badge). */
  readonly pendingCount = computed(
    () => this.attendance().filter((rec) => rec.status === 'pending').length,
  );

  /** Clock-outs + credit requests waiting on this supervisor (bell badge). */
  readonly supervisorPendingCount = computed(
    () =>
      this.deptAttendance().filter((rec) => rec.status === 'pending').length +
      this.transactions().filter((tx) => tx.status === 'pending').length,
  );

  /* ---------------- loading ---------------- */

  /** Load a collection once per session; retries after an error. */
  async ensure(col: Collection): Promise<void> {
    const state = this._state()[col];
    if (state.loaded || state.loading) return;
    await this.load(col);
  }

  private async load(col: Collection, silent = false): Promise<void> {
    if (!silent) this.patch(col, { loading: true, error: '' });
    try {
      if (col === 'tasks') {
        const res = await this.get<{ tasks: FarmTask[] }>('/tasks/mine');
        this._tasks.set(res.tasks ?? []);
      } else if (col === 'attendance') {
        const res = await this.get<{ attendance: ApiAttendance[] }>('/attendance/mine');
        this._attendance.set((res.attendance ?? []).map(toAttendanceRec));
      } else if (col === 'entries') {
        const res = await this.get<{ entries: DataEntryRec[] }>('/entries');
        this._entries.set(res.entries ?? []);
      } else if (col === 'reports') {
        const res = await this.get<{ reports: WorkerReportRec[] }>('/reports/mine');
        this._reports.set(res.reports ?? []);
      } else if (col === 'workers') {
        const res = await this.get<{ users: ApiUser[] }>('/users');
        this._workers.set(
          (res.users ?? [])
            .map(toWorkerRec)
            .filter((w): w is WorkerRec => w !== null),
        );
      } else if (col === 'deptTasks') {
        const res = await this.get<{ tasks: FarmTask[] }>('/tasks/department');
        this._deptTasks.set(res.tasks ?? []);
      } else if (col === 'deptAttendance') {
        const res = await this.get<{ attendance: ApiAttendance[] }>(
          '/attendance/department',
        );
        this._deptAttendance.set((res.attendance ?? []).map(toAttendanceRec));
      } else if (col === 'transactions') {
        const res = await this.get<{ transactions: TransactionRec[] }>(
          '/transactions/department',
        );
        this._transactions.set(res.transactions ?? []);
      } else if (col === 'myTransactions') {
        const res = await this.get<{ transactions: TransactionRec[] }>(
          '/transactions/mine',
        );
        this._myTransactions.set(res.transactions ?? []);
      } else if (col === 'deptReports') {
        const res = await this.get<{ reports: WorkerReportRec[] }>(
          '/reports/department',
        );
        this._deptReports.set(res.reports ?? []);
      } else {
        const res = await this.get<{ generated: GeneratedReport[] }>(
          '/reports/operations',
        );
        this._opsReports.set(res.generated ?? []);
      }
      this.patch(col, { loading: false, loaded: true, error: '' });
    } catch (err) {
      if (!silent) this.patch(col, { loading: false, error: apiMessage(err) });
    }
  }

  /* ---------------- worker actions (2B) ---------------- */

  /** Opens today's shift (POST /attendance/clock-in). */
  clockIn(): Promise<ActionResult> {
    return this.send('POST', '/attendance/clock-in', { date: dayKey(), time: localClock() }, 'attendance');
  }

  /** Closes the open shift (POST /attendance/clock-out). */
  clockOut(): Promise<ActionResult> {
    return this.send('POST', '/attendance/clock-out', { time: localClock() }, 'attendance');
  }

  /** Records a field/livestock activity (POST /entries). */
  addEntry(input: {
    activity: string;
    place: string;
    subject: string;
    measure: string;
    notes: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/entries', { date: dayKey(), ...input }, 'entries');
  }

  /** Files a daily report (POST /reports). */
  submitReport(input: {
    task: string;
    date: string;
    hours: number;
    summary: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/reports', input, 'reports');
  }

  /** Worker asks for credit for a farm purchase (POST /transactions). */
  requestCredit(input: { amount: number; reason: string }): Promise<ActionResult> {
    return this.send('POST', '/transactions', input, 'myTransactions');
  }

  /* ---------------- supervisor actions (2C) ---------------- */

  /** Assigns a task to an active team worker (POST /tasks). */
  assignTask(input: {
    title: string;
    assignee: string; // worker's email
    due: string; // YYYY-MM-DD
    notes: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/tasks', input, 'deptTasks');
  }

  /** Cycles a task's status (PATCH /tasks/:id/status). */
  advanceTask(id: string, status: TaskStatus): Promise<ActionResult> {
    return this.send('PATCH', `/tasks/${id}/status`, { status }, 'deptTasks');
  }

  /** Approves/rejects a clock-out (POST /attendance/:id/decision). */
  decideAttendance(
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<ActionResult> {
    return this.send('POST', `/attendance/${id}/decision`, { decision }, 'deptAttendance');
  }

  /** Approves/rejects a credit request (POST /transactions/:id/decision). */
  decideTransaction(
    id: string,
    decision: 'approved' | 'rejected',
  ): Promise<ActionResult> {
    return this.send('POST', `/transactions/${id}/decision`, { decision }, 'transactions');
  }

  /** Recruits a worker into the supervisor's department (POST /users). */
  recruitWorker(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/users', input, 'workers');
  }

  /** Deactivates a team member's account (DELETE /users/:id). */
  removeWorker(id: string): Promise<ActionResult> {
    return this.send('DELETE', `/users/${id}`, undefined, 'workers');
  }

  /** Generates + stores an operations report (POST /reports/operations). */
  generateOpsReport(input: {
    type: string;
    period: string;
    periodStart: string; // YYYY-MM-DD
  }): Promise<ActionResult> {
    return this.send('POST', '/reports/operations', input, 'opsReports');
  }

  /* ---------------- internals ---------------- */

  private async send(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    col?: Collection,
  ): Promise<ActionResult> {
    try {
      const url = `${API_BASE}${path}`;
      const res =
        method === 'POST'
          ? await firstValueFrom(this.http.post<RecordResponse<unknown>>(url, body))
          : method === 'PATCH'
            ? await firstValueFrom(this.http.patch<RecordResponse<unknown>>(url, body))
            : await firstValueFrom(this.http.delete<RecordResponse<unknown>>(url));
      // Refresh the affected list so ordering/back-dated rows stay correct.
      if (col) await this.load(col, true);
      return { ok: res.ok !== false, message: res.message ?? 'Saved.' };
    } catch (err) {
      return { ok: false, message: apiMessage(err) };
    }
  }

  private get<T>(path: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(`${API_BASE}${path}`));
  }

  private patch(col: Collection, next: Partial<LoadState>): void {
    this._state.update((state) => ({ ...state, [col]: { ...state[col], ...next } }));
  }
}
