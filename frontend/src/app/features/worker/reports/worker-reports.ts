import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AuthService } from '../../../core/auth.service';
import {
  FarmDataService,
  dayKey,
  fmtDay,
} from '../../../core/farm-data.service';
import { Department } from '../../../core/models';

/**
 * Worker daily reports — a short report on the tasks worked on today.
 * The supervisor sees the filed reports when reviewing the day.
 */
@Component({
  selector: 'app-worker-reports',
  imports: [ReactiveFormsModule],
  templateUrl: './worker-reports.html',
})
export class WorkerReports {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;
  readonly worker = this.auth.fullName();

  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');

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

  /** Tasks this worker can report against. */
  readonly tasks = this.data.myTasks(this.worker, this.dept);

  /** Reports already filed by this worker, newest first. */
  readonly filed = computed(() => this.data.myReports(this.worker));

  invalid(
    control: 'task' | 'date' | 'hours' | 'summary',
  ): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Pick the task, date and hours, and write a short summary.');
      return;
    }

    const { task, date, hours, summary } = this.form.getRawValue();
    this.data.submitReport({
      worker: this.worker,
      dept: this.dept,
      task,
      date,
      hours: Number(hours),
      summary: summary.trim(),
    });
    this.form.reset({
      task: '',
      date: dayKey(),
      hours: 4,
      summary: '',
    });
    this.error.set('');
    this.notice.set('Daily report submitted to your supervisor.');
  }
}
