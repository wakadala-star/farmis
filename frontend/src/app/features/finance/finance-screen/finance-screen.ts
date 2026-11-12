import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ExpenseFilter,
  ExpenseRec,
  FarmApiService,
  MonthFinance,
} from '../../../core/farm-api.service';
import {
  TransactionRec,
  dayKey,
  fmtClock,
  fmtDay,
  fmtMoney,
  statusLabel,
  statusTone,
} from '../../../core/farm-data.service';

const CATEGORY_LABELS: Record<string, string> = {
  feed: 'Feed',
  medicine: 'Medicine',
  fuel: 'Fuel',
  salaries: 'Salaries',
  maintenance: 'Maintenance',
  equipment: 'Equipment',
  other: 'Other',
};

const CATEGORY_ICONS: Record<string, string> = {
  feed: 'fa-solid fa-wheat-awn',
  medicine: 'fa-solid fa-pills',
  fuel: 'fa-solid fa-gas-pump',
  salaries: 'fa-solid fa-money-bill',
  maintenance: 'fa-solid fa-screwdriver-wrench',
  equipment: 'fa-solid fa-tractor',
  other: 'fa-solid fa-receipt',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  other: 'Other',
};

/** '2026-11-12' — a date as the expense form stores it (local day). */
function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** '2026-11' — the browser's current month, the picker's default. */
function currentMonth(): string {
  return isoDay(new Date()).slice(0, 7);
}

/**
 * Finance (Phase 3C) — owner-only, three tabs:
 *
 *   Summary   month picker + sales / expenses / net for the month with
 *             the change vs last month, and the expense breakdown by
 *             category.
 *   Expenses  the full ledger: date / category / method / search
 *             filters, add, edit and hard-delete (any date).
 *   Credits   pending credit requests farm-wide — the owner can decide
 *             any of them (409 once a supervisor got there first) —
 *             plus the decided history.
 */
@Component({
  selector: 'app-finance-screen',
  imports: [ReactiveFormsModule],
  templateUrl: './finance-screen.html',
})
export class FinanceScreen {
  private readonly api = inject(FarmApiService);

  readonly fmtDay = fmtDay;
  readonly fmtClock = fmtClock;
  readonly fmtMoney = fmtMoney;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  /** Epoch ms → 'YYYY-MM-DD' (local day of the request). */
  readonly dayOf = (ms: number) => dayKey(new Date(ms));

  /* ---------------- tabs ---------------- */
  readonly tab = signal<'summary' | 'expenses' | 'credits'>('summary');

  /* ---------------- shared notices ---------------- */
  readonly notice = signal('');
  readonly error = signal('');

  /* ---------------- month summary ---------------- */
  readonly month = signal(currentMonth());
  readonly summary = signal<MonthFinance | null>(null);
  readonly summaryLoading = signal(true);
  readonly summaryError = signal('');

  /* ---------------- expenses (filtered list) ---------------- */
  readonly expenses = signal<ExpenseRec[]>([]);
  readonly expensesCount = signal(0);
  readonly expensesLoading = signal(true);
  readonly expensesError = signal('');

  /* ---------------- expense filters ---------------- */
  readonly filterFrom = signal('');
  readonly filterTo = signal('');
  readonly filterCategory = signal('');
  readonly filterMethod = signal('');
  readonly filterQ = signal('');

  /* ---------------- expense form ---------------- */
  readonly editingId = signal<string | null>(null);
  readonly expenseSubmitting = signal(false);
  readonly removingId = signal('');

  readonly expenseForm = new FormGroup({
    category: new FormControl('feed', {
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
    date: new FormControl(isoDay(new Date()), {
      nonNullable: true,
      validators: [Validators.required],
    }),
    paymentMethod: new FormControl('cash', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  /* ---------------- credit requests ---------------- */
  readonly credits = signal<TransactionRec[]>([]);
  readonly creditsLoading = signal(true);
  readonly creditsError = signal('');
  readonly decidingId = signal('');

  /** Requests waiting on a decision, any department. */
  readonly pending = computed(() =>
    this.credits().filter((tx) => tx.status === 'pending'),
  );

  /** Already decided, newest first. */
  readonly history = computed(() =>
    this.credits().filter((tx) => tx.status !== 'pending'),
  );

  readonly pendingValue = computed(() =>
    this.pending().reduce((sum, tx) => sum + tx.amount, 0),
  );

  readonly approvedValue = computed(() =>
    this.credits()
      .filter((tx) => tx.status === 'approved')
      .reduce((sum, tx) => sum + tx.amount, 0),
  );

  constructor() {
    void this.loadSummary();
    void this.loadExpenses();
    void this.loadCredits();
  }

  /* ---------------- tabs ---------------- */

  switchTab(tab: 'summary' | 'expenses' | 'credits'): void {
    this.tab.set(tab);
    this.notice.set('');
    this.error.set('');
  }

  /* ---------------- month summary ---------------- */

  async loadSummary(): Promise<void> {
    this.summaryLoading.set(true);
    this.summaryError.set('');
    const res = await this.api.financeSummary(this.month());
    this.summaryLoading.set(false);
    if (!res.ok || !res.data) {
      this.summaryError.set(res.message || 'Could not load the month summary.');
      return;
    }
    this.summary.set(res.data);
  }

  retrySummary(): void {
    void this.loadSummary();
  }

  onMonth(ev: Event): void {
    const value = (ev.target as HTMLInputElement).value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return;
    this.month.set(value);
    void this.loadSummary();
  }

  /** '▲ 12.3% vs last month' / '▼ 5.0% …' / an honest fallback. */
  changeLabel(cur: number, prev: number): string {
    if (prev <= 0) {
      return cur > 0 ? 'New — nothing last month' : 'No change vs last month';
    }
    const pct = ((cur - prev) / prev) * 100;
    const arrow = pct >= 0 ? '▲' : '▼';
    return `${arrow} ${Math.abs(pct).toFixed(1)}% vs last month`;
  }

  /** Share of the month's expenses this category holds (0–100). */
  sharePct(row: { total: number }): number {
    const total = this.summary()?.current.expenses ?? 0;
    if (total <= 0) return 0;
    return Math.round((row.total / total) * 100);
  }

  /* ---------------- expense filters ---------------- */

  private expenseFilter(): ExpenseFilter {
    return {
      dateFrom: this.filterFrom() || undefined,
      dateTo: this.filterTo() || undefined,
      category: this.filterCategory() || undefined,
      method: this.filterMethod() || undefined,
      q: this.filterQ().trim() || undefined,
    };
  }

  async loadExpenses(): Promise<void> {
    this.expensesLoading.set(true);
    this.expensesError.set('');
    const res = await this.api.listExpenses(this.expenseFilter());
    this.expensesLoading.set(false);
    if (!res.ok) {
      this.expensesError.set(res.message);
      return;
    }
    this.expenses.set(res.expenses);
    this.expensesCount.set(res.count);
  }

  retryExpenses(): void {
    void this.loadExpenses();
  }

  onFilterFrom(ev: Event): void {
    this.filterFrom.set((ev.target as HTMLInputElement).value);
    void this.loadExpenses();
  }

  onFilterTo(ev: Event): void {
    this.filterTo.set((ev.target as HTMLInputElement).value);
    void this.loadExpenses();
  }

  onFilterCategory(ev: Event): void {
    this.filterCategory.set((ev.target as HTMLSelectElement).value);
    void this.loadExpenses();
  }

  onFilterMethod(ev: Event): void {
    this.filterMethod.set((ev.target as HTMLSelectElement).value);
    void this.loadExpenses();
  }

  onFilterQ(ev: Event): void {
    this.filterQ.set((ev.target as HTMLInputElement).value);
    void this.loadExpenses();
  }

  resetExpenseFilters(): void {
    this.filterFrom.set('');
    this.filterTo.set('');
    this.filterCategory.set('');
    this.filterMethod.set('');
    this.filterQ.set('');
    void this.loadExpenses();
  }

  hasExpenseFilters(): boolean {
    return !!(
      this.filterFrom() ||
      this.filterTo() ||
      this.filterCategory() ||
      this.filterMethod() ||
      this.filterQ().trim()
    );
  }

  /* ---------------- expense form ---------------- */

  invalid(control: 'description' | 'amount' | 'date'): boolean {
    const field = this.expenseForm.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  private resetExpenseForm(): void {
    this.editingId.set(null);
    this.expenseForm.reset({
      category: 'feed',
      description: '',
      amount: '',
      date: isoDay(new Date()),
      paymentMethod: 'cash',
    });
    this.error.set('');
  }

  cancelExpenseEdit(): void {
    this.resetExpenseForm();
  }

  editExpense(expense: ExpenseRec): void {
    this.editingId.set(expense.id);
    this.expenseForm.setValue({
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      date: expense.date,
      paymentMethod: expense.method,
    });
    this.notice.set('');
    this.error.set('');
    this.tab.set('expenses');
  }

  async saveExpense(): Promise<void> {
    if (this.expenseForm.invalid) {
      this.expenseForm.markAllAsTouched();
      this.error.set('An expense needs a category, a description, an amount and a date.');
      return;
    }
    if (this.expenseSubmitting()) return;

    const v = this.expenseForm.getRawValue();
    const amount = Number(v.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.error.set('Amount must be greater than 0.');
      return;
    }

    const editing = this.editingId();
    const payload = {
      category: v.category,
      description: v.description.trim(),
      amount,
      date: v.date,
      paymentMethod: v.paymentMethod,
    };

    this.expenseSubmitting.set(true);
    try {
      const res = editing
        ? await this.api.updateExpense(editing, payload)
        : await this.api.addExpense(payload);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.resetExpenseForm();
      this.notice.set(res.message);
      await this.loadExpenses();
      // Money moved — the month tiles have to follow.
      await this.loadSummary();
    } finally {
      this.expenseSubmitting.set(false);
    }
  }

  async removeExpense(expense: ExpenseRec): Promise<void> {
    if (this.removingId()) return;
    this.removingId.set(expense.id);
    this.notice.set('');
    this.error.set('');
    try {
      const res = await this.api.removeExpense(expense.id);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      if (this.editingId() === expense.id) this.resetExpenseForm();
      this.notice.set(res.message);
      await this.loadExpenses();
      await this.loadSummary();
    } finally {
      this.removingId.set('');
    }
  }

  /* ---------------- credit requests ---------------- */

  async loadCredits(): Promise<void> {
    this.creditsLoading.set(true);
    this.creditsError.set('');
    const res = await this.api.listCreditRequests();
    this.creditsLoading.set(false);
    if (!res.ok) {
      this.creditsError.set(res.message);
      return;
    }
    this.credits.set(res.transactions);
  }

  retryCredits(): void {
    void this.loadCredits();
  }

  approve(tx: TransactionRec): void {
    void this.decide(tx, 'approved');
  }

  reject(tx: TransactionRec): void {
    void this.decide(tx, 'rejected');
  }

  private async decide(
    tx: TransactionRec,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    if (this.decidingId()) return;
    this.decidingId.set(tx.id);
    try {
      const res = await this.api.decideCreditRequest(tx.id, decision);
      if (!res.ok) {
        // 409 lands here: a supervisor decided it first.
        this.error.set(res.message);
        return;
      }
      this.error.set('');
      this.notice.set(
        `${fmtMoney(tx.amount)} for ${tx.worker} ${
          decision === 'approved' ? 'approved' : 'rejected'
        }.`,
      );
      await this.loadCredits();
    } finally {
      this.decidingId.set('');
    }
  }

  /* ---------------- helpers for the template ---------------- */

  categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category;
  }

  categoryIcon(category: string): string {
    return CATEGORY_ICONS[category] ?? 'fa-solid fa-receipt';
  }

  methodLabel(method: string): string {
    return METHOD_LABELS[method] ?? method;
  }
}
