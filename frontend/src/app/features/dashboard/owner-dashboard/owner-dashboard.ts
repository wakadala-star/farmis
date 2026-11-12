import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NgStyle } from '@angular/common';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { ActionResult, FarmApiService } from '../../../core/farm-api.service';
import { ago, fmtCompact } from '../../../core/format';
import { dayKey, dayOffset, fmtDay, fmtMoney } from '../../../core/farm-data.service';
import { DEPT_LABELS } from '../../../core/models';
import {
  ChartPoint,
  PerformanceChart,
  monthLabel,
} from '../../../shared/performance-chart/performance-chart';
import { RecordSale } from '../../../shared/record-sale/record-sale';

/** 'sale' is not part of the quick-action modal system — it opens the
 *  shared Record Sale component (dashboard + Sales screen alike). */
type ModalKind = 'crop' | 'animal' | 'expense';
type QuickKind = ModalKind | 'sale';
type FeedKind = 'entry' | 'expense' | 'sale' | 'crop' | 'animal';

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
 * three working quick-action modals, the shared Record Sale modal
 * and the mixed activity feed.
 */
@Component({
  selector: 'app-owner-dashboard',
  imports: [PerformanceChart, NgStyle, ReactiveFormsModule, RecordSale],
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

  /* ---------------- record sale (shared modal) ---------------- */

  readonly saleOpen = signal(false);

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

  readonly quickActions: { icon: string; label: string; kind: QuickKind }[] = [
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

  openModal(kind: QuickKind): void {
    this.notice.set('');
    this.modalError.set('');
    if (kind === 'sale') {
      this.saleOpen.set(true);
      return;
    }
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
    }
    this.modal.set(kind);
  }

  closeModal(): void {
    if (this.submitting()) return;
    this.modal.set(null);
    this.modalError.set('');
  }

  closeSale(): void {
    this.saleOpen.set(false);
  }

  /** The shared Record Sale modal succeeded → close it, confirm via the
   *  top notice and refresh the dashboard numbers (owner-only summary). */
  onSaleRecorded(message: string): void {
    this.saleOpen.set(false);
    this.notice.set(message);
    void this.api.ensure('ownerSummary', true);
  }

  dismissNotice(): void {
    this.notice.set('');
  }

  modalTitle(kind: ModalKind): string {
    return kind === 'crop'
      ? 'Add Crop'
      : kind === 'animal'
        ? 'Add Animal'
        : 'Add Expense';
  }

  modalIcon(kind: ModalKind): string {
    return kind === 'crop'
      ? 'fa-solid fa-seedling'
      : kind === 'animal'
        ? 'fa-solid fa-cow'
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

}

/** Month-over-month change, or null when there is nothing to compare. */
function momTrend(now: number, prev: number): { text: string; down: boolean } | null {
  if (prev <= 0 || now === prev) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return null;
  return { text: `${Math.abs(pct)}%`, down: pct < 0 };
}
