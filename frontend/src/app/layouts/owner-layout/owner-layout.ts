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
import { ROLE_LABELS } from '../../core/models';
import { Brand } from '../../shared/brand/brand';
import { ProfileMenu } from '../../shared/profile-menu/profile-menu';

interface NavItem {
  label: string;
  icon: string;
  link?: string;
}

/** Topbar heading + subtitle for the active owner page. */
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
 * Owner-side application shell: desktop sidebar, sticky topbar,
 * mobile drawer + bottom navigation.
 *
 * Dashboard, Crop Management, Livestock Management and Workers & HR
 * are wired to real screens; every other module carries a "Soon"
 * badge and stays inert until its screen is built. Sign out is fully
 * wired to the auth service.
 */
@Component({
  selector: 'app-owner-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Brand, ProfileMenu],
  templateUrl: './owner-layout.html',
})
export class OwnerLayout {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly api = inject(FarmApiService);

  readonly drawerOpen = signal(false);
  readonly collapsed = signal(false);
  readonly userMenuOpen = signal(false);
  readonly bellMenuOpen = signal(false);

  readonly roleLabel = computed(() => ROLE_LABELS[this.auth.role() ?? 'owner']);

  /** Human date for the topbar pill, e.g. 'Fri, Nov 13, 2026'. */
  readonly todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  /** Badge on the bell: the work waiting on the owner personally —
   *  credit requests to decide plus low-stock items to reorder. */
  readonly pendingCount = computed(() => {
    const summary = this.api.ownerSummary();
    if (!summary) return 0;
    return summary.pending.credit + summary.stats.lowStock;
  });

  /** System messages behind the badge, each linking to the page that
   *  clears it (Phase 4). Sums to pendingCount(). */
  readonly messages = computed<BellMessage[]>(() => {
    const summary = this.api.ownerSummary();
    if (!summary) return [];
    const list: BellMessage[] = [];
    const credits = summary.pending.credit;
    if (credits > 0) {
      list.push({
        text:
          credits === 1
            ? '1 credit request awaiting decision'
            : `${credits} credit requests awaiting decision`,
        link: '/finance',
        icon: 'fa-solid fa-money-bill-transfer',
      });
    }
    const lowStock = summary.stats.lowStock;
    if (lowStock > 0) {
      list.push({
        text:
          lowStock === 1
            ? '1 low-stock item needs reordering'
            : `${lowStock} low-stock items need reordering`,
        link: '/inventory',
        icon: 'fa-solid fa-triangle-exclamation',
      });
    }
    return list;
  });

  /** Active top-level path, kept in sync with the router. */
  private readonly path = signal('');

  /** Heading + subtitle shown in the topbar for the active page. */
  readonly topbar = computed<PageMeta>(() => {
    const name = this.auth.fullName();
    switch (this.path()) {
      case '/crops':
        return {
          title: 'Crop Management',
          sub: `Welcome back, ${name}! Field updates and alerts from your supervisors.`,
          mob: 'Crop updates & alerts',
        };
      case '/livestock':
        return {
          title: 'Livestock Management',
          sub: `Welcome back, ${name}! Livestock updates and alerts from your supervisors.`,
          mob: 'Livestock updates & alerts',
        };
      case '/inventory':
        return {
          title: 'Inventory & Stores',
          sub: `Welcome back, ${name}! Track items, movements and reorder alerts.`,
          mob: 'Stock & movements',
        };
      case '/workers':
        return {
          title: 'Workers & HR',
          sub: `Welcome back, ${name}! Recruit, review and manage your farm team.`,
          mob: 'Team & recruitment',
        };
      case '/sales':
        return {
          title: 'Sales & Customers',
          sub: `Welcome back, ${name}! Review every sale and manage the customer book.`,
          mob: 'Sales history & customers',
        };
      case '/finance':
        return {
          title: 'Finance',
          sub: `Welcome back, ${name}! Month totals, the expense ledger and credit decisions.`,
          mob: 'Expenses & month totals',
        };
      case '/activities':
        return {
          title: 'Farm Activities',
          sub: `Welcome back, ${name}! Plan work on the calendar and review every field entry.`,
          mob: 'Plan & field entries',
        };
      case '/reports':
        return {
          title: 'Reports',
          sub: `Welcome back, ${name}! Generate farm-wide reports and export them as CSV.`,
          mob: 'Reports & CSV export',
        };
      case '/settings':
        return {
          title: 'Settings',
          sub: `Welcome back, ${name}! Sign-in activity and system status.`,
          mob: 'Activity & system status',
        };
      default:
        return {
          title: 'Dashboard',
          sub: `Welcome back, ${name}! Here is your farm overview.`,
          mob: 'Farm overview at a glance',
        };
    }
  });

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'fa-solid fa-house', link: '/dashboard' },
    { label: 'Crop Management', icon: 'fa-solid fa-seedling', link: '/crops' },
    { label: 'Livestock Management', icon: 'fa-solid fa-cow', link: '/livestock' },
    { label: 'Inventory & Stores', icon: 'fa-solid fa-warehouse', link: '/inventory' },
    { label: 'Workers & HR', icon: 'fa-solid fa-users', link: '/workers' },
    { label: 'Procurement', icon: 'fa-solid fa-basket-shopping' },
    { label: 'Sales & Customers', icon: 'fa-solid fa-cart-shopping', link: '/sales' },
    { label: 'Finance', icon: 'fa-solid fa-wallet', link: '/finance' },
    { label: 'Farm Activities', icon: 'fa-solid fa-calendar-check', link: '/activities' },
    { label: 'Reports', icon: 'fa-solid fa-chart-column', link: '/reports' },
    { label: 'Settings', icon: 'fa-solid fa-gear', link: '/settings' },
  ];

  constructor() {
    // The bell badge reads the dashboard summary wherever the owner is.
    void this.api.ensure('ownerSummary');
    this.path.set(this.pathOf(this.router.url));
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

  /** '/crops?x=1' → '/crops' */
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
