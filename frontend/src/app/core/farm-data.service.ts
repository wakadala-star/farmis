import { Injectable, computed, signal } from '@angular/core';
import { Department } from './models';

/* ============================================================
   MOCK FARM DATA — the stand-in database shared by the demo
   accounts. Everything lives in localStorage so a change made
   on one role's screen is visible on the other side:

     supervisor assigns task  → worker sees it under My Tasks
     worker clocks out        → record waits in Attendance
     worker submits entry     → shows in the department feed
     supervisor approves      → chip flips on both sides

   When the backend arrives, replace the action methods with
   HTTP calls — the page components will not change.
   ============================================================ */

export type TaskStatus = 'open' | 'in-progress' | 'done';
export type AttendanceStatus = 'running' | 'pending' | 'approved' | 'rejected';
export type TransactionStatus = 'pending' | 'approved' | 'rejected';

export interface FarmTask {
  id: string;
  title: string;
  notes: string;
  dept: Department;
  assignee: string;
  due: string; // YYYY-MM-DD
  status: TaskStatus;
}

export interface WorkerRec {
  id: string;
  name: string;
  email: string;
  dept: Department;
  joined: string; // YYYY-MM-DD
  /** Phase 2E: has a profile photo (team-list avatar). */
  hasAvatar?: boolean;
}

export interface AttendanceRec {
  id: string;
  worker: string;
  dept: Department;
  date: string; // YYYY-MM-DD of the clock-in
  clockIn: number; // epoch ms
  clockOut?: number; // epoch ms — absent while running
  status: AttendanceStatus;
}

export interface DataEntryRec {
  id: string;
  worker: string;
  dept: Department;
  date: string; // YYYY-MM-DD
  activity: string;
  place: string; // field / pen
  subject: string; // crop / animal
  measure: string;
  notes: string;
}

export interface WorkerReportRec {
  id: string;
  worker: string;
  dept: Department;
  date: string; // YYYY-MM-DD
  task: string;
  hours: number;
  summary: string;
}

export interface TransactionRec {
  id: string;
  worker: string;
  dept: Department;
  amount: number; // UGX
  reason: string;
  when: number; // epoch ms
  status: TransactionStatus;
}

export interface ReportLine {
  label: string;
  value: string;
}

export interface GeneratedReport {
  id: string;
  dept: Department;
  type: string;
  period: string;
  when: number; // epoch ms
  lines: ReportLine[];
}

interface FarmState {
  tasks: FarmTask[];
  workers: WorkerRec[];
  attendance: AttendanceRec[];
  entries: DataEntryRec[];
  workerReports: WorkerReportRec[];
  transactions: TransactionRec[];
  generated: GeneratedReport[];
}

const STATE_KEY = 'farmis.farmdata';
const HOUR = 3_600_000;
const DAY = 86_400_000;

/* ---------------- date & format helpers ---------------- */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM-DD shifted by whole days (negative = past). */
export function dayOffset(days: number): string {
  return dayKey(new Date(Date.now() + days * DAY));
}

/** Epoch ms for a YYYY-MM-DD key at local midnight. */
export function startOfDay(key: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** '07:12' — 24h local clock time. */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** '1:02:05' — h:mm:ss for the live work timer. */
export function fmtHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${pad(m)}:${pad(s % 60)}`;
}

/** '8h 53m' — compact worked-time label. */
export function fmtDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** 'Today' / 'Yesterday' / 'Nov 7' — friendly label for a day key. */
export function fmtDay(key: string): string {
  if (key === dayKey()) return 'Today';
  if (key === dayOffset(-1)) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/** 'UGX 45,000' — money with thousands separators. */
export function fmtMoney(amount: number): string {
  return `UGX ${amount.toLocaleString('en-US')}`;
}

/** Seconds worked between two clock times. */
export function workedSeconds(clockIn: number, clockOut?: number): number {
  return Math.floor(((clockOut ?? Date.now()) - clockIn) / 1000);
}

/** Chip tone class suffix for any workflow status. */
export function statusTone(
  status: AttendanceStatus | TaskStatus | TransactionStatus,
): string {
  switch (status) {
    case 'running':
      return 'live';
    case 'pending':
    case 'open':
      return 'amber';
    case 'in-progress':
      return 'blue';
    case 'approved':
    case 'done':
      return 'green';
    case 'rejected':
      return 'red';
    default:
      return 'neutral';
  }
}

/** Human label for any workflow status. */
export function statusLabel(
  status: AttendanceStatus | TaskStatus | TransactionStatus,
): string {
  switch (status) {
    case 'running':
      return 'On shift';
    case 'pending':
      return 'Pending';
    case 'open':
      return 'Open';
    case 'in-progress':
      return 'In progress';
    case 'approved':
      return 'Approved';
    case 'done':
      return 'Done';
    case 'rejected':
      return 'Rejected';
    default:
      return status;
  }
}

/* ---------------- seed data ---------------- */

function seedState(): FarmState {
  const now = Date.now();
  const today = dayKey();
  const yesterday = dayOffset(-1);

  return {
    workers: [
      { id: 'w1', name: 'Peter Ssegomba', email: 'peter@farmis.com', dept: 'crops', joined: dayOffset(-120) },
      { id: 'w2', name: 'Joyce Achieng', email: 'joyce@farmis.com', dept: 'crops', joined: dayOffset(-95) },
      { id: 'w3', name: 'Deo Byaruhanga', email: 'deo@farmis.com', dept: 'crops', joined: dayOffset(-40) },
      { id: 'w4', name: 'Daniel Okello', email: 'daniel@farmis.com', dept: 'livestock', joined: dayOffset(-110) },
      { id: 'w5', name: 'Rehema Nakigude', email: 'rehema@farmis.com', dept: 'livestock', joined: dayOffset(-75) },
      { id: 'w6', name: 'Moses Ssemakula', email: 'moses@farmis.com', dept: 'livestock', joined: dayOffset(-30) },
    ],
    tasks: [
      { id: 't1', title: 'Weed Field B', notes: 'Clear the eastern rows before the rains.', dept: 'crops', assignee: 'Peter Ssegomba', due: dayOffset(1), status: 'in-progress' },
      { id: 't2', title: 'Apply NPK to Plot C', notes: '12 bags, split between the two halves.', dept: 'crops', assignee: 'Joyce Achieng', due: dayOffset(2), status: 'open' },
      { id: 't3', title: 'Scout Field A for armyworm', notes: 'Report any funnel-shaped damage.', dept: 'crops', assignee: 'Peter Ssegomba', due: dayOffset(-1), status: 'done' },
      { id: 't4', title: 'Clean poultry house A', notes: 'Disinfect floors and refill the drinkers.', dept: 'livestock', assignee: 'Daniel Okello', due: dayOffset(1), status: 'in-progress' },
      { id: 't5', title: 'Restock feed — 10 bags', notes: 'Collect from the store with the requisition note.', dept: 'livestock', assignee: 'Rehema Nakigude', due: dayOffset(2), status: 'open' },
      { id: 't6', title: 'Count broiler chicks', notes: 'Record the morning count on the sheet.', dept: 'livestock', assignee: 'Moses Ssemakula', due: dayOffset(-1), status: 'done' },
    ],
    attendance: [
      { id: 'a1', worker: 'Peter Ssegomba', dept: 'crops', date: today, clockIn: now - 10 * HOUR, clockOut: now - 2 * HOUR, status: 'approved' },
      { id: 'a2', worker: 'Joyce Achieng', dept: 'crops', date: today, clockIn: now - 9 * HOUR, clockOut: now - HOUR, status: 'pending' },
      { id: 'a3', worker: 'Daniel Okello', dept: 'livestock', date: yesterday, clockIn: now - DAY - 9 * HOUR, clockOut: now - DAY - HOUR, status: 'approved' },
      { id: 'a4', worker: 'Rehema Nakigude', dept: 'livestock', date: today, clockIn: now - 8 * HOUR - 30 * 60_000, clockOut: now - 30 * 60_000, status: 'pending' },
      { id: 'a5', worker: 'Moses Ssemakula', dept: 'livestock', date: yesterday, clockIn: now - DAY - 8 * HOUR, clockOut: now - DAY - 4 * HOUR, status: 'rejected' },
    ],
    entries: [
      { id: 'e1', worker: 'Peter Ssegomba', dept: 'crops', date: today, activity: 'Weeding', place: 'Field B', subject: 'Maize', measure: '2 ha', notes: 'Completed the eastern rows.' },
      { id: 'e2', worker: 'Joyce Achieng', dept: 'crops', date: dayOffset(-1), activity: 'Fertilizer application', place: 'Plot C', subject: 'Maize', measure: '12 bags NPK', notes: '' },
      { id: 'e3', worker: 'Daniel Okello', dept: 'livestock', date: today, activity: 'Feeding', place: 'Poultry A', subject: 'Broilers', measure: '3 sacks', notes: 'Morning ration given at 07:30.' },
      { id: 'e4', worker: 'Rehema Nakigude', dept: 'livestock', date: dayOffset(-1), activity: 'Health check', place: 'Dairy unit', subject: 'Cattle', measure: '14 heads', notes: 'One cow treated for ticks.' },
    ],
    workerReports: [
      { id: 'r1', worker: 'Peter Ssegomba', dept: 'crops', date: dayOffset(-1), task: 'Scout Field A for armyworm', hours: 4, summary: 'Scouted Field A — no armyworm damage found; flagged two stunted patches for follow-up.' },
      { id: 'r2', worker: 'Daniel Okello', dept: 'livestock', date: dayOffset(-1), task: 'Clean poultry house A', hours: 3, summary: 'Deep-cleaned the north pen and disinfected feeders; litter replaced.' },
    ],
    transactions: [
      { id: 'tx1', worker: 'Peter Ssegomba', dept: 'crops', amount: 45000, reason: 'Bought 2 bales of twine for Field B', when: now - 3 * HOUR, status: 'pending' },
      { id: 'tx2', worker: 'Joyce Achieng', dept: 'crops', amount: 30000, reason: 'Boda transport for seedlings', when: now - 5 * HOUR, status: 'pending' },
      { id: 'tx3', worker: 'Daniel Okello', dept: 'livestock', amount: 120000, reason: 'Emergency poultry feed top-up', when: now - 4 * HOUR, status: 'pending' },
      { id: 'tx4', worker: 'Rehema Nakigude', dept: 'livestock', amount: 75000, reason: 'Vaccines from the vet shop', when: now - DAY, status: 'approved' },
      { id: 'tx5', worker: 'Moses Ssemakula', dept: 'livestock', amount: 15000, reason: 'Airtime for market price checks', when: now - DAY - 2 * HOUR, status: 'rejected' },
    ],
    generated: [],
  };
}

function loadState(): FarmState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FarmState;
      // Backfill any key added after the state was first stored.
      const base = seedState();
      return {
        tasks: parsed.tasks ?? base.tasks,
        workers: parsed.workers ?? base.workers,
        attendance: parsed.attendance ?? base.attendance,
        entries: parsed.entries ?? base.entries,
        workerReports: parsed.workerReports ?? base.workerReports,
        transactions: parsed.transactions ?? base.transactions,
        generated: parsed.generated ?? base.generated,
      };
    }
  } catch {
    /* fall through to a fresh seed */
  }
  return seedState();
}

function persist(state: FarmState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable — state lives in memory only */
  }
}

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

@Injectable({ providedIn: 'root' })
export class FarmDataService {
  private readonly _state = signal<FarmState>(loadState());

  readonly tasks = computed(() => this._state().tasks);
  readonly workers = computed(() => this._state().workers);
  readonly attendance = computed(() => this._state().attendance);
  readonly entries = computed(() => this._state().entries);
  readonly workerReports = computed(() => this._state().workerReports);
  readonly transactions = computed(() => this._state().transactions);
  readonly generated = computed(() => this._state().generated);

  /* ---------------- queries ---------------- */

  workersOf(dept: Department): WorkerRec[] {
    return this.workers().filter((worker) => worker.dept === dept);
  }

  tasksOf(dept: Department): FarmTask[] {
    return this.tasks().filter((task) => task.dept === dept);
  }

  /** Tasks assigned to one worker (by display name) in their department. */
  myTasks(worker: string, dept: Department): FarmTask[] {
    return this.tasks().filter(
      (task) => task.dept === dept && task.assignee === worker,
    );
  }

  attendanceOf(dept: Department): AttendanceRec[] {
    return this.attendance().filter((rec) => rec.dept === dept);
  }

  todayAttendance(dept: Department): AttendanceRec[] {
    const today = dayKey();
    return this.attendanceOf(dept)
      .filter((rec) => rec.date === today)
      .sort((a, b) => b.clockIn - a.clockIn);
  }

  pendingAttendance(dept: Department): AttendanceRec[] {
    return this.attendanceOf(dept)
      .filter((rec) => rec.status === 'pending')
      .sort((a, b) => b.clockIn - a.clockIn);
  }

  /** Attendance records belonging to one worker, newest first. */
  myAttendance(worker: string): AttendanceRec[] {
    return this.attendance()
      .filter((rec) => rec.worker === worker)
      .sort((a, b) => b.clockIn - a.clockIn);
  }

  /** The record currently open for a worker (clocked in, no clock-out). */
  runningRecord(worker: string): AttendanceRec | null {
    return (
      this.attendance().find(
        (rec) => rec.worker === worker && rec.status === 'running',
      ) ?? null
    );
  }

  entriesOf(dept: Department): DataEntryRec[] {
    return this.entries()
      .filter((entry) => entry.dept === dept)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  myReports(worker: string): WorkerReportRec[] {
    return this.workerReports()
      .filter((report) => report.worker === worker)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  transactionsOf(dept: Department): TransactionRec[] {
    return this.transactions()
      .filter((tx) => tx.dept === dept)
      .sort((a, b) => b.when - a.when);
  }

  pendingTransactions(dept: Department): TransactionRec[] {
    return this.transactionsOf(dept).filter((tx) => tx.status === 'pending');
  }

  generatedOf(dept: Department): GeneratedReport[] {
    return this.generated().filter((report) => report.dept === dept);
  }

  /* ---------------- actions ---------------- */

  assignTask(input: {
    title: string;
    notes: string;
    dept: Department;
    assignee: string;
    due: string;
  }): FarmTask {
    const task: FarmTask = {
      id: nextId('t'),
      title: input.title.trim(),
      notes: input.notes.trim(),
      dept: input.dept,
      assignee: input.assignee,
      due: input.due,
      status: 'open',
    };
    this.patch((state) => ({ tasks: [task, ...state.tasks] }));
    return task;
  }

  setTaskStatus(id: string, status: TaskStatus): void {
    this.patch((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, status } : task,
      ),
    }));
  }

  addWorker(input: {
    name: string;
    email: string;
    dept: Department;
  }): WorkerRec {
    const worker: WorkerRec = {
      id: nextId('w'),
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      dept: input.dept,
      joined: dayKey(),
    };
    this.patch((state) => ({ workers: [...state.workers, worker] }));
    return worker;
  }

  removeWorker(id: string): void {
    this.patch((state) => ({
      workers: state.workers.filter((worker) => worker.id !== id),
    }));
  }

  /** Opens today's shift; returns the running record (idempotent). */
  clockIn(worker: string, dept: Department): AttendanceRec {
    const existing = this.runningRecord(worker);
    if (existing) return existing;

    const rec: AttendanceRec = {
      id: nextId('a'),
      worker,
      dept,
      date: dayKey(),
      clockIn: Date.now(),
      status: 'running',
    };
    this.patch((state) => ({ attendance: [rec, ...state.attendance] }));
    return rec;
  }

  /** Closes the open shift — the record then waits for approval. */
  clockOut(worker: string): AttendanceRec | null {
    const rec = this.runningRecord(worker);
    if (!rec) return null;

    const updated: AttendanceRec = {
      ...rec,
      clockOut: Date.now(),
      status: 'pending',
    };
    this.patch((state) => ({
      attendance: state.attendance.map((item) =>
        item.id === rec.id ? updated : item,
      ),
    }));
    return updated;
  }

  setAttendanceStatus(id: string, status: 'approved' | 'rejected'): void {
    this.patch((state) => ({
      attendance: state.attendance.map((rec) =>
        rec.id === id ? { ...rec, status } : rec,
      ),
    }));
  }

  addEntry(input: {
    worker: string;
    dept: Department;
    activity: string;
    place: string;
    subject: string;
    measure: string;
    notes: string;
  }): DataEntryRec {
    const entry: DataEntryRec = {
      id: nextId('e'),
      date: dayKey(),
      ...input,
    };
    this.patch((state) => ({ entries: [entry, ...state.entries] }));
    return entry;
  }

  submitReport(input: {
    worker: string;
    dept: Department;
    task: string;
    hours: number;
    summary: string;
    date?: string;
  }): WorkerReportRec {
    const report: WorkerReportRec = {
      id: nextId('r'),
      ...input,
      date: input.date ?? dayKey(),
    };
    this.patch((state) => ({
      workerReports: [report, ...state.workerReports],
    }));
    return report;
  }

  setTransactionStatus(
    id: string,
    status: 'approved' | 'rejected',
  ): void {
    this.patch((state) => ({
      transactions: state.transactions.map((tx) =>
        tx.id === id ? { ...tx, status } : tx,
      ),
    }));
  }

  /** Builds an operations report from the current store and keeps it
   *  in the department's history. */
  generateReport(
    dept: Department,
    type: string,
    period: string,
    periodStart: number,
  ): GeneratedReport {
    const tasks = this.tasksOf(dept);
    const workers = this.workersOf(dept);
    const entries = this.entriesOf(dept).filter(
      (entry) => startOfDay(entry.date) >= periodStart,
    );
    const reports = this.workerReports().filter(
      (report) => report.dept === dept && startOfDay(report.date) >= periodStart,
    );
    const attendance = this.attendanceOf(dept).filter(
      (rec) => rec.clockIn >= periodStart,
    );
    const present = new Set(
      attendance.filter((rec) => rec.status !== 'rejected').map((rec) => rec.worker),
    );
    const worked = attendance
      .filter((rec) => rec.status === 'approved' || rec.status === 'pending')
      .reduce((sum, rec) => sum + workedSeconds(rec.clockIn, rec.clockOut), 0);
    const pendingValue = this.pendingTransactions(dept).reduce(
      (sum, tx) => sum + tx.amount,
      0,
    );

    const lines: ReportLine[] = [
      { label: 'Workers on the team', value: String(workers.length) },
      { label: 'Workers present', value: String(present.size) },
      { label: 'Tasks completed', value: String(tasks.filter((t) => t.status === 'done').length) },
      { label: 'Tasks still open', value: String(tasks.filter((t) => t.status !== 'done').length) },
      { label: 'Data entries logged', value: String(entries.length) },
      { label: 'Daily reports filed', value: String(reports.length) },
      { label: 'Attendance hours (approved & pending)', value: fmtDuration(worked) },
      { label: 'Pending transaction value', value: fmtMoney(pendingValue) },
    ];

    const report: GeneratedReport = {
      id: nextId('g'),
      dept,
      type,
      period,
      when: Date.now(),
      lines,
    };
    this.patch((state) => ({ generated: [report, ...state.generated] }));
    return report;
  }

  /* ---------------- internals ---------------- */

  private patch(mutator: (state: FarmState) => Partial<FarmState>): void {
    this._state.update((state) => {
      const next = { ...state, ...mutator(state) };
      persist(next);
      return next;
    });
  }
}
