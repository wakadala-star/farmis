import { Component, computed, inject, signal } from '@angular/core';
import { FarmApiService } from '../../../core/farm-api.service';
import {
  AttendanceRec,
  dayKey,
  fmtClock,
  fmtDay,
  fmtDuration,
  statusLabel,
  statusTone,
  workedSeconds,
} from '../../../core/farm-data.service';
import { MetaTile } from '../../../shared/management-view/management-view';

/**
 * Supervisor attendance — confirm the department's clock-ins and
 * clock-outs. Records the workers clocked out arrive as "pending"
 * and move to approved/rejected with one tap.
 */
@Component({
  selector: 'app-supervisor-attendance',
  templateUrl: './supervisor-attendance.html',
})
export class SupervisorAttendance {
  readonly api = inject(FarmApiService);

  readonly fmtClock = fmtClock;
  readonly fmtDay = fmtDay;
  readonly fmtDuration = fmtDuration;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly workedSeconds = workedSeconds;

  readonly notice = signal('');
  readonly error = signal('');
  /** Attendance id whose decision is in flight (disables both buttons). */
  readonly decidingId = signal('');

  readonly loading = this.api.deptAttendanceLoading;
  readonly loadError = this.api.deptAttendanceError;

  constructor() {
    void this.api.ensure('deptAttendance');
  }

  retry(): void {
    void this.api.ensure('deptAttendance');
  }

  /** Counts refresh live as approvals happen. */
  readonly tiles = computed<MetaTile[]>(() => this.buildTiles());

  /** Clock-outs waiting for this supervisor's confirmation. */
  readonly pending = computed(() =>
    this.api.deptAttendance().filter((rec) => rec.status === 'pending'),
  );

  /** Every clock record of the department, newest first. */
  readonly recent = computed(() =>
    this.api.deptAttendance().slice(0, 10),
  );

  approve(rec: AttendanceRec): void {
    void this.decide(rec, 'approved');
  }

  reject(rec: AttendanceRec): void {
    void this.decide(rec, 'rejected');
  }

  private async decide(
    rec: AttendanceRec,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    if (this.decidingId()) return;
    this.decidingId.set(rec.id);
    try {
      const res = await this.api.decideAttendance(rec.id, decision);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.error.set('');
      this.notice.set(
        `${rec.worker}’s time record ${decision === 'approved' ? 'approved' : 'rejected'}.`,
      );
    } finally {
      this.decidingId.set('');
    }
  }

  private buildTiles(): MetaTile[] {
    const today = this.api
      .deptAttendance()
      .filter((rec) => rec.date === dayKey());
    const present = new Set(
      today
        .filter((rec) => rec.status !== 'rejected')
        .map((rec) => rec.worker),
    ).size;
    const pending = this.pending().length;
    const approvedToday = today.filter((rec) => rec.status === 'approved').length;

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
