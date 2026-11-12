import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  FarmApiService,
  InventoryCategoryRec,
  InventoryFilter,
  InventoryItemRec,
  MovementFilter,
  StockMovementRec,
} from '../../../core/farm-api.service';
import { fmtDay, fmtMoney } from '../../../core/farm-data.service';

const TYPE_LABELS: Record<string, string> = {
  stock_in: 'Stock In',
  stock_out: 'Stock Out',
  adjustment: 'Adjustment',
};

const TYPE_CHIPS: Record<string, string> = {
  stock_in: 'chip--green',
  stock_out: 'chip--amber',
  adjustment: 'chip--blue',
};

const TYPE_ICONS: Record<string, string> = {
  stock_in: 'fa-solid fa-arrow-down',
  stock_out: 'fa-solid fa-arrow-up',
  adjustment: 'fa-solid fa-arrows-rotate',
};

/**
 * Inventory & Stores (Phase 3B) — three tabs on one screen, shared by
 * the owner (/inventory) and supervisors (/supervisor/inventory,
 * scoped to their department by the API):
 *
 *   Items       the item book with category / low-stock / search
 *               filters, add, edit and delete (delete → 409 with
 *               history; quantity never edits directly — only through
 *               movements keep the audit trail).
 *   Movements   the movement log with item / type / date filters and
 *               the record form: stock in (+), stock out (−, can't
 *               exceed on hand), adjustment (signed delta, never
 *               below zero).
 *   Categories  read-only, with per-category item counts.
 */
@Component({
  selector: 'app-inventory-screen',
  imports: [ReactiveFormsModule],
  templateUrl: './inventory-screen.html',
})
export class InventoryScreen {
  private readonly api = inject(FarmApiService);

  readonly fmtDay = fmtDay;
  readonly fmtMoney = fmtMoney;

  /* ---------------- tabs ---------------- */
  readonly tab = signal<'items' | 'movements' | 'categories'>('items');

  /* ---------------- shared notices ---------------- */
  readonly notice = signal('');
  readonly error = signal('');

  /* ---------------- items (filtered list) ---------------- */
  readonly items = signal<InventoryItemRec[]>([]);
  readonly itemsCount = signal(0);
  readonly itemsLoading = signal(true);
  readonly itemsError = signal('');

  /* ---------------- item filters ---------------- */
  readonly filterCategory = signal('');
  readonly filterLow = signal('');
  readonly filterQ = signal('');

  /* ---------------- categories ---------------- */
  readonly categories = signal<InventoryCategoryRec[]>([]);
  readonly categoriesLoading = signal(true);
  readonly categoriesError = signal('');

  /* ---------------- movements ---------------- */
  readonly movements = signal<StockMovementRec[]>([]);
  readonly movementsCount = signal(0);
  readonly movementsLoading = signal(true);
  readonly movementsError = signal('');

  /* ---------------- movement filters ---------------- */
  readonly movItem = signal('');
  readonly movType = signal('');
  readonly movFrom = signal('');
  readonly movTo = signal('');

  /**
   * Unfiltered items for the selects (form + movement filter) — the
   * filtered `items` list above must never shrink the pickers.
   */
  readonly allItems = signal<InventoryItemRec[]>([]);

  /* ---------------- item form ---------------- */
  readonly editingId = signal<string | null>(null);
  readonly itemSubmitting = signal(false);
  readonly removingId = signal('');

  readonly itemForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(120),
      ],
    }),
    code: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(50)],
    }),
    unit: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(30)],
    }),
    categoryId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    qtyOnHand: new FormControl('0', { nonNullable: true }),
    reorderLevel: new FormControl('0', { nonNullable: true }),
    unitCost: new FormControl('0', { nonNullable: true }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  /* ---------------- movement form ---------------- */
  readonly movSubmitting = signal(false);

  readonly movementForm = new FormGroup({
    itemId: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    type: new FormControl('stock_in', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    quantity: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    unitCost: new FormControl('', { nonNullable: true }),
    reference: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(80)],
    }),
    notes: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(500)],
    }),
  });

  constructor() {
    void this.loadItems();
    void this.loadCategories();
    void this.loadMovements();
    void this.loadAllItems();
  }

  /* ---------------- loads ---------------- */

  private itemFilter(): InventoryFilter {
    return {
      category: this.filterCategory() || undefined,
      low: this.filterLow() || undefined,
      q: this.filterQ().trim() || undefined,
    };
  }

  async loadItems(): Promise<void> {
    this.itemsLoading.set(true);
    this.itemsError.set('');
    const res = await this.api.listInventory(this.itemFilter());
    this.itemsLoading.set(false);
    if (!res.ok) {
      this.itemsError.set(res.message);
      return;
    }
    this.items.set(res.items);
    this.itemsCount.set(res.count);
  }

  retryItems(): void {
    void this.loadItems();
  }

  /** The unfiltered copy behind every select. */
  async loadAllItems(): Promise<void> {
    const res = await this.api.listInventory({});
    if (res.ok) this.allItems.set(res.items);
  }

  onFilterCategory(ev: Event): void {
    this.filterCategory.set((ev.target as HTMLSelectElement).value);
    void this.loadItems();
  }

  onFilterLow(ev: Event): void {
    this.filterLow.set((ev.target as HTMLSelectElement).value);
    void this.loadItems();
  }

  onFilterQ(ev: Event): void {
    this.filterQ.set((ev.target as HTMLInputElement).value);
    void this.loadItems();
  }

  resetItemFilters(): void {
    this.filterCategory.set('');
    this.filterLow.set('');
    this.filterQ.set('');
    void this.loadItems();
  }

  hasItemFilters(): boolean {
    return !!(this.filterCategory() || this.filterLow() || this.filterQ().trim());
  }

  async loadCategories(): Promise<void> {
    this.categoriesLoading.set(true);
    this.categoriesError.set('');
    const res = await this.api.listInventoryCategories();
    this.categoriesLoading.set(false);
    if (!res.ok) {
      this.categoriesError.set(res.message);
      return;
    }
    this.categories.set(res.categories);
  }

  retryCategories(): void {
    void this.loadCategories();
  }

  private movementFilter(): MovementFilter {
    return {
      item: this.movItem() || undefined,
      type: this.movType() || undefined,
      dateFrom: this.movFrom() || undefined,
      dateTo: this.movTo() || undefined,
    };
  }

  async loadMovements(): Promise<void> {
    this.movementsLoading.set(true);
    this.movementsError.set('');
    const res = await this.api.listMovements(this.movementFilter());
    this.movementsLoading.set(false);
    if (!res.ok) {
      this.movementsError.set(res.message);
      return;
    }
    this.movements.set(res.movements);
    this.movementsCount.set(res.count);
  }

  retryMovements(): void {
    void this.loadMovements();
  }

  onMovItem(ev: Event): void {
    this.movItem.set((ev.target as HTMLSelectElement).value);
    void this.loadMovements();
  }

  onMovType(ev: Event): void {
    this.movType.set((ev.target as HTMLSelectElement).value);
    void this.loadMovements();
  }

  onMovFrom(ev: Event): void {
    this.movFrom.set((ev.target as HTMLInputElement).value);
    void this.loadMovements();
  }

  onMovTo(ev: Event): void {
    this.movTo.set((ev.target as HTMLInputElement).value);
    void this.loadMovements();
  }

  resetMovFilters(): void {
    this.movItem.set('');
    this.movType.set('');
    this.movFrom.set('');
    this.movTo.set('');
    void this.loadMovements();
  }

  hasMovFilters(): boolean {
    return !!(
      this.movItem() ||
      this.movType() ||
      this.movFrom() ||
      this.movTo()
    );
  }

  switchTab(tab: 'items' | 'movements' | 'categories'): void {
    this.tab.set(tab);
    this.notice.set('');
    this.error.set('');
  }

  /* ---------------- item form ---------------- */

  invalid(control: 'name' | 'unit' | 'categoryId'): boolean {
    const field = this.itemForm.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  private resetItemForm(): void {
    this.editingId.set(null);
    this.itemForm.reset({
      name: '',
      code: '',
      unit: '',
      categoryId: '',
      qtyOnHand: '0',
      reorderLevel: '0',
      unitCost: '0',
      description: '',
    });
    this.error.set('');
  }

  cancelItemEdit(): void {
    this.resetItemForm();
  }

  editItem(item: InventoryItemRec): void {
    this.editingId.set(item.id);
    this.itemForm.setValue({
      name: item.name,
      code: item.code,
      unit: item.unit,
      categoryId: item.categoryId,
      // Quantity is deliberately not part of the edit form: stock
      // levels change through movements only.
      qtyOnHand: String(item.qty),
      reorderLevel: String(item.reorderLevel),
      unitCost: String(item.unitCost),
      description: item.description,
    });
    this.notice.set('');
    this.error.set('');
    this.tab.set('items');
  }

  async saveItem(): Promise<void> {
    if (this.itemForm.invalid) {
      this.itemForm.markAllAsTouched();
      this.error.set('An item needs a name, a unit and a category.');
      return;
    }
    if (this.itemSubmitting()) return;

    const v = this.itemForm.getRawValue();
    const qtyOnHand = Number(v.qtyOnHand);
    const reorderLevel = Number(v.reorderLevel);
    const unitCost = Number(v.unitCost);
    const editing = this.editingId();

    if (!editing && (!Number.isFinite(qtyOnHand) || qtyOnHand < 0)) {
      this.error.set('Opening quantity cannot be negative.');
      return;
    }
    if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
      this.error.set('Reorder level cannot be negative.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      this.error.set('Unit cost cannot be negative.');
      return;
    }

    const payload = {
      name: v.name.trim(),
      code: v.code.trim(),
      unit: v.unit.trim(),
      categoryId: v.categoryId,
      reorderLevel,
      unitCost,
      description: v.description.trim(),
      ...(editing ? {} : { qtyOnHand }),
    };

    this.itemSubmitting.set(true);
    try {
      const res = editing
        ? await this.api.updateInventoryItem(editing, payload)
        : await this.api.createInventoryItem(payload);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.resetItemForm();
      this.notice.set(res.message);
      await this.loadItems();
      await this.loadAllItems();
      await this.loadCategories();
    } finally {
      this.itemSubmitting.set(false);
    }
  }

  async removeItem(item: InventoryItemRec): Promise<void> {
    if (this.removingId()) return;
    this.removingId.set(item.id);
    this.notice.set('');
    this.error.set('');
    try {
      const res = await this.api.removeInventoryItem(item.id);
      if (!res.ok) {
        // 409 lands here: the item has sales or movement history.
        this.error.set(res.message);
        return;
      }
      if (this.editingId() === item.id) this.resetItemForm();
      this.notice.set(res.message);
      await this.loadItems();
      await this.loadAllItems();
      await this.loadCategories();
    } finally {
      this.removingId.set('');
    }
  }

  /* ---------------- movement form ---------------- */

  invalidMov(control: 'itemId' | 'quantity'): boolean {
    const field = this.movementForm.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  private resetMovementForm(): void {
    this.movementForm.reset({
      itemId: '',
      type: 'stock_in',
      quantity: '',
      unitCost: '',
      reference: '',
      notes: '',
    });
  }

  async saveMovement(): Promise<void> {
    if (this.movementForm.invalid) {
      this.movementForm.markAllAsTouched();
      this.error.set('Pick an item and enter a quantity.');
      return;
    }
    if (this.movSubmitting()) return;

    const v = this.movementForm.getRawValue();
    const qty = Number(v.quantity);
    const type = v.type;
    if (!Number.isFinite(qty) || qty === 0) {
      this.error.set('Quantity must be a non-zero number.');
      return;
    }
    if ((type === 'stock_in' || type === 'stock_out') && qty < 0) {
      this.error.set(
        `${TYPE_LABELS[type]} quantities are positive — use an adjustment for a decrease.`,
      );
      return;
    }
    const unitCost = v.unitCost.trim() === '' ? undefined : Number(v.unitCost);
    if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) {
      this.error.set('Unit cost cannot be negative.');
      return;
    }

    this.movSubmitting.set(true);
    try {
      const res = await this.api.recordStockMovement({
        itemId: v.itemId,
        type,
        quantity: qty,
        unitCost,
        reference: v.reference.trim(),
        notes: v.notes.trim(),
      });
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.resetMovementForm();
      this.notice.set(res.message);
      await this.loadMovements();
      await this.loadItems();
      await this.loadAllItems();
    } finally {
      this.movSubmitting.set(false);
    }
  }

  /* ---------------- helpers for the template ---------------- */

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }

  typeChip(type: string): string {
    return `chip ${TYPE_CHIPS[type] ?? 'chip--neutral'}`;
  }

  typeIcon(type: string): string {
    return TYPE_ICONS[type] ?? 'fa-solid fa-arrows-rotate';
  }

  /** Signed quantity at a glance: +5 kg in, −5 kg out, −2 adjustment. */
  qtyLabel(m: StockMovementRec): string {
    if (m.type === 'stock_in') return `+${m.quantity}`;
    if (m.type === 'stock_out') return `−${m.quantity}`;
    return m.quantity > 0 ? `+${m.quantity}` : `${m.quantity}`;
  }
}
