import { Component, HostListener, computed, inject, signal } from '@angular/core';
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
import {
  DEPT_LABELS,
  DEPT_SHORT,
  Department,
  ROLE_LABELS,
} from '../../core/models';
import { Brand } from '../../shared/brand/brand';
import { ProfileMenu } from '../../shared/profile-menu/profile-menu';

interface NavItem {
  label: string;
  icon: string;
  link: string;
}

/** Topbar heading + subtitle for the active supervisor page. */
interface PageMeta {
  title: string;
  sub: string;
  mob: string;
}

/** One system message in the bell's dropdown (Phase 4). */
interface BellMessage {
  text: string;
  link: string;
  icon: string;
}

/**
 * Supervisor application shell — shared by the crop and livestock
 * supervisors (the session's department scopes every screen).
 *
 * Six working modules: Dashboard, Tasks, Reports, Attendance,
 * Transactions and Workers — all reading the live backend.
 */
@Component({
  selector: 'app-supervisor-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Brand, ProfileMenu],
  templateUrl: './supervisor-layout.html',
})
export class SupervisorLayout {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly api = inject(FarmApiService);

  readonly drawerOpen = signal(false);
  readonly collapsed = signal(false);
  readonly userMenuOpen = signal(false);

  readonly dept = computed<Department>(() => this.auth.department() ?? 'crops');
  readonly deptLabel = computed(() => DEPT_LABELS[this.dept()]);
  readonly deptShort = computed(() => DEPT_SHORT[this.dept()]);

  readonly roleLabel = computed(
    () => `${ROLE_LABELS['supervisor']} · ${DEPT_SHORT[this.dept()]}`,
  );

  /** Badge on the bell: everything still waiting for this supervisor. */
  readonly pendingCount = this.api.supervisorPendingCount;

  /** Human date for the topbar pill, e.g. 'Fri, Nov 13, 2026'. */
  readonly todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  /** Bell dropdown open state. */
  readonly bellMenuOpen = signal(false);

  /** System messages: the pending work behind the badge, each linking
   *  to the page that clears it (Phase 4). Sums to pendingCount(). */
  readonly messages = computed<BellMessage[]>(() => {
    const list: BellMessage[] = [];
    const attendance = this.api
      .deptAttendance()
      .filter((rec) => rec.status === 'pending').length;
    if (attendance > 0) {
      list.push({
        text:
          attendance === 1
            ? '1 attendance record awaiting approval'
            : `${attendance} attendance records awaiting approval`,
        link: '/supervisor/attendance',
        icon: 'fa-solid fa-clock',
      });
    }
    const credits = this.api
      .transactions()
      .filter((tx) => tx.status === 'pending').length;
    if (credits > 0) {
      list.push({
        text:
          credits === 1
            ? '1 credit request awaiting decision'
            : `${credits} credit requests awaiting decision`,
        link: '/supervisor/transactions',
        icon: 'fa-solid fa-money-bill-transfer',
      });
    }
    return list;
  });

  /** Active top-level path, kept in sync with the router. */
  private readonly path = signal('');

  /** Heading + subtitle shown in the topbar for the active page. */
  readonly topbar = computed<PageMeta>(() => {
    const name = this.auth.fullName();
    const dept = this.deptShort();
    switch (this.path()) {
      case '/supervisor/tasks':
        return {
          title: 'Tasks',
          sub: `Welcome back, ${name}! Assign and track work for the ${dept} team.`,
          mob: 'Assign & track tasks',
        };
      case '/supervisor/reports':
        return {
          title: 'Reports',
          sub: 'Generate reports on the farm’s daily operations.',
          mob: 'Operations reports',
        };
      case '/supervisor/attendance':
        return {
          title: 'Attendance',
          sub: `Confirm your workers’ clock-ins and clock-outs, ${name}.`,
          mob: 'Confirm clock-ins & outs',
        };
      case '/supervisor/transactions':
        return {
          title: 'Transactions',
          sub: 'Approve credit transactions submitted by workers.',
          mob: 'Approve transactions',
        };
      case '/supervisor/sales':
        return {
          title: 'Sales & Customers',
          sub: 'Record farm sales, review receipts and manage the customer book.',
          mob: 'Sales & customers',
        };
      case '/supervisor/inventory':
        return {
          title: 'Inventory & Stores',
          sub: 'Track your department’s items, movements and reorder alerts.',
          mob: 'Stock & movements',
        };
      case '/supervisor/activities':
        return {
          title: 'Farm Activities',
          sub: 'Your department’s field entries — filter by date, activity or search.',
          mob: 'Department field entries',
        };
      case '/supervisor/workers':
        return {
          title: 'Workers',
          sub: 'Recruit, assign tasks and manage your department team.',
          mob: 'Manage your workers',
        };
      default:
        return {
          title: 'Supervisor Dashboard',
          sub: `Welcome back, ${name}! Here is your ${dept} department at a glance.`,
          mob: 'Department at a glance',
        };
    }
  });

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'fa-solid fa-gauge-high', link: '/supervisor/dashboard' },
    { label: 'Tasks', icon: 'fa-solid fa-list-check', link: '/supervisor/tasks' },
    { label: 'Reports', icon: 'fa-solid fa-file-lines', link: '/supervisor/reports' },
    { label: 'Farm Activities', icon: 'fa-solid fa-calendar-check', link: '/supervisor/activities' },
    { label: 'Attendance', icon: 'fa-solid fa-clock', link: '/supervisor/attendance' },
    { label: 'Transactions', icon: 'fa-solid fa-money-bill-transfer', link: '/supervisor/transactions' },
    { label: 'Sales & Customers', icon: 'fa-solid fa-cart-shopping', link: '/supervisor/sales' },
    { label: 'Inventory & Stores', icon: 'fa-solid fa-warehouse', link: '/supervisor/inventory' },
    { label: 'Workers', icon: 'fa-solid fa-users', link: '/supervisor/workers' },
  ];

  constructor() {
    this.path.set(this.pathOf(this.router.url));

    // Attendance + credit feeds power the bell badge across pages.
    void this.api.ensure('deptAttendance');
    void this.api.ensure('transactions');

    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this.path.set(this.pathOf(e.urlAfterRedirects)));
  }

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
    this.userMenuOpen.set(false);
  }

  toggleUserMenu(): void {
    // The profile dropdown lives in the sidebar; on phones/tablets the
    // topbar avatar has to reveal the drawer first so the panel shows.
    if (!this.isWide()) {
      this.drawerOpen.set(true);
    }
    this.userMenuOpen.update((open) => !open);
  }

  toggleBell(): void {
    this.bellMenuOpen.update((open) => !open);
  }

  closeBell(): void {
    this.bellMenuOpen.set(false);
  }

  signOut(): void {
    this.userMenuOpen.set(false);
    this.drawerOpen.set(false);
    this.bellMenuOpen.set(false);
    this.auth.signOut();
    void this.router.navigate(['/signin']);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.drawerOpen.set(false);
    this.userMenuOpen.set(false);
    this.bellMenuOpen.set(false);
  }

  /** '/supervisor/tasks?x=1' → '/supervisor/tasks' */
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
