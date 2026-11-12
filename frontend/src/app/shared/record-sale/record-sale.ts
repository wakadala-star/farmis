import { Component, HostListener, computed, inject, output, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FarmApiService, SaleOptions } from '../../core/farm-api.service';
import { fmtMoney } from '../../core/farm-data.service';

interface SaleLineForm {
  itemId: string; // '' = free-text line (never touches stock)
  description: string;
  quantity: string;
  unitPrice: string;
}

/**
 * Record Sale modal — one implementation shared by the owner
 * dashboard's Quick Actions and the Sales & Customers screen (owner +
 * supervisor, Phase 3A+). Owns the form, the customer/stock pickers
 * and submission; emits `recorded` with the success message so the
 * host screen can refresh its own lists, `close` to dismiss.
 */
@Component({
  selector: 'app-record-sale',
  imports: [ReactiveFormsModule],
  templateUrl: './record-sale.html',
})
export class RecordSale {
  private readonly api = inject(FarmApiService);

  readonly close = output<void>();
  readonly recorded = output<string>();

  readonly fmtMoney = fmtMoney;
  readonly submitting = signal(false);
  readonly error = signal('');

  /* ---------------- pickers ---------------- */

  readonly optionsState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly optionsError = signal('');
  readonly saleOptions = signal<SaleOptions | null>(null);

  /* ---------------- lines ---------------- */

  readonly saleLines = signal<SaleLineForm[]>([
    { itemId: '', description: '', quantity: '1', unitPrice: '' },
  ]);
  readonly saleTotal = computed(() =>
    this.saleLines().reduce(
      (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
      0,
    ),
  );

  readonly saleForm = new FormGroup({
    customerId: new FormControl('', { nonNullable: true }), // '' | 'new' | id
    customerName: new FormControl('', { nonNullable: true }),
    paymentMethod: new FormControl('cash', { nonNullable: true }),
    paymentStatus: new FormControl('paid', { nonNullable: true }),
    notes: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  constructor() {
    void this.loadOptions();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.dismiss();
  }

  dismiss(): void {
    if (this.submitting()) return;
    this.close.emit();
  }

  /** Inline field error after touch/dirty. */
  fieldInvalid(form: FormGroup, name: string): boolean {
    const control = (form.controls as unknown as Record<string, FormControl>)[name];
    return !!control && control.invalid && (control.touched || control.dirty);
  }

  /* ---------------- pickers ---------------- */

  retrySaleOptions(): void {
    void this.loadOptions();
  }

  private async loadOptions(): Promise<void> {
    this.optionsState.set('loading');
    const res = await this.api.fetchSaleOptions();
    if (!res.ok || !res.options) {
      this.optionsError.set(res.message || 'Could not load sale options.');
      this.optionsState.set('error');
      return;
    }
    this.saleOptions.set(res.options);
    this.optionsState.set('ready');
  }

  /* ---------------- line helpers ---------------- */

  addSaleLine(): void {
    if (this.saleLines().length >= 20) return;
    this.saleLines.update((lines) => [
      ...lines,
      { itemId: '', description: '', quantity: '1', unitPrice: '' },
    ]);
  }

  removeSaleLine(index: number): void {
    if (this.saleLines().length <= 1) return;
    this.saleLines.update((lines) => lines.filter((_, i) => i !== index));
  }

  setSaleLine(index: number, patch: Partial<SaleLineForm>): void {
    this.saleLines.update((lines) =>
      lines.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  /** Picking an inventory item pre-fills its name as the description. */
  onSaleItemChange(index: number, itemId: string): void {
    const line = this.saleLines()[index];
    const item = this.saleOptions()?.items.find((i) => i.id === itemId);
    const patch: Partial<SaleLineForm> = { itemId };
    if (item && !line.description.trim()) patch.description = item.name;
    this.setSaleLine(index, patch);
  }

  /** Stock hint under a sale line (free-text lines never touch stock). */
  lineStockHint(index: number): string {
    const line = this.saleLines()[index];
    if (!line.itemId) return 'Free-text line — stock untouched';
    const item = this.saleOptions()?.items.find((i) => i.id === line.itemId);
    return item ? `In stock: ${item.qty} ${item.unit}` : '';
  }

  /* ---------------- submit ---------------- */

  async submit(): Promise<void> {
    if (this.submitting()) return;

    const v = this.saleForm.getRawValue();
    const lines = this.saleLines();
    for (const [i, line] of lines.entries()) {
      const qty = Number(line.quantity);
      const price = Number(line.unitPrice);
      if (!Number.isFinite(qty) || qty <= 0) {
        this.error.set(`Line ${i + 1}: quantity must be greater than 0.`);
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        this.error.set(`Line ${i + 1}: price cannot be negative.`);
        return;
      }
      if (!line.description.trim() && !line.itemId) {
        this.error.set(
          `Line ${i + 1}: enter an item description or pick an inventory item.`,
        );
        return;
      }
    }
    if (v.customerId === 'new' && v.customerName.trim().length < 2) {
      this.error.set('Enter the new customer’s name.');
      return;
    }

    const payload = {
      customerId: v.customerId && v.customerId !== 'new' ? v.customerId : undefined,
      customerName: v.customerId === 'new' ? v.customerName.trim() : undefined,
      lines: lines.map((l) => ({
        itemId: l.itemId || undefined,
        description: l.description.trim(),
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
      })),
      paymentMethod: v.paymentMethod,
      paymentStatus: v.paymentStatus,
      notes: v.notes.trim(),
    };

    this.submitting.set(true);
    try {
      const res = await this.api.recordSale(payload);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.recorded.emit(res.message);
    } finally {
      this.submitting.set(false);
    }
  }
}
