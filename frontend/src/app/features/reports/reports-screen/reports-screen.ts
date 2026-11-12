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
} from '../../../core/farm-data.service';
import {
  PERIODS,
  REPORT_TYPES,
  downloadReportCsv,
  reportScope,
} from '../../../shared/reports/reports';

/**
 * Owner reports (Phase 3E) — generate farm-wide reports over the four
 * types (daily operations, task performance, attendance hours, inputs
 * & expenses) and keep the farm-wide history. Every report — the
 * current preview or any history row — exports as CSV.
 */
@Component({
  selector: 'app-reports-screen',
  imports: [ReactiveFormsModule],
  templateUrl: './reports-screen.html',
})
export class ReportsScreen {
  private readonly api = inject(FarmApiService);

  readonly reportTypes = REPORT_TYPES;
  readonly periods = PERIODS;
  readonly fmtClock = fmtClock;
  readonly reportScope = reportScope;

  readonly notice = signal('');
  readonly error = signal('');
  readonly generating = signal(false);

  /** The report currently shown in the preview card. */
  readonly selected = signal<GeneratedReport | null>(null);

  readonly form = new FormGroup({
    type: new FormControl<string>(REPORT_TYPES[0], {
      nonNullable: true,
      validators: [Validators.required],
    }),
    period: new FormControl('today', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  /** Farm-wide generated report history, newest first. */
  readonly history = this.api.opsReports;
  readonly loading = this.api.opsReportsLoading;
  readonly loadError = this.api.opsReportsError;

  constructor() {
    void this.api.ensure('opsReports');
  }

  retry(): void {
    void this.api.ensure('opsReports');
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
