import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ROLE_LABELS } from '../../core/models';
import { Brand } from '../../shared/brand/brand';

interface NavItem {
  label: string;
  icon: string;
  link?: string;
}

/**
 * Owner-side application shell: desktop sidebar, sticky topbar,
 * mobile drawer + bottom navigation.
 *
 * Every module except Dashboard carries a "Soon" badge and stays
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

  readonly navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'fa-solid fa-house', link: '/dashboard' },
    { label: 'Crop Management', icon: 'fa-solid fa-seedling' },
    { label: 'Livestock Management', icon: 'fa-solid fa-cow' },
    { label: 'Inventory & Stores', icon: 'fa-solid fa-warehouse' },
    { label: 'Workers & HR', icon: 'fa-solid fa-users' },
    { label: 'Procurement', icon: 'fa-solid fa-basket-shopping' },
    { label: 'Sales & Customers', icon: 'fa-solid fa-cart-shopping' },
    { label: 'Finance', icon: 'fa-solid fa-wallet' },
    { label: 'Farm Activities', icon: 'fa-solid fa-calendar-check' },
    { label: 'Reports', icon: 'fa-solid fa-chart-column' },
    { label: 'Settings', icon: 'fa-solid fa-gear' },
  ];

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

  private isWide(): boolean {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 992px)').matches
    );
  }
}
