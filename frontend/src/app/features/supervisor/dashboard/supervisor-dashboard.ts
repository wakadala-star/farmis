import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../../../core/auth.service';
import { FarmApiService } from '../../../core/farm-api.service';
import {
  dayKey,
  fmtClock,
  fmtDay,
  fmtDuration,
  statusLabel,
  statusTone,
  workedSeconds,
} from '../../../core/farm-data.service';
import { MetaTile } from '../../../shared/management-view/management-view';

interface ApprovalRow {
  id: string;
  icon: string;
  title: string;
  sub: string;
}

/**
 * Supervisor dashboard — four department tiles plus the two lists a
 * supervisor opens first: today's clock-ins and everything still
 * waiting for approval (attendance + credit transactions). All lists
 * come from the live backend, scoped to the session's department.
 */
@Component({
  selector: 'app-supervisor-dashboard',
  templateUrl: './supervisor-dashboard.html',
})
export class SupervisorDashboard {
  private readonly auth = inject(AuthService);
  readonly api = inject(FarmApiService);

  readonly firstName = this.auth.fullName().split(' ')[0];

  /** Shared formatting helpers for the template. */
  readonly fmtClock = fmtClock;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;

  constructor() {
    void this.api.ensure('workers');
    void this.api.ensure('deptTasks');
    void this.api.ensure('deptAttendance');
    void this.api.ensure('transactions');
  }

  /** Any of the four feeds still loading (tiles show '—' meanwhile). */
  readonly loading = computed(
    () =>
      this.api.workersLoading() ||
      this.api.deptTasksLoading() ||
      this.api.deptAttendanceLoading() ||
      this.api.transactionsLoading(),
  );

  readonly loadError = computed(
    () =>
      this.api.workersError() ||
      this.api.deptTasksError() ||
      this.api.deptAttendanceError() ||
      this.api.transactionsError() ||
      '',
  );

  retry(): void {
    void this.api.ensure('workers');
    void this.api.ensure('deptTasks');
    void this.api.ensure('deptAttendance');
    void this.api.ensure('transactions');
  }

  readonly tiles = computed<MetaTile[]>(() => {
    const loading = this.loading();
    const workers = this.api.workers().length;
    const open = this.api
      .deptTasks()
      .filter((task) => task.status !== 'done').length;
    const today = this.api
      .deptAttendance()
      .filter((rec) => rec.date === dayKey());
    const present = new Set(
      today
        .filter((rec) => rec.status !== 'rejected')
        .map((rec) => rec.worker),
    ).size;
    const approvals =
      this.api.deptAttendance().filter((rec) => rec.status === 'pending').length +
      this.api.transactions().filter((tx) => tx.status === 'pending').length;

    const value = (n: number) => (loading ? '—' : String(n));

    return [
      {
        icon: 'fa-solid fa-users',
        tone: 'green',
        value: value(workers),
        label: 'Workers',
        hint: 'Active in your department',
      },
      {
        icon: 'fa-solid fa-list-check',
        tone: 'blue',
        value: value(open),
        label: 'Open tasks',
        hint: 'Assigned and not yet completed',
      },
      {
        icon: 'fa-solid fa-user-check',
        tone: 'green',
        value: value(present),
        label: 'Present today',
        hint: 'Clocked in or worked earlier today',
      },
      {
        icon: 'fa-solid fa-hourglass-half',
        tone: 'amber',
        value: value(approvals),
        label: 'Awaiting approval',
        hint: 'Attendance records and credit transactions',
      },
    ];
  });

  /** Today's clock-ins for the department, newest first. */
  readonly todayRows = computed(() =>
    this.api
      .deptAttendance()
      .filter((rec) => rec.date === dayKey())
      .map((rec) => ({
        rec,
        initial: rec.worker.charAt(0),
        duration: fmtDuration(workedSeconds(rec.clockIn, rec.clockOut)),
      })),
  );

  /** Attendance waiting for approval + credit transactions waiting. */
  readonly approvalRows = computed<ApprovalRow[]>(() => {
    const attendance: ApprovalRow[] = this.api
      .deptAttendance()
      .filter((rec) => rec.status === 'pending')
      .map((rec) => ({
        id: rec.id,
        icon: 'fa-solid fa-clock',
        title: `${rec.worker} — clocked out`,
        sub: `${fmtDay(rec.date)} · ${fmtClock(rec.clockIn)} → ${
          rec.clockOut ? fmtClock(rec.clockOut) : '—'
        } · ${fmtDuration(workedSeconds(rec.clockIn, rec.clockOut))}`,
      }));

    const transactions: ApprovalRow[] = this.api
      .transactions()
      .filter((tx) => tx.status === 'pending')
      .map((tx) => ({
        id: tx.id,
        icon: 'fa-solid fa-money-bill-transfer',
        title: `${tx.worker} — UGX ${tx.amount.toLocaleString('en-US')}`,
        sub: tx.reason,
      }));

    return [...attendance, ...transactions];
  });
}
