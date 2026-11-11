import { Component, computed, inject } from '@angular/core';
import { FarmApiService } from '../../../core/farm-api.service';
import {
  fmtClock,
  fmtDay,
  fmtDuration,
  statusLabel,
  statusTone,
  workedSeconds,
} from '../../../core/farm-data.service';
import { MetaTile } from '../../../shared/management-view/management-view';

/**
 * Worker attendance — the clock records produced by the topbar clock
 * button (loaded from GET /api/attendance/mine). Clocked-out time sits
 * as "pending" here until the supervisor confirms it.
 */
@Component({
  selector: 'app-worker-attendance',
  templateUrl: './worker-attendance.html',
})
export class WorkerAttendance {
  private readonly api = inject(FarmApiService);

  readonly fmtClock = fmtClock;
  readonly fmtDay = fmtDay;
  readonly fmtDuration = fmtDuration;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly workedSeconds = workedSeconds;

  readonly records = this.api.attendance;
  readonly loading = this.api.attendanceLoading;
  readonly error = this.api.attendanceError;

  readonly tiles = computed<MetaTile[]>(() => {
    const running = this.api.runningRecord();
    const midnight = new Date().setHours(0, 0, 0, 0);
    const today = this.records().filter((rec) => rec.clockIn >= midnight);
    const pending = this.records().filter(
      (rec) => rec.status === 'pending',
    ).length;
    const workedToday = today
      .filter((rec) => rec.status !== 'rejected')
      .reduce(
        (sum, rec) => sum + workedSeconds(rec.clockIn, rec.clockOut),
        0,
      );

    return [
      {
        icon: running ? 'fa-solid fa-stop' : 'fa-solid fa-play',
        tone: running ? 'green' : 'blue',
        value: running ? 'Clocked in' : 'Clocked out',
        label: running ? `Since ${fmtClock(running.clockIn)}` : 'Current status',
        hint: 'Use the clock button in the top bar to switch',
      },
      {
        icon: 'fa-solid fa-hourglass-half',
        tone: 'amber',
        value: fmtDuration(workedToday),
        label: 'Worked today',
        hint: 'Total time recorded for today',
      },
      {
        icon: 'fa-solid fa-hourglass-half',
        tone: 'amber',
        value: String(pending),
        label: 'Awaiting approval',
        hint: 'Clock-outs waiting for your supervisor',
      },
    ];
  });

  constructor() {
    void this.api.ensure('attendance');
  }

  retry(): void {
    void this.api.ensure('attendance');
  }
}
