import { Component, computed, inject, signal } from '@angular/core';
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

/**
 * Supervisor attendance — confirm the department's clock-ins and
 * clock-outs. Records the workers clocked out on arrive as "pending"
 * and move to approved/rejected with one tap.
 */
@Component({
  selector: 'app-supervisor-attendance',
  templateUrl: './supervisor-attendance.html',
})
export class SupervisorAttendance {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;

  readonly fmtClock = fmtClock;
  readonly fmtDay = fmtDay;
  readonly fmtDuration = fmtDuration;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly workedSeconds = workedSeconds;

  readonly notice = signal('');

  /** Counts refresh live as approvals happen. */
  readonly tiles = computed<MetaTile[]>(() => this.buildTiles());

  /** Clock-outs waiting for this supervisor's confirmation. */
  readonly pending = computed(() => this.data.pendingAttendance(this.dept));

  /** Every clock record of the department, newest first. */
  readonly recent = computed(() =>
    this.data
      .attendanceOf(this.dept)
      .sort((a, b) => b.clockIn - a.clockIn)
      .slice(0, 10),
  );

  approve(rec: AttendanceRec): void {
    this.data.setAttendanceStatus(rec.id, 'approved');
    this.notice.set(`${rec.worker}’s time record approved.`);
  }

  reject(rec: AttendanceRec): void {
    this.data.setAttendanceStatus(rec.id, 'rejected');
    this.notice.set(`${rec.worker}’s time record rejected.`);
  }

  private buildTiles(): MetaTile[] {
    const present = new Set(
      this.data
        .todayAttendance(this.dept)
        .filter((rec) => rec.status !== 'rejected')
        .map((rec) => rec.worker),
    ).size;
    const pending = this.data.pendingAttendance(this.dept).length;
    const approvedToday = this.data
      .todayAttendance(this.dept)
      .filter((rec) => rec.status === 'approved').length;

    return [
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
        value: String(pending),
        label: 'Awaiting approval',
        hint: 'Clock-outs waiting for your confirmation',
      },
      {
        icon: 'fa-solid fa-circle-check',
        tone: 'blue',
        value: String(approvedToday),
        label: 'Approved today',
        hint: 'Time records you confirmed',
      },
    ];
  }
}
