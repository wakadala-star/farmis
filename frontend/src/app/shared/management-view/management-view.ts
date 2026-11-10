import { Component, Input } from '@angular/core';

/** Small context tile above the message lists. */
export interface MetaTile {
  icon: string;
  tone: 'green' | 'blue' | 'amber';
  value: string;
  label: string;
  hint: string;
}

/** An alert raised by the system for the owner to notice. */
export interface PageAlert {
  icon: string;
  tone: 'warn' | 'info' | 'ok';
  title: string;
  text: string;
  time: string;
}

/** A data-entry update submitted by a supervisor. */
export interface PageUpdate {
  when: string;
  author: string;
  tag: string;
  text: string;
}

/** Everything an owner-side management page displays. */
export interface ManagementPage {
  note: string;
  meta: MetaTile[];
  alerts: PageAlert[];
  updates: PageUpdate[];
}

/**
 * Shared layout for the owner-side Crop and Livestock management
 * pages: a supervisor-context note, three meta tiles, a "needs
 * attention" alert list and a feed of recent supervisor updates.
 *
 * Read-only by design — all data entry happens on the supervisor
 * side; mock data lives in the page components and will be replaced
 * by API responses when the backend is attached.
 */
@Component({
  selector: 'app-management-view',
  templateUrl: './management-view.html',
})
export class ManagementView {
  @Input({ required: true }) page!: ManagementPage;
}
