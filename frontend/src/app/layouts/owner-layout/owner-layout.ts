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
import { ROLE_LABELS } from '../../core/models';
import { Brand } from '../../shared/brand/brand';

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

/**
 * Owner-side application shell: desktop sidebar, sticky topbar,
 * mobile drawer + bottom navigation.
 *
 * Dashboard, Crop Management and Livestock Management are wired to
 * real screens; every other module carries a "Soon" badge and stays
 * inert until its screen is built. Sign out is fully wired to the
 * mock auth service.
 */
@Component({
  selector: 'app-owner-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Brand],
  templateUrl: './owner-layout.html',
})
export class OwnerLayout {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly drawerOpen = signal(false);
  readonly collapsed = signal(false);
  readonly userMenuOpen = signal(false);

  readonly roleLabel = computed(() => ROLE_LABELS[this.auth.role() ?? 'owner']);

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
    { label: 'Inventory & Stores', icon: 'fa-solid fa-warehouse' },
    { label: 'Workers & HR', icon: 'fa-solid fa-users' },
    { label: 'Procurement', icon: 'fa-solid fa-basket-shopping' },
    { label: 'Sales & Customers', icon: 'fa-solid fa-cart-shopping' },
    { label: 'Finance', icon: 'fa-solid fa-wallet' },
    { label: 'Farm Activities', icon: 'fa-solid fa-calendar-check' },
    { label: 'Reports', icon: 'fa-solid fa-chart-column' },
    { label: 'Settings', icon: 'fa-solid fa-gear' },
  ];

  constructor() {
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
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  signOut(): void {
    this.userMenuOpen.set(false);
    this.drawerOpen.set(false);
    this.auth.signOut();
    void this.router.navigate(['/signin']);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.drawerOpen.set(false);
    this.userMenuOpen.set(false);
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
