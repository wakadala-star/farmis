import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import {
  FarmDataService,
  GeneratedReport,
  dayKey,
  dayOffset,
  fmtClock,
  startOfDay,
} from '../../../core/farm-data.service';
import { Department } from '../../../core/models';

const REPORT_TYPES = [
  'Daily operations summary',
  'Task performance',
  'Attendance hours',
  'Inputs & expenses',
];

const PERIODS: { value: string; label: string; days: number }[] = [
  { value: 'today', label: 'Today', days: 0 },
  { value: '7d', label: 'Last 7 days', days: 6 },
  { value: 'month', label: 'This month', days: 29 },
];

/**
 * Supervisor reports — generate a report over the department's daily
 * operations (workers, tasks, entries, attendance, transaction value).
 * Generated reports are kept in the department's history.
 */
@Component({
  selector: 'app-supervisor-reports',
  imports: [ReactiveFormsModule],
  templateUrl: './supervisor-reports.html',
})
export class SupervisorReports {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;
  readonly reportTypes = REPORT_TYPES;
  readonly periods = PERIODS;
  readonly fmtClock = fmtClock;

  readonly notice = signal('');

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

  get history(): GeneratedReport[] {
    return this.data.generatedOf(this.dept);
  }

  generate(): void {
    const { type, period } = this.form.getRawValue();
    const meta = PERIODS.find((entry) => entry.value === period) ?? PERIODS[0];
    // Period start: local midnight of today, or of the window's first day.
    const periodStart = startOfDay(
      meta.days === 0 ? dayKey() : dayOffset(-meta.days),
    );

    const report = this.data.generateReport(this.dept, type, meta.label, periodStart);
    this.selected.set(report);
    this.notice.set(`${meta.label} report generated.`);
  }

  view(report: GeneratedReport): void {
    this.selected.set(report);
  }
}
