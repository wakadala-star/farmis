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
   REAL FARM DATA against the FARMIS backend (Phase 2B + 2C + 2D).

   Phase 2B moved the worker screens here; Phase 2C adds the
   supervisor loop (department tasks, attendance approvals,
   credit decisions, recruit/offboard, operations reports) and
   the worker's own credit requests. Phase 2D adds the owner
   loop: dashboard summary, management pages, crop/livestock
   registries, quick actions (expense, sale) and the staff list.

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
  | 'opsReports'
  | 'ownerSummary'
  | 'deptCrops'
  | 'deptLivestock'
  | 'crops'
  | 'livestock'
  | 'staff';

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
  /** Phase 2E: this person has a profile photo (GET /users/:id/avatar). */
  hasAvatar?: boolean;
}

interface RecordResponse<T> {
  ok: boolean;
  message: string;
  record?: T;
}

/* --- owner loop payloads (Phase 2D) --- */

/** A low-stock row as the dashboard and management pages show it. */
export interface LowStockRow {
  name: string;
  qty: number;
  unit: string;
  reorderLevel: number;
  updatedAt: number; // epoch ms
}

/** GET /api/owner/summary — one round trip for the dashboard. */
export interface OwnerSummary {
  stats: {
    employees: number;
    lowStock: number;
    pendingApprovals: number;
    monthSales: number;
    prevMonthSales: number;
    animals: number; // head count summed from the livestock registry
    cropPlots: number; // registry entries
    cropHa: number; // summed hectares
  };
  series: { month: string; value: number }[]; // six calendar months, ascending
  sales: {
    id: string;
    date: string; // YYYY-MM-DD
    customer: string;
    item: string;
    lineCount: number;
    amount: number;
    status: string;
  }[];
  lowStock: LowStockRow[];
  pending: { attendance: number; credit: number };
  activities: {
    id: string;
    title: string;
    assignee: string;
    dept: Department | null;
    due: string; // YYYY-MM-DD
  }[];
  recent: {
    kind: 'entry' | 'expense' | 'sale' | 'crop' | 'animal';
    title: string;
    sub: string;
    at: number; // epoch ms
    dept: Department | null;
    amount: number | null;
  }[];
}

/** GET /api/owner/department/:code — one owner management page. */
export interface DeptPage {
  dept: string;
  meta: {
    entriesThisWeek: number;
    activities: string[];
    lastEntryAt: number | null;
    lastEntryBy: string | null;
    lastEntryPlace: string | null;
    openAlerts: number;
  };
  lowStock: LowStockRow[];
  dueTasks: {
    id: string;
    title: string;
    due: string; // YYYY-MM-DD
    assignee: string;
    overdue: boolean;
  }[];
  updates: {
    id: string;
    at: number; // epoch ms
    author: string;
    activity: string;
    place: string;
    subject: string;
    measure: string;
    notes: string;
  }[];
}

/** GET/POST /api/crops row. */
export interface CropRec {
  id: string;
  name: string;
  variety: string;
  areaHa: number | null;
  plantedDate: string | null; // YYYY-MM-DD
  notes: string;
  createdBy: string;
  createdAt: number; // epoch ms
}

/** GET/POST /api/livestock row. */
export interface LivestockRec {
  id: string;
  species: string;
  breed: string;
  quantity: number;
  location: string;
  acquiredDate: string | null; // YYYY-MM-DD
  notes: string;
  createdBy: string;
  createdAt: number; // epoch ms
}

/** GET /api/sales/options — the Record Sale form's pickers. */
export interface SaleOptions {
  customers: { id: string; name: string; phone: string }[];
  items: {
    id: string;
    name: string;
    code: string;
    unit: string;
    qty: number;
    reorderLevel: number;
    unitCost: number;
  }[];
}

/** One line of POST /api/sales (itemId links the line to stock). */
export interface SaleLineInput {
  itemId?: string | number | null;
  description?: string;
  quantity: number;
  unitPrice: number;
}

/* ---------------- Phase 3A: Sales & Customers screen ---------------- */

/** One row of GET /api/sales (list, newest first). */
export interface SalesListRow {
  id: string;
  date: string; // YYYY-MM-DD
  receipt: string;
  customer: string;
  item: string;
  amount: number;
  method: string; // cash | mobile_money | bank_transfer | other
  status: string; // paid | pending | partial
}

/** Filter for GET /api/sales (all optional, inclusive calendar days). */
export interface SalesFilter {
  dateFrom?: string; // YYYY-MM-DD
  dateTo?: string; // YYYY-MM-DD
  status?: string;
  method?: string;
}

/** GET /api/sales/:id — header, line items and the stock impact. */
export interface SaleDetail {
  id: string;
  receipt: string;
  date: string;
  customer: string;
  customerId: string | null;
  customerPhone: string;
  seller: string;
  method: string;
  status: string;
  notes: string;
  total: number;
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    linked: boolean;
    item: string | null;
    unit: string;
  }[];
  stockMovements: {
    item: string;
    quantity: number;
    unit: string;
    unitCost: number;
    date: string;
  }[];
}

/** One row of GET /api/customers (saleCount = sales on record). */
export interface CustomerRec {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  createdAt: string; // YYYY-MM-DD
  saleCount: number;
}

/* ---------------- Phase 3B: Inventory & Stores screen ---------------- */

/** One row of GET /api/inventory (list, name order). */
export interface InventoryItemRec {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  category: string;
  departmentId: string | null;
  department: string;
  unit: string;
  qty: number;
  reorderLevel: number;
  unitCost: number;
  description: string;
  low: boolean; // quantity_on_hand <= reorder_level (dashboard predicate)
  updatedAt: string; // YYYY-MM-DD
}

/** Filter for GET /api/inventory (all optional). */
export interface InventoryFilter {
  category?: string; // category id
  low?: string; // '1' → at/below reorder level
  q?: string; // name/code search
}

/** One row of GET /api/inventory/categories (read-only list). */
export interface InventoryCategoryRec {
  id: string;
  name: string;
  description: string;
  departmentId: string | null;
  department: string;
  itemCount: number;
}

/** Filter for GET /api/inventory/movements (all optional). */
export interface MovementFilter {
  item?: string; // item id
  type?: string; // stock_in | stock_out | adjustment
  dateFrom?: string; // YYYY-MM-DD, inclusive
  dateTo?: string;
}

/** One row of GET /api/inventory/movements (newest first). */
export interface StockMovementRec {
  id: string;
  itemId: string;
  item: string;
  code: string;
  unit: string;
  type: string; // stock_in | stock_out | adjustment
  quantity: number; // signed for adjustments, positive for in/out
  unitCost: number | null;
  reference: string;
  notes: string;
  date: string; // YYYY-MM-DD
  by: string; // recorder's name
}

/** A row of GET /api/users as the owner's staff list shows it. */
export type StaffRec = ApiUser;

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
    hasAvatar: row.hasAvatar === true,
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

  /* --- owner loop (Phase 2D) --- */
  private readonly _ownerSummary = signal<OwnerSummary | null>(null);
  private readonly _deptCrops = signal<DeptPage | null>(null);
  private readonly _deptLivestock = signal<DeptPage | null>(null);
  private readonly _crops = signal<CropRec[]>([]);
  private readonly _livestock = signal<LivestockRec[]>([]);
  private readonly _staff = signal<StaffRec[]>([]);

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
    ownerSummary: fresh(),
    deptCrops: fresh(),
    deptLivestock: fresh(),
    crops: fresh(),
    livestock: fresh(),
    staff: fresh(),
  });

  /* ---------------- read-only views ---------------- */

  /**
   * Phase 2E: image URL for a team member's profile photo — null when
   * they have none (the list renders the initials fallback instead).
   */
  avatarSrc(member: { id: string; hasAvatar?: boolean }): string | null {
    return member.hasAvatar ? `${API_BASE}/users/${member.id}/avatar` : null;
  }

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
  readonly ownerSummary = this._ownerSummary.asReadonly();
  readonly deptCrops = this._deptCrops.asReadonly();
  readonly deptLivestock = this._deptLivestock.asReadonly();
  readonly crops = this._crops.asReadonly();
  readonly livestock = this._livestock.asReadonly();
  readonly staff = this._staff.asReadonly();

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
  readonly ownerSummaryLoading = computed(() => this._state().ownerSummary.loading);
  readonly ownerSummaryError = computed(() => this._state().ownerSummary.error);
  readonly deptCropsLoading = computed(() => this._state().deptCrops.loading);
  readonly deptCropsError = computed(() => this._state().deptCrops.error);
  readonly deptLivestockLoading = computed(() => this._state().deptLivestock.loading);
  readonly deptLivestockError = computed(() => this._state().deptLivestock.error);
  readonly cropsLoading = computed(() => this._state().crops.loading);
  readonly cropsError = computed(() => this._state().crops.error);
  readonly livestockLoading = computed(() => this._state().livestock.loading);
  readonly livestockError = computed(() => this._state().livestock.error);
  readonly staffLoading = computed(() => this._state().staff.loading);
  readonly staffError = computed(() => this._state().staff.error);

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

  /**
   * Load a collection once per session; retries after an error.
   * `force` re-reads an already-loaded collection silently (used after
   * a mutation, e.g. a recorded sale refreshing the dashboard).
   */
  async ensure(col: Collection, force = false): Promise<void> {
    const state = this._state()[col];
    if (!force && (state.loaded || state.loading)) return;
    await this.load(col, force && state.loaded);
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
      } else if (col === 'ownerSummary') {
        const res = await this.get<OwnerSummary>('/owner/summary');
        this._ownerSummary.set(res);
      } else if (col === 'deptCrops' || col === 'deptLivestock') {
        const code = col === 'deptCrops' ? 'crops' : 'livestock';
        const res = await this.get<DeptPage>(`/owner/department/${code}`);
        if (col === 'deptCrops') this._deptCrops.set(res);
        else this._deptLivestock.set(res);
      } else if (col === 'crops') {
        const res = await this.get<{ crops: CropRec[] }>('/crops');
        this._crops.set(res.crops ?? []);
      } else if (col === 'livestock') {
        const res = await this.get<{ livestock: LivestockRec[] }>('/livestock');
        this._livestock.set(res.livestock ?? []);
      } else if (col === 'staff') {
        const res = await this.get<{ users: ApiUser[] }>('/users');
        this._staff.set(res.users ?? []);
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

  /* ---------------- owner actions (2D) ---------------- */

  /** Adds a crop to the registry (POST /crops). */
  addCrop(input: {
    name: string;
    variety?: string;
    areaHa?: number | null;
    plantedDate?: string; // YYYY-MM-DD
    notes?: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/crops', input, 'crops');
  }

  /** Adds a livestock group to the registry (POST /livestock). */
  addAnimal(input: {
    species: string;
    breed?: string;
    quantity?: number;
    location?: string;
    acquiredDate?: string; // YYYY-MM-DD
    notes?: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/livestock', input, 'livestock');
  }

  /** Records an expense (POST /expenses) and refreshes the dashboard. */
  addExpense(input: {
    category: string;
    description: string;
    amount: number;
    date?: string; // YYYY-MM-DD
    paymentMethod?: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/expenses', input, 'ownerSummary');
  }

  /**
   * Records a sale with stock deduction (POST /sales). No list refresh
   * happens here: the owner summary is owner-only, so each screen
   * refreshes its own data after a successful recording.
   */
  recordSale(input: {
    customerName?: string;
    customerId?: string;
    lines: SaleLineInput[];
    paymentMethod?: string;
    paymentStatus?: string;
    notes?: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/sales', input);
  }

  /** Recruits a worker or supervisor into a department (POST /users). */
  recruitMember(input: {
    name: string;
    email: string;
    password: string;
    role: 'worker' | 'supervisor';
    department: Department;
  }): Promise<ActionResult> {
    return this.send('POST', '/users', input, 'staff');
  }

  /** Deactivates a staff member's account (DELETE /users/:id). */
  removeMember(id: string): Promise<ActionResult> {
    return this.send('DELETE', `/users/${id}`, undefined, 'staff');
  }

  /**
   * Fresh Record Sale pickers — customers and sellable stock are
   * re-read every time the modal opens (quantities change per sale).
   */
  async fetchSaleOptions(): Promise<{
    ok: boolean;
    options?: SaleOptions;
    message: string;
  }> {
    try {
      const options = await this.get<SaleOptions>('/sales/options');
      return { ok: true, options, message: '' };
    } catch (err) {
      return { ok: false, message: apiMessage(err) };
    }
  }

  /* ---------------- Phase 3A: Sales & Customers ---------------- */

  /**
   * Filtered sales list (GET /sales, capped at 200 rows server-side).
   * The dashboard's Recent Sales keeps coming from the summary bundle —
   * this one is the Sales screen's own fetch.
   */
  async listSales(filter: SalesFilter): Promise<{
    ok: boolean;
    message: string;
    count: number; // full match count, beyond the row cap
    sales: SalesListRow[];
  }> {
    try {
      const params = new URLSearchParams();
      if (filter.dateFrom) params.set('dateFrom', filter.dateFrom);
      if (filter.dateTo) params.set('dateTo', filter.dateTo);
      if (filter.status) params.set('status', filter.status);
      if (filter.method) params.set('method', filter.method);
      params.set('limit', '200');
      const res = await this.get<{ count: number; sales: SalesListRow[] }>(
        `/sales?${params.toString()}`,
      );
      return { ok: true, message: '', count: res.count, sales: res.sales };
    } catch (err) {
      return { ok: false, message: apiMessage(err), count: 0, sales: [] };
    }
  }

  /** Sale detail for the expandable row (GET /sales/:id). */
  async fetchSaleDetail(id: string): Promise<{
    ok: boolean;
    message: string;
    sale: SaleDetail | null;
  }> {
    try {
      const res = await this.get<{ sale: SaleDetail }>(`/sales/${id}`);
      return { ok: true, message: '', sale: res.sale };
    } catch (err) {
      return { ok: false, message: apiMessage(err), sale: null };
    }
  }

  /** Customers with their sale counts (GET /customers). */
  async listCustomers(): Promise<{
    ok: boolean;
    message: string;
    customers: CustomerRec[];
  }> {
    try {
      const res = await this.get<{ customers: CustomerRec[] }>('/customers');
      return { ok: true, message: '', customers: res.customers };
    } catch (err) {
      return { ok: false, message: apiMessage(err), customers: [] };
    }
  }

  /** Adds a customer up front (POST /customers). */
  createCustomer(input: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/customers', input);
  }

  /** Edits a customer's name and contact details (PATCH /customers/:id). */
  updateCustomer(
    id: string,
    input: {
      name?: string;
      phone?: string;
      email?: string;
      address?: string;
    },
  ): Promise<ActionResult> {
    return this.send('PATCH', `/customers/${id}`, input);
  }

  /** Removes a customer — 409 while sales reference them (DELETE). */
  removeCustomer(id: string): Promise<ActionResult> {
    return this.send('DELETE', `/customers/${id}`, undefined);
  }

  /** Item list (GET /inventory, capped at 200 rows server-side). */
  async listInventory(filter: InventoryFilter): Promise<{
    ok: boolean;
    message: string;
    count: number;
    items: InventoryItemRec[];
  }> {
    try {
      const params = new URLSearchParams();
      if (filter.category) params.set('category', filter.category);
      if (filter.low) params.set('low', filter.low);
      if (filter.q) params.set('q', filter.q);
      params.set('limit', '200');
      const res = await this.get<{ count: number; items: InventoryItemRec[] }>(
        `/inventory?${params.toString()}`,
      );
      return { ok: true, message: '', count: res.count, items: res.items };
    } catch (err) {
      return { ok: false, message: apiMessage(err), count: 0, items: [] };
    }
  }

  /** Categories, read-only (GET /inventory/categories). */
  async listInventoryCategories(): Promise<{
    ok: boolean;
    message: string;
    categories: InventoryCategoryRec[];
  }> {
    try {
      const res = await this.get<{ categories: InventoryCategoryRec[] }>(
        '/inventory/categories',
      );
      return { ok: true, message: '', categories: res.categories };
    } catch (err) {
      return { ok: false, message: apiMessage(err), categories: [] };
    }
  }

  /** Movement log (GET /inventory/movements, capped at 200 rows). */
  async listMovements(filter: MovementFilter): Promise<{
    ok: boolean;
    message: string;
    count: number;
    movements: StockMovementRec[];
  }> {
    try {
      const params = new URLSearchParams();
      if (filter.item) params.set('item', filter.item);
      if (filter.type) params.set('type', filter.type);
      if (filter.dateFrom) params.set('dateFrom', filter.dateFrom);
      if (filter.dateTo) params.set('dateTo', filter.dateTo);
      params.set('limit', '200');
      const res = await this.get<{ count: number; movements: StockMovementRec[] }>(
        `/inventory/movements?${params.toString()}`,
      );
      return { ok: true, message: '', count: res.count, movements: res.movements };
    } catch (err) {
      return { ok: false, message: apiMessage(err), count: 0, movements: [] };
    }
  }

  /**
   * Adds an item (POST /inventory) — the opening quantity is only
   * accepted here; later stock changes go through movements.
   */
  createInventoryItem(input: {
    name: string;
    code?: string;
    unit: string;
    categoryId: string;
    qtyOnHand?: number;
    reorderLevel?: number;
    unitCost?: number;
    description?: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/inventory', input);
  }

  /** Edits an item's details (PATCH /inventory/:id) — never quantity. */
  updateInventoryItem(
    id: string,
    input: {
      name?: string;
      code?: string;
      unit?: string;
      categoryId?: string;
      reorderLevel?: number;
      unitCost?: number;
      description?: string;
    },
  ): Promise<ActionResult> {
    return this.send('PATCH', `/inventory/${id}`, input);
  }

  /** Removes an item — 409 while sales or movements reference it. */
  removeInventoryItem(id: string): Promise<ActionResult> {
    return this.send('DELETE', `/inventory/${id}`, undefined);
  }

  /**
   * Records a movement (POST /inventory/movements): stock_out can't
   * exceed on-hand (409), adjustments are signed deltas (409 below 0).
   */
  recordStockMovement(input: {
    itemId: string;
    type: string;
    quantity: number;
    unitCost?: number | null;
    reference?: string;
    notes?: string;
  }): Promise<ActionResult> {
    return this.send('POST', '/inventory/movements', input);
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
