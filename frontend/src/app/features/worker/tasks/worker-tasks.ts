import { Component, inject } from '@angular/core';
import { AuthService } from '../../../core/auth.service';
import {
  FarmDataService,
  dayKey,
  fmtDay,
  statusLabel,
  statusTone,
} from '../../../core/farm-data.service';
import { Department } from '../../../core/models';
import { MetaTile } from '../../../shared/management-view/management-view';

/**
 * Worker tasks — a read-only view of everything the supervisor has
 * assigned to this worker, with live status and due-day chips.
 */
@Component({
  selector: 'app-worker-tasks',
  templateUrl: './worker-tasks.html',
})
export class WorkerTasks {
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;
  readonly worker = this.auth.fullName();

  readonly fmtDay = fmtDay;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;

  readonly tasks = this.data.myTasks(this.worker, this.dept);

  readonly tiles: MetaTile[] = this.buildTiles();

  dueTone(due: string, status: string): string {
    if (status === 'done') return 'neutral';
    const today = dayKey();
    if (due < today) return 'red';
    if (due === today) return 'amber';
    return 'blue';
  }

  private buildTiles(): MetaTile[] {
    const open = this.tasks.filter((task) => task.status === 'open').length;
    const inProgress = this.tasks.filter(
      (task) => task.status === 'in-progress',
    ).length;
    const done = this.tasks.filter((task) => task.status === 'done').length;

    return [
      {
        icon: 'fa-solid fa-circle-half-stroke',
        tone: 'amber',
        value: String(open),
        label: 'Open',
        hint: 'Not started yet',
      },
      {
        icon: 'fa-solid fa-spinner',
        tone: 'blue',
        value: String(inProgress),
        label: 'In progress',
        hint: 'Currently being worked on',
      },
      {
        icon: 'fa-solid fa-circle-check',
        tone: 'green',
        value: String(done),
        label: 'Completed',
        hint: 'Finished tasks',
      },
    ];
  }
}
