import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FarmApiService } from '../../../core/farm-api.service';
import {
  GeneratedReport,
  dayKey,
  fmtClock,
  fmtDay,
} from '../../../core/farm-data.service';
import {
  PERIODS,
  REPORT_TYPES,
  downloadReportCsv,
} from '../../../shared/reports/reports';

/**
 * Supervisor reports — generate a report over the department's daily
 * operations (workers, tasks, entries, attendance, transaction value).
 * Generated reports are kept in the department's history, and the
 * daily reports filed by the team are listed underneath.
 */
@Component({
  selector: 'app-supervisor-reports',
  imports: [ReactiveFormsModule],
  templateUrl: './supervisor-reports.html',
})
export class SupervisorReports {
  private readonly api = inject(FarmApiService);

  readonly reportTypes = REPORT_TYPES;
  readonly periods = PERIODS;
  readonly fmtClock = fmtClock;
  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');
  readonly generating = signal(false);

  /** The report currently shown in the preview card. */
  readonly selected = signal<GeneratedReport | null>(null);

  readonly form = new FormGroup({
    type: new FormControl(REPORT_TYPES[0], {
      nonNullable: true,
      validators: [Validators.required],
    }),
    period: new FormControl('today', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  /** Generated report history of the department, newest first. */
  readonly history = this.api.opsReports;
  readonly loading = this.api.opsReportsLoading;
  readonly loadError = this.api.opsReportsError;

  /** Daily reports filed by the team (newest first). */
  readonly filed = this.api.deptReports;
  readonly filedLoading = this.api.deptReportsLoading;
  readonly filedError = this.api.deptReportsError;

  constructor() {
    void this.api.ensure('opsReports');
    void this.api.ensure('deptReports');
  }

  retry(): void {
    void this.api.ensure('opsReports');
  }

  retryFiled(): void {
    void this.api.ensure('deptReports');
  }

  async generate(): Promise<void> {
    if (this.generating()) return;
    const { type, period } = this.form.getRawValue();
    const meta = PERIODS.find((entry) => entry.value === period) ?? PERIODS[0];
    // Period start: local midnight of today, or of the window's first day.
    const periodStart =
      meta.days === 0
        ? dayKey()
        : dayKey(new Date(Date.now() - meta.days * 86_400_000));

    this.generating.set(true);
    try {
      const res = await this.api.generateOpsReport({
        type,
        period: meta.label,
        periodStart,
      });
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      // The new snapshot lands at the top of the history (newest first).
      this.selected.set(this.api.opsReports()[0] ?? null);
      this.error.set('');
      this.notice.set(`${meta.label} report generated.`);
    } finally {
      this.generating.set(false);
    }
  }

  view(report: GeneratedReport): void {
    this.selected.set(report);
  }

  /** Downloads the given report as a CSV file (client-side). */
  export(report: GeneratedReport): void {
    downloadReportCsv(report);
  }
}
