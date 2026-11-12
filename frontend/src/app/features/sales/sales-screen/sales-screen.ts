import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  CustomerRec,
  FarmApiService,
  SaleDetail,
  SalesFilter,
  SalesListRow,
} from '../../../core/farm-api.service';
import { fmtDay, fmtMoney } from '../../../core/farm-data.service';
import { RecordSale } from '../../../shared/record-sale/record-sale';

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile Money',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  paid: 'Paid',
  pending: 'Pending',
  partial: 'Partial',
};

const STATUS_CHIPS: Record<string, string> = {
  paid: 'chip--green',
  pending: 'chip--amber',
  partial: 'chip--blue',
};

/**
 * Sales & Customers (Phase 3A) — two tabs on one screen, shared by the
 * owner (/sales) and supervisors (/supervisor/sales):
 *
 *   Sales      the full list with date / status / method filters; a row
 *              expands to its detail (line items, seller, and the stock
 *              movements the sale produced). Record Sale opens the
 *              shared modal — the dashboard's Quick Action works too.
 *   Customers  the customer book: add, edit and delete contacts —
 *              deleting is refused (409 from the API) while sales still
 *              reference the customer.
 */
@Component({
  selector: 'app-sales-screen',
  imports: [ReactiveFormsModule, RecordSale],
  templateUrl: './sales-screen.html',
})
export class SalesScreen {
  private readonly api = inject(FarmApiService);

  readonly fmtDay = fmtDay;
  readonly fmtMoney = fmtMoney;

  /* ---------------- tabs ---------------- */
  readonly tab = signal<'sales' | 'customers'>('sales');

  /* ---------------- sales filters ---------------- */
  readonly dateFrom = signal('');
  readonly dateTo = signal('');
  readonly status = signal('');
  readonly method = signal('');

  /* ---------------- sales list ---------------- */
  readonly sales = signal<SalesListRow[]>([]);
  readonly salesCount = signal(0);
  readonly salesLoading = signal(true);
  readonly salesError = signal('');

  /* ---------------- expandable detail ---------------- */
  readonly expandedId = signal<string | null>(null);
  readonly detail = signal<SaleDetail | null>(null);
  readonly detailLoading = signal(false);
  readonly detailError = signal('');

  /* ---------------- customers ---------------- */
  readonly customers = signal<CustomerRec[]>([]);
  readonly customersLoading = signal(true);
  readonly customersError = signal('');

  /* ---------------- customer form ---------------- */
  readonly notice = signal('');
  readonly error = signal('');
  readonly submitting = signal(false);
  /** Customer id whose removal is in flight (disables that button). */
  readonly removingId = signal('');
  readonly editingId = signal<string | null>(null);

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    phone: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    address: new FormControl('', { nonNullable: true }),
  });

  constructor() {
    void this.loadSales();
    void this.loadCustomers();
  }

  /* ---------------- record sale (shared modal) ---------------- */

  readonly saleOpen = signal(false);

  closeSale(): void {
    this.saleOpen.set(false);
  }

  /** Record Sale succeeded → close the modal, confirm via the top
   *  notice and refresh both tabs (the sale may add a customer). */
  async onSaleRecorded(message: string): Promise<void> {
    this.saleOpen.set(false);
    this.notice.set(message);
    this.error.set('');
    await this.loadSales();
    await this.loadCustomers();
  }

  /* ---------------- sales list ---------------- */

  private filter(): SalesFilter {
    return {
      dateFrom: this.dateFrom() || undefined,
      dateTo: this.dateTo() || undefined,
      status: this.status() || undefined,
      method: this.method() || undefined,
    };
  }

  async loadSales(): Promise<void> {
    this.salesLoading.set(true);
    this.salesError.set('');
    const res = await this.api.listSales(this.filter());
    this.salesLoading.set(false);
    if (!res.ok) {
      this.salesError.set(res.message);
      return;
    }
    this.sales.set(res.sales);
    this.salesCount.set(res.count);
  }

  retrySales(): void {
    void this.loadSales();
  }

  onDateFrom(ev: Event): void {
    this.dateFrom.set((ev.target as HTMLInputElement).value);
    void this.loadSales();
  }

  onDateTo(ev: Event): void {
    this.dateTo.set((ev.target as HTMLInputElement).value);
    void this.loadSales();
  }

  onStatus(ev: Event): void {
    this.status.set((ev.target as HTMLSelectElement).value);
    void this.loadSales();
  }

  onMethod(ev: Event): void {
    this.method.set((ev.target as HTMLSelectElement).value);
    void this.loadSales();
  }

  resetFilters(): void {
    this.dateFrom.set('');
    this.dateTo.set('');
    this.status.set('');
    this.method.set('');
    void this.loadSales();
  }

  /* ---------------- sale detail ---------------- */

  async toggleDetail(sale: SalesListRow): Promise<void> {
    if (this.expandedId() === sale.id) {
      // Second tap on the open row → collapse.
      this.expandedId.set(null);
      this.detail.set(null);
      this.detailError.set('');
      return;
    }
    await this.openDetail(sale.id);
  }

  private async openDetail(id: string): Promise<void> {
    this.expandedId.set(id);
    this.detail.set(null);
    this.detailError.set('');
    this.detailLoading.set(true);
    const res = await this.api.fetchSaleDetail(id);
    this.detailLoading.set(false);
    if (!res.ok) {
      this.detailError.set(res.message);
      return;
    }
    this.detail.set(res.sale);
  }

  retryDetail(): void {
    const id = this.expandedId();
    if (id) void this.openDetail(id);
  }

  /* ---------------- helpers for the template ---------------- */

  methodLabel(method: string): string {
    return METHOD_LABELS[method] ?? method;
  }

  statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }

  statusChip(status: string): string {
    // Full class string: [class] replaces the element's classes.
    return `chip ${STATUS_CHIPS[status] ?? 'chip--neutral'}`;
  }

  /* ---------------- customers ---------------- */

  async loadCustomers(): Promise<void> {
    this.customersLoading.set(true);
    this.customersError.set('');
    const res = await this.api.listCustomers();
    this.customersLoading.set(false);
    if (!res.ok) {
      this.customersError.set(res.message);
      return;
    }
    this.customers.set(res.customers);
  }

  retryCustomers(): void {
    void this.loadCustomers();
  }

  switchTab(tab: 'sales' | 'customers'): void {
    this.tab.set(tab);
    this.notice.set('');
    this.error.set('');
  }

  invalid(control: 'name'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  async saveCustomer(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('A customer needs a name — phone, email and address are optional.');
      return;
    }
    if (this.submitting()) return;

    const { name, phone, email, address } = this.form.getRawValue();
    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
    };
    const editing = this.editingId();

    this.submitting.set(true);
    try {
      const res = editing
        ? await this.api.updateCustomer(editing, payload)
        : await this.api.createCustomer(payload);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.form.reset({ name: '', phone: '', email: '', address: '' });
      this.editingId.set(null);
      this.error.set('');
      this.notice.set(res.message);
      // A rename shows up in the sales list's customer column too.
      await this.loadCustomers();
      await this.loadSales();
    } finally {
      this.submitting.set(false);
    }
  }

  editCustomer(customer: CustomerRec): void {
    this.editingId.set(customer.id);
    this.form.setValue({
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
    });
    this.notice.set('');
    this.error.set('');
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', phone: '', email: '', address: '' });
    this.error.set('');
  }

  async removeCustomer(customer: CustomerRec): Promise<void> {
    if (this.removingId()) return;
    this.removingId.set(customer.id);
    this.notice.set('');
    this.error.set('');
    try {
      const res = await this.api.removeCustomer(customer.id);
      if (!res.ok) {
        // 409 lands here: the customer has sales on record.
        this.error.set(res.message);
        return;
      }
      if (this.editingId() === customer.id) this.cancelEdit();
      this.notice.set(res.message);
      await this.loadCustomers();
    } finally {
      this.removingId.set('');
    }
  }
}
