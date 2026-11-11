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

/** One row of the optional registry list (crops / livestock). */
export interface RegistryRow {
  id: string;
  title: string;
  sub: string;
  meta: string;
}

/** Optional registry section shown under the alerts + updates grid. */
export interface RegistryList {
  title: string;
  icon: string;
  rows: RegistryRow[];
  empty: string;
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
 * attention" alert list, a feed of recent supervisor updates and
 * (optionally) the page's registry list.
 *
 * Data arrives from the API through the page components; this
 * component only renders what it is given.
 */
@Component({
  selector: 'app-management-view',
  templateUrl: './management-view.html',
})
export class ManagementView {
  @Input({ required: true }) page!: ManagementPage;
  @Input() list: RegistryList | null = null;
}
