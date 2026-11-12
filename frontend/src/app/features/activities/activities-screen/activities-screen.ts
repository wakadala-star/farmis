import { Component, inject, signal } from '@angular/core';
import {
  EntryFilter,
  EntryStats,
  FarmApiService,
} from '../../../core/farm-api.service';
import { AuthService } from '../../../core/auth.service';
import { DataEntryRec, fmtDay } from '../../../core/farm-data.service';

/**
 * Farm Activities (Phase 3D) — the field-entry feed, shared by the
 * owner (/activities, any department) and supervisors
 * (/supervisor/activities, locked to their own department by the API):
 *
 *   three tiles  entries in the current view, entries filed this week
 *                (Mon-start) and the distinct activity count
 *   filters      department (owner only), date range, activity name
 *                and a free-text search over subject/place/notes
 *   the feed     subject, activity, place, worker, date, measure and
 *                notes — read-only; workers file entries on their own
 *                Data Entry screen.
 */
@Component({
  selector: 'app-activities-screen',
  imports: [],
  templateUrl: './activities-screen.html',
})
export class ActivitiesScreen {
  private readonly api = inject(FarmApiService);
  private readonly auth = inject(AuthService);

  readonly fmtDay = fmtDay;

  /** Owners pick a department; supervisors are locked to their own. */
  readonly isOwner = this.auth.role() === 'owner';

  readonly notice = signal('');
  readonly error = signal('');

  /* ---------------- feed ---------------- */
  readonly entries = signal<DataEntryRec[]>([]);
  readonly count = signal(0);
  readonly stats = signal<EntryStats>({ total: 0, thisWeek: 0, activities: 0 });
  readonly loading = signal(true);
  readonly loadError = signal('');

  /** Distinct activity names behind the activity filter. */
  readonly activities = signal<string[]>([]);

  /* ---------------- filters ---------------- */
  readonly filterDept = signal('');
  readonly filterFrom = signal('');
  readonly filterTo = signal('');
  readonly filterActivity = signal('');
  readonly filterQ = signal('');

  constructor() {
    void this.loadActivities();
    void this.load();
  }

  /* ---------------- loads ---------------- */

  private filter(): EntryFilter {
    return {
      // Non-owners are locked server-side — don't even send a dept.
      dept: this.isOwner ? this.filterDept() || undefined : undefined,
      dateFrom: this.filterFrom() || undefined,
      dateTo: this.filterTo() || undefined,
      activity: this.filterActivity() || undefined,
      q: this.filterQ().trim() || undefined,
    };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    const res = await this.api.listEntries(this.filter());
    this.loading.set(false);
    if (!res.ok) {
      this.loadError.set(res.message);
      return;
    }
    this.entries.set(res.entries);
    this.count.set(res.count);
    this.stats.set(res.stats);
  }

  retry(): void {
    void this.load();
  }

  private async loadActivities(): Promise<void> {
    const res = await this.api.listEntryActivities();
    if (res.ok) this.activities.set(res.activities);
  }

  /* ---------------- filter handlers ---------------- */

  onFilterDept(ev: Event): void {
    this.filterDept.set((ev.target as HTMLSelectElement).value);
    void this.load();
  }

  onFilterFrom(ev: Event): void {
    this.filterFrom.set((ev.target as HTMLInputElement).value);
    void this.load();
  }

  onFilterTo(ev: Event): void {
    this.filterTo.set((ev.target as HTMLInputElement).value);
    void this.load();
  }

  onFilterActivity(ev: Event): void {
    this.filterActivity.set((ev.target as HTMLSelectElement).value);
    void this.load();
  }

  onFilterQ(ev: Event): void {
    this.filterQ.set((ev.target as HTMLInputElement).value);
    void this.load();
  }

  resetFilters(): void {
    this.filterDept.set('');
    this.filterFrom.set('');
    this.filterTo.set('');
    this.filterActivity.set('');
    this.filterQ.set('');
    void this.load();
  }

  hasFilters(): boolean {
    return !!(
      this.filterDept() ||
      this.filterFrom() ||
      this.filterTo() ||
      this.filterActivity() ||
      this.filterQ().trim()
    );
  }

  /* ---------------- helpers for the template ---------------- */

  deptLabel(dept: string): string {
    if (dept === 'livestock') return 'Livestock';
    if (dept === 'crops') return 'Crops';
    return '';
  }

  deptIcon(dept: string): string {
    return dept === 'livestock' ? 'fa-solid fa-cow' : 'fa-solid fa-seedling';
  }

  deptIconClass(dept: string): string {
    return dept === 'livestock'
      ? 'list-row__icon list-row__icon--blue'
      : 'list-row__icon';
  }
}
