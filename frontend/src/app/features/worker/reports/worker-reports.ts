import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FarmApiService } from '../../../core/farm-api.service';
import { dayKey, fmtDay } from '../../../core/farm-data.service';

/**
 * Worker daily reports — a short report on the tasks worked on today.
 * The Task field is free text that suggests your assigned tasks, so a
 * report can be filed even before the supervisor assigns anything.
 * The supervisor sees the filed reports when reviewing the day.
 */
@Component({
  selector: 'app-worker-reports',
  imports: [ReactiveFormsModule],
  templateUrl: './worker-reports.html',
})
export class WorkerReports {
  private readonly api = inject(FarmApiService);

  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');
  readonly submitting = signal(false);

  readonly form = new FormGroup({
    task: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    date: new FormControl(dayKey(), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    hours: new FormControl(4, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(1), Validators.max(24)],
    }),
    summary: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(10)],
    }),
  });

  /** Assigned tasks offered as dropdown suggestions (free text allowed). */
  readonly tasks = this.api.tasks;

  /** Reports already filed by this worker, newest first. */
  readonly filed = this.api.reports;
  readonly loading = this.api.reportsLoading;
  readonly loadError = this.api.reportsError;

  constructor() {
    void this.api.ensure('reports');
    void this.api.ensure('tasks');
  }

  retry(): void {
    void this.api.ensure('reports');
  }

  invalid(
    control: 'task' | 'date' | 'hours' | 'summary',
  ): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  async submit(): Promise<void> {
    const { task, date, hours, summary } = this.form.getRawValue();

    if (this.form.invalid || !task.trim()) {
      this.form.markAllAsTouched();
      this.error.set('Name the task, pick the date and hours, and write a short summary.');
      return;
    }
    if (this.submitting()) return;

    this.submitting.set(true);
    try {
      const res = await this.api.submitReport({
        task: task.trim(),
        date,
        hours: Number(hours),
        summary: summary.trim(),
      });

      if (!res.ok) {
        this.error.set(res.message);
        return;
      }

      this.form.reset({
        task: '',
        date: dayKey(),
        hours: 4,
        summary: '',
      });
      this.error.set('');
      this.notice.set('Daily report submitted to your supervisor.');
    } finally {
      this.submitting.set(false);
    }
  }
}
