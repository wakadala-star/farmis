import {
  Component,
  DestroyRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { FarmApiService } from '../../core/farm-api.service';
import { fmtClock, fmtHMS } from '../../core/farm-data.service';
import { DEPT_SHORT, Department, ROLE_LABELS } from '../../core/models';
import { Brand } from '../../shared/brand/brand';

interface NavItem {
  label: string;
  icon: string;
  link: string;
}

/** Topbar heading + subtitle for the active worker page. */
interface PageMeta {
  title: string;
  sub: string;
  mob: string;
}

/**
 * Worker application shell — desktop sidebar, sticky topbar with the
 * clock control, mobile drawer + bottom navigation.
 *
 * The clock button in the topbar (next to the profile avatar) opens a
 * dropdown with a live h:mm:ss timer: Clock In starts the shift and
 * turns the button red with Clock Out text; clocking out sends the
 * time record to the supervisor's Attendance page for approval.
 */
@Component({
  selector: 'app-worker-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Brand],
  templateUrl: './worker-layout.html',
})
export class WorkerLayout {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly api = inject(FarmApiService);
  private readonly destroyRef = inject(DestroyRef);

  readonly drawerOpen = signal(false);
  readonly collapsed = signal(false);
  readonly userMenuOpen = signal(false);
  readonly clockMenuOpen = signal(false);

  readonly dept = computed<Department>(() => this.auth.department() ?? 'crops');
  readonly deptShort = computed(() => DEPT_SHORT[this.dept()]);

  readonly roleLabel = computed(
    () => `${ROLE_LABELS['worker']} · ${DEPT_SHORT[this.dept()]}`,
  );

  /** Own records still waiting for the supervisor's approval. */
  readonly pendingCount = this.api.pendingCount;

  /** Human date for the topbar pill, e.g. 'Tue, Nov 11, 2026'. */
  readonly todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  /* ---------------- clock in / out ---------------- */

  /** Ticks once a second while clocked in — drives the live timer. */
  private readonly tick = signal(0);

  /** True while a clock-in/out request is in flight. */
  readonly clockBusy = signal(false);

  /** Last clock failure (shown in the dropdown), cleared on the next try. */
  readonly clockError = signal('');

  readonly isClockedIn = computed(() => this.api.runningRecord() !== null);

  /** Live h:mm:ss worked since clock-in (0:00:00 when clocked out). */
  readonly elapsedLabel = computed(() => {
    this.tick(); // recompute every second while the interval runs
    const rec = this.api.runningRecord();
    if (!rec) return '0:00:00';
    return fmtHMS((Date.now() - rec.clockIn) / 1000);
  });

  readonly clockedInAt = computed(() => {
    const rec = this.api.runningRecord();
    return rec ? fmtClock(rec.clockIn) : '';
  });

  /* ---------------- topbar ---------------- */

  /** Active top-level path, kept in sync with the router. */
  private readonly path = signal('');

  /** Heading + subtitle shown in the topbar for the active page. */
  readonly topbar = computed<PageMeta>(() => {
    const name = this.auth.fullName();
    switch (this.path()) {
      case '/worker/data-entry':
        return {
          title: 'Data Entry',
          sub: 'Record today’s crop or livestock activity in the system.',
          mob: 'Record today’s activity',
        };
      case '/worker/reports':
        return {
          title: 'Daily Reports',
          sub: 'Write a short report on the tasks you worked on today.',
          mob: 'Daily task reports',
        };
      case '/worker/attendance':
        return {
          title: 'Attendance',
          sub: 'Your clock-in and clock-out records, awaiting approval.',
          mob: 'Your clock records',
        };
      default:
        return {
          title: 'My Tasks',
          sub: `Hi ${name}! Here are the tasks your supervisor assigned to you.`,
          mob: 'Tasks assigned to you',
        };
    }
  });

  readonly navItems: NavItem[] = [
    { label: 'My Tasks', icon: 'fa-solid fa-list-check', link: '/worker/tasks' },
    { label: 'Data Entry', icon: 'fa-solid fa-pen-to-square', link: '/worker/data-entry' },
    { label: 'Daily Reports', icon: 'fa-solid fa-clipboard', link: '/worker/reports' },
    { label: 'Attendance', icon: 'fa-solid fa-clock', link: '/worker/attendance' },
  ];

  constructor() {
    this.path.set(this.pathOf(this.router.url));

    // Attendance powers the clock state + approval badge across pages.
    void this.api.ensure('attendance');

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((e) => this.path.set(this.pathOf(e.urlAfterRedirects)));

    // Keep the h:mm:ss label fresh every second while clocked in.
    const timer = window.setInterval(() => {
      if (this.isClockedIn()) {
        this.tick.update((value) => value + 1);
      }
    }, 1000);
    this.destroyRef.onDestroy(() => window.clearInterval(timer));
  }

  /* ---------------- clock dropdown ---------------- */

  toggleClockMenu(): void {
    this.clockMenuOpen.update((open) => !open);
  }

  closeClockMenu(): void {
    this.clockMenuOpen.set(false);
  }

  /** Starts the shift, or ends it and sends the record for approval. */
  async toggleClock(): Promise<void> {
    if (this.clockBusy()) return;
    this.clockBusy.set(true);
    this.clockError.set('');
    try {
      const res = this.isClockedIn()
        ? await this.api.clockOut()
        : await this.api.clockIn();
      if (!res.ok) this.clockError.set(res.message);
    } finally {
      this.clockBusy.set(false);
    }
  }

  /* ---------------- shell ---------------- */

  /** Hamburger: collapses the sidebar on desktop, opens the drawer on
   *  tablets and phones. */
  toggleSidebar(): void {
    if (this.isWide()) {
      this.collapsed.update((open) => !open);
    } else {
      this.drawerOpen.update((open) => !open);
    }
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  signOut(): void {
    this.userMenuOpen.set(false);
    this.drawerOpen.set(false);
    this.clockMenuOpen.set(false);
    this.auth.signOut();
    void this.router.navigate(['/signin']);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.drawerOpen.set(false);
    this.userMenuOpen.set(false);
    this.clockMenuOpen.set(false);
  }

  /** '/worker/tasks?x=1' → '/worker/tasks' */
  private pathOf(url: string): string {
    return url.split('?')[0].replace(/\/$/, '');
  }

  private isWide(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 992px)').matches
    );
  }
}
