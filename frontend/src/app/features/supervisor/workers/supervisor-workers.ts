import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { FarmApiService } from '../../../core/farm-api.service';
import { WorkerRec, fmtDay } from '../../../core/farm-data.service';

/**
 * Supervisor workers — recruit a new worker for the department (the
 * supervisor chooses the initial password and passes it on), jump
 * into task assignment from any worker row, or remove someone from
 * the team (the account is deactivated; history stays).
 */
@Component({
  selector: 'app-supervisor-workers',
  imports: [ReactiveFormsModule],
  templateUrl: './supervisor-workers.html',
})
export class SupervisorWorkers {
  private readonly api = inject(FarmApiService);
  private readonly router = inject(Router);

  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');
  readonly submitting = signal(false);
  /** Worker id whose removal is in flight (disables that button). */
  readonly removingId = signal('');

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
  });

  /** Active team of the department (inactive accounts drop out). */
  readonly workers = this.api.workers;
  readonly loading = this.api.workersLoading;
  readonly loadError = this.api.workersError;

  constructor() {
    void this.api.ensure('workers');
  }

  retry(): void {
    void this.api.ensure('workers');
  }

  invalid(control: 'name' | 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  async recruit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(
        'Enter the worker’s name, a valid email and a password of at least 6 characters.',
      );
      return;
    }
    if (this.submitting()) return;

    const { name, email, password } = this.form.getRawValue();
    const taken = this.workers().some(
      (worker) => worker.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (taken) {
      this.error.set('A worker with that email already exists in your department.');
      return;
    }

    this.submitting.set(true);
    try {
      const res = await this.api.recruitWorker({
        name: name.trim(),
        email: email.trim(),
        password,
      });
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.form.reset({ name: '', email: '', password: '' });
      this.error.set('');
      this.notice.set(`${name.trim()} recruited to your department.`);
    } finally {
      this.submitting.set(false);
    }
  }

  async remove(worker: WorkerRec): Promise<void> {
    if (this.removingId()) return;
    this.removingId.set(worker.id);
    try {
      const res = await this.api.removeWorker(worker.id);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.error.set('');
      this.notice.set(`${worker.name} removed from your department.`);
    } finally {
      this.removingId.set('');
    }
  }

  /** Opens the assign form with this worker preselected. */
  assign(worker: WorkerRec): void {
    void this.router.navigate(['/supervisor/tasks'], {
      queryParams: { assignee: worker.email },
    });
  }
}
