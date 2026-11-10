import { Component } from '@angular/core';
import { ManagementPage, ManagementView } from '../../../shared/management-view/management-view';

/**
 * Owner view of Livestock Management.
 *
 * Supervisors do the livestock data entry; this screen only surfaces
 * their latest updates and anything that needs the owner's attention.
 * All data is mock until the backend is attached.
 */
@Component({
  selector: 'app-owner-livestock',
  imports: [ManagementView],
  template: '<app-management-view [page]="page" />',
})
export class OwnerLivestock {
  readonly page: ManagementPage = {
    note: 'Supervisors record all livestock data — counts, health and stock updates appear here.',
    meta: [
      {
        icon: 'fa-solid fa-triangle-exclamation',
        tone: 'amber',
        value: '2',
        label: 'Open alerts',
        hint: 'Feed and medicine low',
      },
      {
        icon: 'fa-regular fa-clock',
        tone: 'green',
        value: '2h ago',
        label: 'Last supervisor entry',
        hint: 'Sam W. · Poultry Unit',
      },
      {
        icon: 'fa-solid fa-list-check',
        tone: 'blue',
        value: '5',
        label: 'Entries this week',
        hint: 'Counts · Health · Stock',
      },
    ],
    alerts: [
      {
        icon: 'fa-solid fa-triangle-exclamation',
        tone: 'warn',
        title: 'Poultry feed low',
        text: 'Only 10 bags left — reorder this week',
        time: '2h ago',
      },
      {
        icon: 'fa-solid fa-syringe',
        tone: 'warn',
        title: 'Medicine (Birds) running out',
        text: 'Only 5 bottles left — restock the dispensary',
        time: '3h ago',
      },
      {
        icon: 'fa-regular fa-calendar',
        tone: 'info',
        title: 'Vaccination due Wednesday',
        text: 'Newcastle vaccine — flock A and flock B',
        time: '1d ago',
      },
    ],
    updates: [
      {
        when: 'Today · 08:15',
        author: 'Sam W.',
        tag: 'Count',
        text: 'Poultry count entered: 2,500 birds',
      },
      {
        when: 'Yesterday',
        author: 'Amina K.',
        tag: 'Health',
        text: 'Cattle dewormed — Dairy Unit (120 head)',
      },
      {
        when: 'Nov 6',
        author: 'Sam W.',
        tag: 'Stock',
        text: 'New chicks arrived: 300 — Broiler Unit',
      },
      {
        when: 'Nov 5',
        author: 'Amina K.',
        tag: 'Production',
        text: 'Egg collection: 180 trays this week',
      },
    ],
  };
}
