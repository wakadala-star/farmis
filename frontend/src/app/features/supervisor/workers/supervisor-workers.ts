import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import {
  FarmDataService,
  WorkerRec,
  fmtDay,
} from '../../../core/farm-data.service';
import { Department } from '../../../core/models';

/**
 * Supervisor workers — recruit a new worker for the department, jump
 * into task assignment from any worker row, or remove a worker from
 * the team (mock store; the API replaces these later).
 */
@Component({
  selector: 'app-supervisor-workers',
  imports: [ReactiveFormsModule],
  templateUrl: './supervisor-workers.html',
})
export class SupervisorWorkers {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);
  private readonly router = inject(Router);

  readonly dept = (this.auth.department() ?? 'crops') as Department;
  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
  });

  readonly workers = computed(() => this.data.workersOf(this.dept));

  invalid(control: 'name' | 'email'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  recruit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Enter the worker’s name and a valid email address.');
      return;
    }

    const { name, email } = this.form.getRawValue();
    const taken = this.workers().some(
      (worker) => worker.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (taken) {
      this.error.set('A worker with that email already exists in your department.');
      return;
    }

    this.data.addWorker({ name, email, dept: this.dept });
    this.form.reset({ name: '', email: '' });
    this.error.set('');
    this.notice.set(`${name.trim()} recruited to your department.`);
  }

  remove(worker: WorkerRec): void {
    this.data.removeWorker(worker.id);
    this.notice.set(`${worker.name} removed from your department.`);
  }

  /** Opens the assign form with this worker preselected. */
  assign(worker: WorkerRec): void {
    void this.router.navigate(['/supervisor/tasks'], {
      queryParams: { assignee: worker.name },
    });
  }
}
