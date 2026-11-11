import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NgStyle } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActionResult, FarmApiService, SaleOptions } from '../../../core/farm-api.service';
import { ago, fmtCompact } from '../../../core/format';
import { dayKey, dayOffset, fmtDay, fmtMoney } from '../../../core/farm-data.service';
import { DEPT_LABELS } from '../../../core/models';
import {
  ChartPoint,
  PerformanceChart,
  monthLabel,
} from '../../../shared/performance-chart/performance-chart';

type ModalKind = 'crop' | 'animal' | 'sale' | 'expense';
type FeedKind = 'entry' | 'expense' | 'sale' | 'crop' | 'animal';

interface SaleLineForm {
  itemId: string; // '' = free-text line (never touches stock)
  description: string;
  quantity: string;
  unitPrice: string;
}

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const RECENT_ICONS: Record<FeedKind, string> = {
  entry: 'fa-solid fa-pen-to-square',
  expense: 'fa-solid fa-wallet',
  sale: 'fa-solid fa-cart-shopping',
  crop: 'fa-solid fa-seedling',
  animal: 'fa-solid fa-cow',
};

const RECENT_TONES: Record<FeedKind, string> = {
  entry: 'blue',
  expense: 'amber',
  sale: 'green',
  crop: 'green',
  animal: 'blue',
};

/**
 * Owner dashboard — the first screen of FARMIS, live against the
 * backend: six stat cards (registry totals, people, stock, sales),
 * the six-month sales chart, alerts, recent sales, upcoming tasks,
 * four working quick-action modals and the mixed activity feed.
 */
@Component({
  selector: 'app-owner-dashboard',
  imports: [PerformanceChart, NgStyle, ReactiveFormsModule],
  templateUrl: './owner-dashboard.html',
})
export class OwnerDashboard {
  private readonly api = inject(FarmApiService);

  /**
   * Promo card photo, injected inline so the relative URL resolves
   * against the document base href (domain root and /farmis/ both work).
   * Falls back to the CSS gradient when the file is not uploaded yet.
   */
  readonly promoImage = 'url(images/promo-farm.jpg)';

  readonly fmtDay = fmtDay;
  readonly fmtMoney = fmtMoney;

  readonly summary = this.api.ownerSummary;
  readonly loading = this.api.ownerSummaryLoading;
  readonly loadError = this.api.ownerSummaryError;

  /* ---------------- modal state ---------------- */

  readonly modal = signal<ModalKind | null>(null);
  readonly notice = signal('');
  readonly modalError = signal('');
  readonly submitting = signal(false);

  /* ---------------- record sale options ---------------- */

  readonly optionsState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly optionsError = signal('');
  readonly saleOptions = signal<SaleOptions | null>(null);
  readonly saleLines = signal<SaleLineForm[]>([
    { itemId: '', description: '', quantity: '1', unitPrice: '' },
  ]);
  readonly saleTotal = computed(() =>
    this.saleLines().reduce(
      (sum, l) => sum + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
      0,
    ),
  );

  /* ---------------- forms ---------------- */

  readonly cropForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(120),
      ],
    }),
    variety: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(120)],
    }),
    areaHa: new FormControl('', { nonNullable: true }),
    plantedDate: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  readonly animalForm = new FormGroup({
    species: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(80),
      ],
    }),
    breed: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(80)],
    }),
    quantity: new FormControl('', { nonNullable: true }),
    location: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(120)],
    }),
    acquiredDate: new FormControl('', { nonNullable: true }),
    notes: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  readonly expenseForm = new FormGroup({
    category: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(255),
      ],
    }),
    amount: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    date: new FormControl('', { nonNullable: true }),
    paymentMethod: new FormControl('cash', { nonNullable: true }),
  });

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

  /* ---------------- derived dashboard data ---------------- */

  readonly stats = computed(() => {
    const s = this.summary()?.stats;
    if (!s) return [];
    const mom = momTrend(s.monthSales, s.prevMonthSales);
    const ha = Number(s.cropHa.toFixed(1));
    const n = (v: number) => v.toLocaleString('en-US');
    return [
      {
        icon: 'fa-solid fa-cow',
        value: n(s.animals),
        label: 'Total Animals',
        tone: 'green',
        trend: null as string | null,
        down: false,
      },
      {
        icon: 'fa-solid fa-seedling',
        value: `${s.cropPlots} plots · ${ha} ha`,
        label: 'Active Crops',
        tone: 'amber',
        trend: null,
        down: false,
      },
      {
        icon: 'fa-solid fa-users',
        value: n(s.employees),
        label: 'Employees',
        tone: 'purple',
        trend: null,
        down: false,
      },
      {
        icon: 'fa-solid fa-cart-shopping',
        value: fmtCompact(s.monthSales),
        label: 'Sales This Month',
        tone: 'blue',
        trend: mom?.text ?? null,
        down: mom?.down ?? false,
      },
      {
        icon: 'fa-solid fa-warehouse',
        value: n(s.lowStock),
        label: 'Low Stock',
        tone: 'red',
        trend: null,
        down: false,
      },
      {
        icon: 'fa-solid fa-clipboard-check',
        value: n(s.pendingApprovals),
        label: 'Pending Approvals',
        tone: 'green',
        trend: null,
        down: false,
      },
    ];
  });

  readonly chartSeries = computed<ChartPoint[]>(
    () =>
      this.summary()?.series.map((p) => ({
        label: monthLabel(p.month),
        value: p.value,
      })) ?? [],
  );

  readonly alerts = computed(() => {
    const s = this.summary();
    if (!s) return [];
    const rows = s.lowStock.map((row) => ({
      key: `stock-${row.name}`,
      icon: 'fa-solid fa-warehouse',
      tone: 'warn',
      title: row.name,
      text: `Only ${row.qty} ${row.unit} left — reorder at ${row.reorderLevel}`,
      time: ago(row.updatedAt),
    }));
    if (!rows.length) {
      rows.push({
        key: 'stock-ok',
        icon: 'fa-solid fa-circle-check',
        tone: 'ok',
        title: 'Stock levels healthy',
        text: 'Nothing is at or below its reorder level.',
        time: 'Now',
      });
    }
    return rows;
  });

  readonly salesRows = computed(() =>
    (this.summary()?.sales ?? []).map((sale) => ({
      id: sale.id,
      date: fmtDay(sale.date),
      customer: sale.customer,
      item: sale.item,
      amount: fmtMoney(sale.amount),
    })),
  );

  readonly activityRows = computed(() => {
    const today = dayKey();
    const tomorrow = dayOffset(1);
    return (this.summary()?.activities ?? []).map((task) => {
      const overdue = task.due < today;
      const chip = overdue
        ? 'Overdue'
        : task.due === today
          ? 'Today'
          : task.due === tomorrow
            ? 'Tomorrow'
            : fmtDay(task.due);
      const chipTone = overdue
        ? 'overdue'
        : task.due === today
          ? 'today'
          : task.due === tomorrow
            ? 'tomorrow'
            : 'neutral';
      const d = new Date(`${task.due}T00:00:00`);
      return {
        id: task.id,
        day: String(d.getDate()),
        month: MONTHS_SHORT[d.getMonth()] ?? '',
        title: task.title,
        sub: `${task.assignee} · ${task.dept ? DEPT_LABELS[task.dept] : 'Farm-wide'}`,
        chip,
        chipTone,
      };
    });
  });

  readonly quickActions: { icon: string; label: string; kind: ModalKind }[] = [
    { icon: 'fa-solid fa-seedling', label: 'Add Crop', kind: 'crop' },
    { icon: 'fa-solid fa-cow', label: 'Add Animal', kind: 'animal' },
    { icon: 'fa-solid fa-cart-shopping', label: 'Record Sale', kind: 'sale' },
    { icon: 'fa-solid fa-wallet', label: 'Add Expense', kind: 'expense' },
  ];

  readonly recentRows = computed(() =>
    (this.summary()?.recent ?? []).map((row, i) => ({
      id: `${row.kind}-${row.at}-${i}`,
      icon: RECENT_ICONS[row.kind],
      tone: RECENT_TONES[row.kind],
      title: row.sub ? `${row.title} · ${row.sub}` : row.title,
      time: ago(row.at),
    })),
  );

  constructor() {
    void this.api.ensure('ownerSummary');
  }

  retry(): void {
    void this.api.ensure('ownerSummary');
  }

  /* ---------------- modals ---------------- */

  openModal(kind: ModalKind): void {
    this.notice.set('');
    this.modalError.set('');
    if (kind === 'crop') {
      this.cropForm.reset({
        name: '',
        variety: '',
        areaHa: '',
        plantedDate: '',
        notes: '',
      });
    } else if (kind === 'animal') {
      this.animalForm.reset({
        species: '',
        breed: '',
        quantity: '',
        location: '',
        acquiredDate: '',
        notes: '',
      });
    } else if (kind === 'expense') {
      this.expenseForm.reset({
        category: '',
        description: '',
        amount: '',
        date: '',
        paymentMethod: 'cash',
      });
    } else {
      this.saleForm.reset({
        customerId: '',
        customerName: '',
        paymentMethod: 'cash',
        paymentStatus: 'paid',
        notes: '',
      });
      this.saleLines.set([{ itemId: '', description: '', quantity: '1', unitPrice: '' }]);
      void this.loadSaleOptions();
    }
    this.modal.set(kind);
  }

  closeModal(): void {
    if (this.submitting()) return;
    this.modal.set(null);
    this.modalError.set('');
  }

  dismissNotice(): void {
    this.notice.set('');
  }

  modalTitle(kind: ModalKind): string {
    return kind === 'crop'
      ? 'Add Crop'
      : kind === 'animal'
        ? 'Add Animal'
        : kind === 'sale'
          ? 'Record Sale'
          : 'Add Expense';
  }

  modalIcon(kind: ModalKind): string {
    return kind === 'crop'
      ? 'fa-solid fa-seedling'
      : kind === 'animal'
        ? 'fa-solid fa-cow'
        : kind === 'sale'
          ? 'fa-solid fa-cart-shopping'
          : 'fa-solid fa-wallet';
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeModal();
  }

  /** Inline field error after touch/dirty (any modal form). */
  fieldInvalid(form: FormGroup, name: string): boolean {
    const control = (form.controls as unknown as Record<string, FormControl>)[name];
    return !!control && control.invalid && (control.touched || control.dirty);
  }

  async submitModal(): Promise<void> {
    const kind = this.modal();
    if (!kind || this.submitting()) return;

    let run: (() => Promise<ActionResult>) | null = null;

    if (kind === 'crop') {
      if (this.cropForm.invalid) {
        this.cropForm.markAllAsTouched();
        this.modalError.set('Enter a crop name (2–120 characters).');
        return;
      }
      const v = this.cropForm.getRawValue();
      const areaRaw = v.areaHa.trim();
      let areaHa: number | null = null;
      if (areaRaw !== '') {
        areaHa = Number(areaRaw);
        if (!Number.isFinite(areaHa) || areaHa < 0) {
          this.modalError.set('Area must be 0 or more hectares.');
          return;
        }
      }
      const payload = {
        name: v.name.trim(),
        variety: v.variety.trim(),
        areaHa,
        plantedDate: v.plantedDate,
        notes: v.notes.trim(),
      };
      run = () => this.api.addCrop(payload);
    } else if (kind === 'animal') {
      if (this.animalForm.invalid) {
        this.animalForm.markAllAsTouched();
        this.modalError.set('Enter a species (2–80 characters).');
        return;
      }
      const v = this.animalForm.getRawValue();
      const qtyRaw = v.quantity.trim();
      let quantity: number | undefined;
      if (qtyRaw !== '') {
        quantity = Number(qtyRaw);
        if (!Number.isInteger(quantity) || quantity < 0) {
          this.modalError.set('Quantity must be 0 or more.');
          return;
        }
      }
      const payload = {
        species: v.species.trim(),
        breed: v.breed.trim(),
        quantity,
        location: v.location.trim(),
        acquiredDate: v.acquiredDate,
        notes: v.notes.trim(),
      };
      run = () => this.api.addAnimal(payload);
    } else if (kind === 'expense') {
      if (this.expenseForm.invalid) {
        this.expenseForm.markAllAsTouched();
        this.modalError.set(
          'Choose a category, describe the expense and enter an amount.',
        );
        return;
      }
      const v = this.expenseForm.getRawValue();
      const amount = Number(v.amount.trim());
      if (!Number.isFinite(amount) || amount <= 0) {
        this.modalError.set('Amount must be greater than 0.');
        return;
      }
      const payload = {
        category: v.category,
        description: v.description.trim(),
        amount,
        date: v.date,
        paymentMethod: v.paymentMethod,
      };
      run = () => this.api.addExpense(payload);
    } else {
      /* ---- Record Sale ---- */
      const v = this.saleForm.getRawValue();
      const lines = this.saleLines();
      for (const [i, line] of lines.entries()) {
        const qty = Number(line.quantity);
        const price = Number(line.unitPrice);
        if (!Number.isFinite(qty) || qty <= 0) {
          this.modalError.set(`Line ${i + 1}: quantity must be greater than 0.`);
          return;
        }
        if (!Number.isFinite(price) || price < 0) {
          this.modalError.set(`Line ${i + 1}: price cannot be negative.`);
          return;
        }
        if (!line.description.trim() && !line.itemId) {
          this.modalError.set(
            `Line ${i + 1}: enter an item description or pick an inventory item.`,
          );
          return;
        }
      }
      if (v.customerId === 'new' && v.customerName.trim().length < 2) {
        this.modalError.set('Enter the new customer’s name.');
        return;
      }
      const payload = {
        customerId:
          v.customerId && v.customerId !== 'new' ? v.customerId : undefined,
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
      run = () => this.api.recordSale(payload);
    }

    if (!run) return;
    this.submitting.set(true);
    try {
      const res = await run();
      if (!res.ok) {
        this.modalError.set(res.message);
        return;
      }
      this.modal.set(null);
      this.modalError.set('');
      this.notice.set(res.message);
    } finally {
      this.submitting.set(false);
    }
  }

  /* ---------------- record sale helpers ---------------- */

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

  retrySaleOptions(): void {
    void this.loadSaleOptions();
  }

  private async loadSaleOptions(): Promise<void> {
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
}

/** Month-over-month change, or null when there is nothing to compare. */
function momTrend(now: number, prev: number): { text: string; down: boolean } | null {
  if (prev <= 0 || now === prev) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return null;
  return { text: `${Math.abs(pct)}%`, down: pct < 0 };
}
