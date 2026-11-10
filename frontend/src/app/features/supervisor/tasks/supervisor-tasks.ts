import { Component, OnInit, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import {
  FarmTask,
  FarmDataService,
  TaskStatus,
  dayKey,
  fmtDay,
  statusLabel,
  statusTone,
} from '../../../core/farm-data.service';
import { Department } from '../../../core/models';

const STATUS_FLOW: TaskStatus[] = ['open', 'in-progress', 'done'];

/**
 * Supervisor tasks — assign work to a worker of the department and
 * track every task's status. New assignments appear immediately on
 * the worker's "My Tasks" screen (shared mock store).
 */
@Component({
  selector: 'app-supervisor-tasks',
  imports: [ReactiveFormsModule],
  templateUrl: './supervisor-tasks.html',
})
export class SupervisorTasks implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);
  private readonly route = inject(ActivatedRoute);

  readonly dept = (this.auth.department() ?? 'crops') as Department;

  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  readonly fmtDay = fmtDay;

  readonly notice = signal('');
  readonly error = signal('');

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

  ngOnInit(): void {
    // /supervisor/tasks?assignee=Name — quick-assign from the Workers page.
    const preset = this.route.snapshot.queryParamMap.get('assignee');
    if (preset) {
      this.form.controls.assignee.setValue(preset);
    }
    this.form.controls.due.setValue(this.defaultDue());
  }

  get workers(): { name: string }[] {
    return this.data.workersOf(this.dept);
  }

  get tasks(): FarmTask[] {
    return this.data.tasksOf(this.dept);
  }

  invalid(control: 'title' | 'assignee' | 'due'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  assign(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Fill in the task title, worker and due date.');
      return;
    }

    const { title, assignee, due, notes } = this.form.getRawValue();
    this.data.assignTask({ title, notes, dept: this.dept, assignee, due });
    this.form.reset({ title: '', assignee, due: this.defaultDue(), notes: '' });
    this.error.set('');
    this.notice.set(`Task assigned to ${assignee}.`);
  }

  /** open → in-progress → done → open (cycles). */
  advance(task: FarmTask): void {
    const index = STATUS_FLOW.indexOf(task.status);
    const next = STATUS_FLOW[(index + 1) % STATUS_FLOW.length];
    this.data.setTaskStatus(task.id, next);
    this.notice.set(`“${task.title}” marked ${statusLabel(next).toLowerCase()}.`);
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
