import { Component } from '@angular/core';
import { ManagementPage, ManagementView } from '../../../shared/management-view/management-view';

/**
 * Owner view of Crop Management.
 *
 * Supervisors do the field data entry; this screen only surfaces
 * their latest updates and anything that needs the owner's attention.
 * All data is mock until the backend is attached.
 */
@Component({
  selector: 'app-owner-crops',
  imports: [ManagementView],
  template: '<app-management-view [page]="page" />',
})
export class OwnerCrops {
  readonly page: ManagementPage = {
    note: 'Supervisors record all field data — their latest entries and anything needing your attention appear here.',
    meta: [
      {
        icon: 'fa-solid fa-triangle-exclamation',
        tone: 'amber',
        value: '2',
        label: 'Open alerts',
        hint: '1 needs action this week',
      },
      {
        icon: 'fa-regular fa-clock',
        tone: 'green',
        value: '2h ago',
        label: 'Last supervisor entry',
        hint: 'Grace N. · Field B',
      },
      {
        icon: 'fa-solid fa-list-check',
        tone: 'blue',
        value: '4',
        label: 'Entries this week',
        hint: 'Weeding · Planting · Input',
      },
    ],
    alerts: [
      {
        icon: 'fa-solid fa-bug',
        tone: 'warn',
        title: 'Fall armyworm risk',
        text: 'Scout Field B this week — regional advisory issued',
        time: '1d ago',
      },
      {
        icon: 'fa-solid fa-seedling',
        tone: 'warn',
        title: 'Bean seeds running low',
        text: 'Only 5 kg left — reorder before the next planting',
        time: '3h ago',
      },
      {
        icon: 'fa-regular fa-calendar',
        tone: 'info',
        title: 'Maize harvest window',
        text: 'Plot A ready in about 7 days — start arranging transport',
        time: '2d ago',
      },
    ],
    updates: [
      {
        when: 'Today · 09:40',
        author: 'Grace N.',
        tag: 'Progress',
        text: 'Weeding completed — Field B (2 ha maize)',
      },
      {
        when: 'Yesterday',
        author: 'Moses K.',
        tag: 'Planting',
        text: 'Planted 5 kg maize seeds — Field A',
      },
      {
        when: 'Nov 6',
        author: 'Grace N.',
        tag: 'Input',
        text: 'Fertilizer applied — Plot C (20 kg NPK)',
      },
      {
        when: 'Nov 5',
        author: 'Moses K.',
        tag: 'Check',
        text: 'Soil moisture good — no irrigation needed today',
      },
    ],
  };
}
