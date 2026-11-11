import { Component, OnInit, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { FarmApiService } from '../../../core/farm-api.service';
import {
  FarmTask,
  TaskStatus,
  dayKey,
  fmtDay,
  statusLabel,
  statusTone,
} from '../../../core/farm-data.service';

const STATUS_FLOW: TaskStatus[] = ['open', 'in-progress', 'done'];

/**
 * Supervisor tasks — assign work to a worker of the department and
 * track every task's status. New assignments appear immediately on
 * the worker's "My Tasks" screen (shared backend).
 */
@Component({
  selector: 'app-supervisor-tasks',
  imports: [ReactiveFormsModule],
  templateUrl: './supervisor-tasks.html',
})
export class SupervisorTasks implements OnInit {
  private readonly api = inject(FarmApiService);
  private readonly route = inject(ActivatedRoute);

  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');
  readonly submitting = signal(false);
  /** Task id whose Advance request is in flight (disables that button). */
  readonly advancingId = signal('');

  readonly form = new FormGroup({
    title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(3)],
    }),
    assignee: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    due: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    notes: new FormControl('', { nonNullable: true }),
  });

  /** Active team workers of the department (select holds their email). */
  readonly workers = this.api.workers;
  readonly workersLoading = this.api.workersLoading;

  /** Every live task of the department, due date first. */
  readonly tasks = this.api.deptTasks;
  readonly loading = this.api.deptTasksLoading;
  readonly loadError = this.api.deptTasksError;

  constructor() {
    void this.api.ensure('deptTasks');
    void this.api.ensure('workers');
  }

  ngOnInit(): void {
    // /supervisor/tasks?assignee=email — quick-assign from the Workers page.
    const preset = this.route.snapshot.queryParamMap.get('assignee');
    if (preset) {
      this.form.controls.assignee.setValue(preset);
    }
    this.form.controls.due.setValue(this.defaultDue());
  }

  retry(): void {
    void this.api.ensure('deptTasks');
  }

  invalid(control: 'title' | 'assignee' | 'due'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  async assign(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Fill in the task title, worker and due date.');
      return;
    }
    if (this.submitting()) return;

    const { title, assignee, due, notes } = this.form.getRawValue();
    this.submitting.set(true);
    try {
      const res = await this.api.assignTask({ title, assignee, due, notes });
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.form.reset({ title: '', assignee, due: this.defaultDue(), notes: '' });
      this.error.set('');
      this.notice.set(res.message);
    } finally {
      this.submitting.set(false);
    }
  }

  /** open → in-progress → done → open (cycles). */
  async advance(task: FarmTask): Promise<void> {
    if (this.advancingId()) return;
    const index = STATUS_FLOW.indexOf(task.status);
    const next = STATUS_FLOW[(index + 1) % STATUS_FLOW.length];

    this.advancingId.set(task.id);
    try {
      const res = await this.api.advanceTask(task.id, next);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.error.set('');
      this.notice.set(`“${task.title}” marked ${statusLabel(next).toLowerCase()}.`);
    } finally {
      this.advancingId.set('');
    }
  }

  dueTone(task: FarmTask): string {
    if (task.status === 'done') return 'neutral';
    const today = dayKey();
    if (task.due < today) return 'red';
    if (task.due === today) return 'amber';
    return 'blue';
  }

  private defaultDue(): string {
    const d = new Date(Date.now() + 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  }
}
