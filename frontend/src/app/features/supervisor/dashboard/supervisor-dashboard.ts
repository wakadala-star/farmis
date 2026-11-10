import { Component, inject } from '@angular/core';
import { AuthService } from '../../../core/auth.service';
import {
  AttendanceRec,
  FarmDataService,
  fmtClock,
  fmtDay,
  fmtDuration,
  statusLabel,
  statusTone,
  workedSeconds,
} from '../../../core/farm-data.service';
import { Department } from '../../../core/models';
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
 * waiting for approval (attendance + credit transactions).
 */
@Component({
  selector: 'app-supervisor-dashboard',
  templateUrl: './supervisor-dashboard.html',
})
export class SupervisorDashboard {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;
  readonly firstName = this.auth.fullName().split(' ')[0];

  /** Shared formatting helpers for the template. */
  readonly fmtClock = fmtClock;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;

  readonly tiles: MetaTile[] = this.buildTiles();

  /** Today's clock-ins for the department, newest first. */
  readonly todayRows: {
    rec: AttendanceRec;
    initial: string;
    duration: string;
  }[] = this.data.todayAttendance(this.dept).map((rec) => ({
    rec,
    initial: rec.worker.charAt(0),
    duration: fmtDuration(workedSeconds(rec.clockIn, rec.clockOut)),
  }));

  /** Attendance waiting for approval + credit transactions waiting. */
  readonly approvalRows: ApprovalRow[] = this.buildApprovals();

  private buildTiles(): MetaTile[] {
    const workers = this.data.workersOf(this.dept).length;
    const open = this.data
      .tasksOf(this.dept)
      .filter((task) => task.status !== 'done').length;
    const present = new Set(
      this.data
        .todayAttendance(this.dept)
        .filter((rec) => rec.status !== 'rejected')
        .map((rec) => rec.worker),
    ).size;
    const approvals =
      this.data.pendingAttendance(this.dept).length +
      this.data.pendingTransactions(this.dept).length;

    return [
      {
        icon: 'fa-solid fa-users',
        tone: 'green',
        value: String(workers),
        label: 'Workers',
        hint: 'Active in your department',
      },
      {
        icon: 'fa-solid fa-list-check',
        tone: 'blue',
        value: String(open),
        label: 'Open tasks',
        hint: 'Assigned and not yet completed',
      },
      {
        icon: 'fa-solid fa-user-check',
        tone: 'green',
        value: String(present),
        label: 'Present today',
        hint: 'Clocked in or worked earlier today',
      },
      {
        icon: 'fa-solid fa-hourglass-half',
        tone: 'amber',
        value: String(approvals),
        label: 'Awaiting approval',
        hint: 'Attendance records and credit transactions',
      },
    ];
  }

  private buildApprovals(): ApprovalRow[] {
    const attendance: ApprovalRow[] = this.data
      .pendingAttendance(this.dept)
      .map((rec) => ({
        id: rec.id,
        icon: 'fa-solid fa-clock',
        title: `${rec.worker} — clocked out`,
        sub: `${fmtDay(rec.date)} · ${fmtClock(rec.clockIn)} → ${
          rec.clockOut ? fmtClock(rec.clockOut) : '—'
        } · ${fmtDuration(workedSeconds(rec.clockIn, rec.clockOut))}`,
      }));

    const transactions: ApprovalRow[] = this.data
      .pendingTransactions(this.dept)
      .map((tx) => ({
        id: tx.id,
        icon: 'fa-solid fa-money-bill-transfer',
        title: `${tx.worker} — UGX ${tx.amount.toLocaleString('en-US')}`,
        sub: tx.reason,
      }));

    return [...attendance, ...transactions];
  }
}
