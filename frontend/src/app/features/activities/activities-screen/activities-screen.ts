import { Component, HostListener, computed, inject, signal } from '@angular/core';
import {
  EntryFilter,
  EntryStats,
  FarmApiService,
  PlanActivity,
} from '../../../core/farm-api.service';
import { AuthService } from '../../../core/auth.service';
import { DataEntryRec, dayKey, fmtDay, startOfDay } from '../../../core/farm-data.service';

/** One day cell of the plan calendar. */
interface DayCell {
  key: string; // YYYY-MM-DD
  day: number; // day of month
  inMonth: boolean; // belongs to the visible month
  isToday: boolean;
  activities: PlanActivity[];
}

type Cadence = PlanActivity['cadence'];

const CADENCES: Cadence[] = ['once', 'weekly', 'monthly'];
const DAY_MS = 86_400_000;

/**
 * Farm Activities (Phase 3D redesign) — two tabs, shared by the owner
 * (/activities, any department) and supervisors
 * (/supervisor/activities, locked to their own department by the API):
 *
 *   Plan (default)  a month calendar of planned activities. Owners add,
 *                   edit and delete them from the day modal — cadence
 *                   once / weekly / monthly (weekly repeats on the
 *                   anchor's weekday, monthly on its day-of-month, both
 *                   from the clicked date onward). Supervisors read the
 *                   same calendar and carve each day's activities into
 *                   task portions with the existing task form.
 *   Entries         the Phase 3D feed: three tiles, filters (department
 *                   for the owner, dates, activity, search) and the
 *                   read-only feed workers file into.
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

  /** Owners manage the plan; supervisors read it and assign portions. */
  readonly isOwner = this.auth.role() === 'owner';

  /* ---------------- tabs ---------------- */

  readonly tab = signal<'plan' | 'entries'>('plan');

  switchTab(tab: 'plan' | 'entries'): void {
    this.tab.set(tab);
  }

  /* ---------------- plan calendar ---------------- */

  readonly plan = this.api.plan;
  readonly planLoading = this.api.planLoading;
  readonly planError = this.api.planError;

  /** The month on screen (0-based month). */
  private readonly viewYear = signal(new Date().getFullYear());
  private readonly viewMonth = signal(new Date().getMonth());

  readonly monthLabel = computed(() =>
    new Date(this.viewYear(), this.viewMonth(), 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    }),
  );

  /** Monday-first, matching the week the stats screens count. */
  readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /** Day cells of the visible month with the plan expanded onto them. */
  readonly cells = computed<DayCell[]>(() => {
    const plan = this.plan();
    const year = this.viewYear();
    const month = this.viewMonth();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7; // Mon = 0
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const rows = Math.ceil((lead + daysInMonth) / 7);
    const today = dayKey();

    const cells: DayCell[] = [];
    for (let i = 0; i < rows * 7; i++) {
      const date = new Date(year, month, 1 - lead + i);
      const key = dayKey(date);
      cells.push({
        key,
        day: date.getDate(),
        inMonth: date.getMonth() === month,
        isToday: key === today,
        activities: plan.filter((activity) => this.occursOn(activity, key)),
      });
    }
    return cells;
  });

  /** The day the modal is open for ('' = closed). */
  readonly selectedDate = signal('');

  readonly dayLabel = computed(() => {
    const key = this.selectedDate();
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  });

  /** The plan's occurrences on the selected day. */
  readonly dayActivities = computed(() => {
    const key = this.selectedDate();
    if (!key) return [];
    return this.plan().filter((activity) => this.occursOn(activity, key));
  });

  /* ---------------- day modal: owner form ---------------- */

  readonly modalNotice = signal('');
  readonly modalError = signal('');
  readonly saving = signal(false);

  readonly formTitle = signal('');
  readonly formNotes = signal('');
  readonly formCadence = signal('once');
  /** '' = adding; otherwise the id of the activity being edited. */
  readonly editingId = signal('');

  /* ---------------- day modal: supervisor assign ---------------- */

  readonly assigningId = signal('');
  readonly assignTitle = signal('');
  readonly assignee = signal('');
  readonly assignDue = signal('');
  readonly assignNotes = signal('');

  readonly workers = this.api.workers;
  readonly workersLoading = this.api.workersLoading;

  /* ---------------- feed (Phase 3D) ---------------- */

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
    void this.api.ensure('plan');
    if (!this.isOwner) void this.api.ensure('workers');
  }

  /* ---------------- plan: month + day navigation ---------------- */

  prevMonth(): void {
    const month = this.viewMonth() - 1;
    if (month < 0) {
      this.viewMonth.set(11);
      this.viewYear.update((year) => year - 1);
    } else {
      this.viewMonth.set(month);
    }
  }

  nextMonth(): void {
    const month = this.viewMonth() + 1;
    if (month > 11) {
      this.viewMonth.set(0);
      this.viewYear.update((year) => year + 1);
    } else {
      this.viewMonth.set(month);
    }
  }

  goToday(): void {
    const now = new Date();
    this.viewYear.set(now.getFullYear());
    this.viewMonth.set(now.getMonth());
  }

  openDay(cell: DayCell): void {
    this.selectedDate.set(cell.key);
    this.modalNotice.set('');
    this.modalError.set('');
    this.cancelEdit();
    this.cancelAssign();
  }

  closeDay(): void {
    this.selectedDate.set('');
    this.modalNotice.set('');
    this.modalError.set('');
    this.cancelEdit();
    this.cancelAssign();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.selectedDate()) this.closeDay();
  }

  retryPlan(): void {
    void this.api.ensure('plan', true);
  }

  /* ---------------- plan: owner CRUD ---------------- */

  startEdit(activity: PlanActivity): void {
    this.editingId.set(activity.id);
    this.formTitle.set(activity.title);
    this.formNotes.set(activity.notes);
    this.formCadence.set(activity.cadence);
    this.modalNotice.set('');
    this.modalError.set('');
  }

  cancelEdit(): void {
    this.editingId.set('');
    this.formTitle.set('');
    this.formNotes.set('');
    this.formCadence.set('once');
  }

  onCadenceChange(value: string): void {
    this.formCadence.set(value as Cadence);
  }

  async savePlan(): Promise<void> {
    const title = this.formTitle().trim();
    const notes = this.formNotes().trim();
    const cadence = this.formCadence();

    if (title.length < 3 || title.length > 150) {
      this.modalError.set('Give the activity a short title (3–150 characters).');
      return;
    }
    if (notes.length > 500) {
      this.modalError.set('Notes must be 500 characters or fewer.');
      return;
    }
    if (!CADENCES.includes(cadence as Cadence)) {
      this.modalError.set('Cadence must be once, weekly or monthly.');
      return;
    }

    this.saving.set(true);
    this.modalError.set('');
    const res = this.editingId()
      ? await this.api.updatePlanActivity(this.editingId(), { title, notes, cadence: cadence as Cadence })
      : await this.api.createPlanActivity({
          title,
          notes,
          cadence: cadence as Cadence,
          date: this.selectedDate(),
        });
    this.saving.set(false);

    if (!res.ok) {
      this.modalError.set(res.message);
      return;
    }
    this.modalNotice.set(res.message);
    this.cancelEdit();
  }

  async removePlan(activity: PlanActivity): Promise<void> {
    this.saving.set(true);
    this.modalError.set('');
    const res = await this.api.deletePlanActivity(activity.id);
    this.saving.set(false);

    if (!res.ok) {
      this.modalError.set(res.message);
      return;
    }
    if (this.editingId() === activity.id) this.cancelEdit();
    this.modalNotice.set(res.message);
  }

  /* ---------------- plan: supervisor assign ---------------- */

  startAssign(activity: PlanActivity): void {
    this.assigningId.set(activity.id);
    this.assignTitle.set(activity.title);
    this.assignee.set('');
    this.assignDue.set(this.selectedDate());
    this.assignNotes.set('');
    this.modalNotice.set('');
    this.modalError.set('');
  }

  cancelAssign(): void {
    this.assigningId.set('');
  }

  async submitAssign(): Promise<void> {
    const title = this.assignTitle().trim();
    const assignee = this.assignee();
    const due = this.assignDue();
    const notes = this.assignNotes().trim();

    const errors: string[] = [];
    if (title.length < 3 || title.length > 150) {
      errors.push('Give the task a short title (3–150 characters).');
    }
    if (!assignee) errors.push('Choose the worker who will do it.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) errors.push('A valid due date is required.');
    if (notes.length > 500) errors.push('Notes must be 500 characters or fewer.');
    if (errors.length) {
      this.modalError.set(errors.join(' '));
      return;
    }

    this.saving.set(true);
    this.modalError.set('');
    const res = await this.api.assignTask({
      title,
      assignee,
      due,
      notes,
      activityId: this.assigningId(),
    });
    this.saving.set(false);

    if (!res.ok) {
      this.modalError.set(res.message);
      return;
    }
    this.modalNotice.set(res.message);
    this.cancelAssign();
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

  cadenceLabel(cadence: Cadence): string {
    return cadence === 'once' ? 'Once' : cadence === 'weekly' ? 'Weekly' : 'Monthly';
  }

  /** 'No portions assigned yet' / '3 portions assigned · 1 done'. */
  portionsLabel(activity: PlanActivity): string {
    if (activity.assigned === 0) return 'No portions assigned yet';
    const head = `${activity.assigned} portion${activity.assigned === 1 ? '' : 's'} assigned`;
    return activity.done > 0 ? `${head} · ${activity.done} done` : head;
  }

  /** Tooltip / aria-label: the date plus the day's activities. */
  cellTitle(cell: DayCell): string {
    if (cell.activities.length === 0) return cell.key;
    return `${cell.key} — ${cell.activities.map((activity) => activity.title).join(' · ')}`;
  }

  /**
   * Does this plan item fall on the given day? Weekly = same weekday as
   * the anchor, monthly = same day-of-month (months without that day
   * are skipped), both from the anchor onward; once = the anchor only.
   */
  private occursOn(activity: PlanActivity, key: string): boolean {
    const at = startOfDay(key);
    const anchor = startOfDay(activity.date);
    if (at < anchor) return false;
    if (activity.cadence === 'once') return at === anchor;
    if (activity.cadence === 'weekly') {
      // Whole-day difference — rounding keeps this exact across any
      // daylight-saving shift in the browser's local time.
      const days = Math.round((at - anchor) / DAY_MS);
      return days % 7 === 0;
    }
    return new Date(at).getDate() === new Date(anchor).getDate();
  }
}
