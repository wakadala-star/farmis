import { Component, computed, inject } from '@angular/core';
import { FarmApiService } from '../../../core/farm-api.service';
import { ago } from '../../../core/format';
import { fmtDay } from '../../../core/farm-data.service';
import {
  ManagementPage,
  ManagementView,
  PageAlert,
  PageUpdate,
  RegistryList,
} from '../../../shared/management-view/management-view';

/**
 * Owner view of Livestock Management — live against the API:
 * meta-tile numbers, low-stock + due-task alerts, the latest
 * supervisor entries and the livestock registry (rows created by
 * the owner's Add Animal action or the supervisors' forms).
 */
@Component({
  selector: 'app-owner-livestock',
  imports: [ManagementView],
  template: `
    @if (loading() && !page()) {
      <p class="empty-state">
        <i class="fa-solid fa-spinner fa-spin"></i>
        Loading livestock management…
      </p>
    } @else if (error() && !page()) {
      <div class="form-alert form-alert--error">
        <i class="fa-solid fa-circle-exclamation"></i>
        <span>{{ error() }}</span>
        <button type="button" class="btn-mini" (click)="retry()">Retry</button>
      </div>
    } @else if (page(); as p) {
      <app-management-view [page]="p" [list]="list()" />
    }
  `,
})
export class OwnerLivestock {
  private readonly api = inject(FarmApiService);

  readonly loading = this.api.deptLivestockLoading;
  readonly error = this.api.deptLivestockError;

  readonly page = computed<ManagementPage | null>(() => {
    const d = this.api.deptLivestock();
    if (!d) return null;

    const alerts: PageAlert[] = d.lowStock.map((row) => ({
      icon: 'fa-solid fa-warehouse',
      tone: 'warn',
      title: row.name,
      text: `Only ${row.qty} ${row.unit} left — reorder at ${row.reorderLevel}`,
      time: ago(row.updatedAt),
    }));
    alerts.push(
      ...d.dueTasks.map((task) => ({
        icon: task.overdue
          ? 'fa-solid fa-triangle-exclamation'
          : 'fa-regular fa-calendar',
        tone: (task.overdue ? 'warn' : 'info') as 'warn' | 'info',
        title: task.title,
        text: `Due ${fmtDay(task.due)} · ${task.assignee}`,
        time: task.overdue ? 'Overdue' : fmtDay(task.due),
      })),
    );
    if (!alerts.length) {
      alerts.push({
        icon: 'fa-solid fa-circle-check',
        tone: 'ok',
        title: 'Nothing needs attention',
        text: 'No low stock and no livestock tasks due in the next 7 days.',
        time: 'Now',
      });
    }

    const updates: PageUpdate[] = d.updates.map((u) => {
      const parts = [u.place, u.subject, u.measure].filter(Boolean).join(' · ');
      return {
        when: ago(u.at),
        author: u.author,
        tag: u.activity,
        text: u.notes || parts || u.activity,
      };
    });

    return {
      note: 'Supervisors record all livestock data — counts, health and stock updates appear here.',
      meta: [
        {
          icon: 'fa-solid fa-triangle-exclamation',
          tone: 'amber',
          value: String(d.meta.openAlerts),
          label: 'Open alerts',
          hint: `${d.lowStock.length} low stock · ${d.dueTasks.length} due soon`,
        },
        {
          icon: 'fa-regular fa-clock',
          tone: 'green',
          value: d.meta.lastEntryAt ? ago(d.meta.lastEntryAt) : '—',
          label: 'Last supervisor entry',
          hint:
            [d.meta.lastEntryBy, d.meta.lastEntryPlace]
              .filter(Boolean)
              .join(' · ') || 'No entries yet',
        },
        {
          icon: 'fa-solid fa-list-check',
          tone: 'blue',
          value: String(d.meta.entriesThisWeek),
          label: 'Entries this week',
          hint: d.meta.activities.slice(0, 3).join(' · ') || 'No activities yet',
        },
      ],
      alerts,
      updates,
    };
  });

  readonly list = computed<RegistryList | null>(() => {
    if (!this.page()) return null;
    const empty = this.api.livestockLoading()
      ? 'Loading the livestock registry…'
      : this.api.livestockError() ||
        'No animals registered yet — add one from the dashboard Quick Actions.';
    return {
      title: 'Livestock Registry',
      icon: 'fa-solid fa-cow',
      rows: this.api.livestock().map((group) => ({
        id: group.id,
        title: `${group.quantity} ${group.species}${group.breed ? ` · ${group.breed}` : ''}`,
        sub: group.notes || `By ${group.createdBy}`,
        meta: [
          group.location || '',
          group.acquiredDate ? `Acquired ${fmtDay(group.acquiredDate)}` : '',
          `Added ${ago(group.createdAt)}`,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      empty,
    };
  });

  constructor() {
    void this.api.ensure('deptLivestock');
    void this.api.ensure('livestock');
  }

  retry(): void {
    void this.api.ensure('deptLivestock');
    void this.api.ensure('livestock');
  }
}
