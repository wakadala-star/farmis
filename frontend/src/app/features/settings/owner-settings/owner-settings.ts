import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  AuthLogEntry,
  FarmApiService,
  apiMessage,
} from '../../../core/farm-api.service';
import { fmtDay } from '../../../core/farm-data.service';
import { environment } from '../../../../environments/environment';

const PAGE_SIZE = 25;

/** Human labels for auth_attempts.reason values. */
const REASON_LABELS: Record<string, string> = {
  validation: 'Form validation failed',
  duplicate_email: 'Email already registered',
  owner_closed: 'Owner sign-up is closed',
  unknown_email: 'No account with that email',
  bad_password: 'Wrong password',
  inactive_account: 'Account is inactive',
};

/** Human labels for auth_attempts.action values. */
const ACTION_LABELS: Record<string, string> = {
  signin: 'Sign in',
  signup: 'Sign up',
  profile_update: 'Profile update',
};

/**
 * Owner Settings — two cards: the sign-in activity log (every recent
 * attempt with outcome, failure reason and IP address) and an About
 * block with the app version, the deployed site's date and a live API
 * status ping for instant "can the app reach the server" diagnosis.
 */
@Component({
  selector: 'app-owner-settings',
  templateUrl: './owner-settings.html',
})
export class OwnerSettings implements OnInit {
  private readonly api = inject(FarmApiService);

  readonly version = environment.version;

  /* ---------------- sign-in activity ---------------- */

  readonly attempts = signal<AuthLogEntry[]>([]);
  readonly totals = signal({ all: 0, failures: 0 });
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly failuresOnly = signal(false);
  readonly loadingMore = signal(false);

  /** Rows for the active filter (drives the tab badges). */
  readonly visibleTotal = computed(() =>
    this.failuresOnly() ? this.totals().failures : this.totals().all,
  );

  /** Rows still hidden behind "Load more". */
  readonly hasMore = computed(() => this.attempts().length < this.visibleTotal());

  /* ---------------- about & status ---------------- */

  readonly apiState = signal<'checking' | 'live' | 'offline'>('checking');
  readonly apiMs = signal(0);
  readonly checkedAt = signal('');
  readonly siteUpdated = signal('');

  ngOnInit(): void {
    void this.loadLog();
    void this.checkApi();
    void this.loadSiteUpdated();
  }

  /* ---------------- sign-in activity actions ---------------- */

  async setFilter(failures: boolean): Promise<void> {
    if (this.failuresOnly() === failures) return;
    this.failuresOnly.set(failures);
    await this.loadLog();
  }

  async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await this.api.getAuthLog(
        PAGE_SIZE,
        this.attempts().length,
        this.failuresOnly(),
      );
      this.attempts.update((list) => [...list, ...page.attempts]);
      this.totals.set(page.totals);
      this.loadError.set('');
    } catch (err) {
      this.loadError.set(apiMessage(err));
    } finally {
      this.loadingMore.set(false);
    }
  }

  retryLog(): void {
    void this.loadLog();
  }

  /* ---------------- about & status actions ---------------- */

  async checkApi(): Promise<void> {
    this.apiState.set('checking');
    try {
      this.apiMs.set(await this.api.pingApi());
      this.apiState.set('live');
    } catch {
      this.apiState.set('offline');
    }
    this.checkedAt.set(new Date().toLocaleTimeString());
  }

  /* ---------------- row helpers ---------------- */

  actionLabel(a: AuthLogEntry): string {
    return ACTION_LABELS[a.action] ?? a.action;
  }

  reasonLabel(a: AuthLogEntry): string | null {
    if (a.outcome === 'success') return null;
    return (a.reason && REASON_LABELS[a.reason]) || a.reason || 'Attempt failed';
  }

  outcomeChip(a: AuthLogEntry): string {
    return a.outcome === 'success' ? 'chip chip--green' : 'chip chip--red';
  }

  rowIconTone(a: AuthLogEntry): string {
    return a.outcome === 'success' ? 'list-row__icon' : 'list-row__icon list-row__icon--red';
  }

  rowIconGlyph(a: AuthLogEntry): string {
    return a.action === 'signup'
      ? 'fa-solid fa-user-plus'
      : a.action === 'profile_update'
        ? 'fa-solid fa-user-pen'
        : 'fa-solid fa-right-to-bracket';
  }

  statusIcon(): string {
    return this.apiState() === 'live'
      ? 'list-row__icon'
      : this.apiState() === 'offline'
        ? 'list-row__icon list-row__icon--red'
        : 'list-row__icon list-row__icon--amber';
  }

  apiChip(): string {
    return this.apiState() === 'live'
      ? 'chip chip--green'
      : this.apiState() === 'offline'
        ? 'chip chip--red'
        : 'chip chip--neutral';
  }

  apiChipLabel(): string {
    return this.apiState() === 'live'
      ? `Live · ${this.apiMs()} ms`
      : this.apiState() === 'offline'
        ? 'Offline'
        : 'Checking…';
  }

  relTime(iso: string): string {
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} d ago`;
    return fmtDay(iso.slice(0, 10));
  }

  absTime(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  /* ---------------- private ---------------- */

  private async loadLog(): Promise<void> {
    this.loading.set(true);
    this.loadError.set('');
    try {
      const page = await this.api.getAuthLog(PAGE_SIZE, 0, this.failuresOnly());
      this.attempts.set(page.attempts);
      this.totals.set(page.totals);
    } catch (err) {
      this.loadError.set(apiMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Deploy date from the served index.html (same-origin HEAD). */
  private async loadSiteUpdated(): Promise<void> {
    try {
      const res = await fetch('index.html', { method: 'HEAD', cache: 'no-store' });
      const lm = res.headers.get('last-modified');
      if (lm) this.siteUpdated.set(fmtDay(lm.slice(0, 10)));
    } catch {
      /* dev server serves no Last-Modified — the row stays '—' */
    }
  }
}
