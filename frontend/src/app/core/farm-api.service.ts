import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { API_BASE } from './api';
import {
  AttendanceRec,
  DataEntryRec,
  FarmTask,
  WorkerReportRec,
  dayKey,
  startOfDay,
} from './farm-data.service';
import { Department } from './models';

/* ============================================================
   REAL FARM DATA against the FARMIS backend (Phase 2B).
   Replaces FarmDataService's localStorage layer for the worker
   screens: lists load once per session (per collection) and
   every action is an HTTP call, so data lives in PostgreSQL
   and is shared across devices and browsers.

   The record shapes match FarmDataService's types exactly, so
   the page templates keep rendering the same way.
   ============================================================ */

export interface ActionResult {
  ok: boolean;
  message: string;
}

type Collection = 'tasks' | 'attendance' | 'entries' | 'reports';

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

interface RecordResponse<T> {
  ok: boolean;
  message: string;
  record: T;
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

  private readonly _tasks = signal<FarmTask[]>([]);
  private readonly _attendance = signal<AttendanceRec[]>([]);
  private readonly _entries = signal<DataEntryRec[]>([]);
  private readonly _reports = signal<WorkerReportRec[]>([]);
  private readonly _state = signal<Record<Collection, LoadState>>({
    tasks: fresh(),
    attendance: fresh(),
    entries: fresh(),
    reports: fresh(),
  });

  /* ---------------- read-only views ---------------- */

  readonly tasks = this._tasks.asReadonly();
  readonly attendance = this._attendance.asReadonly();
  readonly entries = this._entries.asReadonly();
  readonly reports = this._reports.asReadonly();

  readonly tasksLoading = computed(() => this._state().tasks.loading);
  readonly tasksError = computed(() => this._state().tasks.error);
  readonly attendanceLoading = computed(() => this._state().attendance.loading);
  readonly attendanceError = computed(() => this._state().attendance.error);
  readonly entriesLoading = computed(() => this._state().entries.loading);
  readonly entriesError = computed(() => this._state().entries.error);
  readonly reportsLoading = computed(() => this._state().reports.loading);
  readonly reportsError = computed(() => this._state().reports.error);

  /** The shift that is open right now (clocked in, no clock-out). */
  readonly runningRecord = computed<AttendanceRec | null>(
    () => this.attendance().find((rec) => rec.status === 'running') ?? null,
  );

  /** Own records waiting for the supervisor's approval (topbar badge). */
  readonly pendingCount = computed(
    () => this.attendance().filter((rec) => rec.status === 'pending').length,
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
      } else {
        const res = await this.get<{ reports: WorkerReportRec[] }>('/reports/mine');
        this._reports.set(res.reports ?? []);
      }
      this.patch(col, { loading: false, loaded: true, error: '' });
    } catch (err) {
      if (!silent) this.patch(col, { loading: false, error: apiMessage(err) });
    }
  }

  /* ---------------- actions ---------------- */

  /** Opens today's shift (POST /attendance/clock-in). */
  clockIn(): Promise<ActionResult> {
    return this.postAndRefresh('/attendance/clock-in', { date: dayKey(), time: localClock() }, 'attendance');
  }

  /** Closes the open shift (POST /attendance/clock-out). */
  clockOut(): Promise<ActionResult> {
    return this.postAndRefresh('/attendance/clock-out', { time: localClock() }, 'attendance');
  }

  /** Records a field/livestock activity (POST /entries). */
  addEntry(input: {
    activity: string;
    place: string;
    subject: string;
    measure: string;
    notes: string;
  }): Promise<ActionResult> {
    return this.postAndRefresh('/entries', { date: dayKey(), ...input }, 'entries');
  }

  /** Files a daily report (POST /reports). */
  submitReport(input: {
    task: string;
    date: string;
    hours: number;
    summary: string;
  }): Promise<ActionResult> {
    return this.postAndRefresh('/reports', input, 'reports');
  }

  /* ---------------- internals ---------------- */

  private async postAndRefresh(
    path: string,
    body: unknown,
    col: Collection,
  ): Promise<ActionResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<RecordResponse<unknown>>(`${API_BASE}${path}`, body),
      );
      // Refresh the affected list so ordering/back-dated rows stay correct.
      await this.load(col, true);
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
