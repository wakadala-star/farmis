import { Component, computed, inject, signal } from '@angular/core';
import { FarmApiService } from '../../../core/farm-api.service';
import {
  TransactionRec,
  dayKey,
  fmtClock,
  fmtDay,
  fmtMoney,
  statusLabel,
  statusTone,
} from '../../../core/farm-data.service';
import { MetaTile } from '../../../shared/management-view/management-view';

/**
 * Supervisor transactions — approve or reject the credit transactions
 * workers submit for farm purchases (transport, feed, twine…).
 */
@Component({
  selector: 'app-supervisor-transactions',
  templateUrl: './supervisor-transactions.html',
})
export class SupervisorTransactions {
  readonly api = inject(FarmApiService);

  readonly fmtClock = fmtClock;
  readonly fmtDay = fmtDay;
  readonly fmtMoney = fmtMoney;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  /** Epoch ms → 'YYYY-MM-DD' (local day of the transaction). */
  readonly dayOf = (ms: number) => dayKey(new Date(ms));

  readonly notice = signal('');
  readonly error = signal('');
  /** Request id whose decision is in flight (disables both buttons). */
  readonly decidingId = signal('');

  readonly loading = this.api.transactionsLoading;
  readonly loadError = this.api.transactionsError;

  constructor() {
    void this.api.ensure('transactions');
  }

  retry(): void {
    void this.api.ensure('transactions');
  }

  readonly tiles = computed<MetaTile[]>(() => this.buildTiles());

  /** Credit transactions waiting for a decision. */
  readonly pending = computed(() =>
    this.api.transactions().filter((tx) => tx.status === 'pending'),
  );

  /** Already decided transactions, newest first. */
  readonly history = computed(() =>
    this.api.transactions().filter((tx) => tx.status !== 'pending'),
  );

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
      const res = await this.api.decideTransaction(tx.id, decision);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.error.set('');
      this.notice.set(
        `${fmtMoney(tx.amount)} for ${tx.worker} ${
          decision === 'approved' ? 'approved' : 'rejected'
        }.`,
      );
    } finally {
      this.decidingId.set('');
    }
  }

  private buildTiles(): MetaTile[] {
    const pending = this.pending();
    const approved = this.api
      .transactions()
      .filter((tx) => tx.status === 'approved');
    const pendingValue = pending.reduce((sum, tx) => sum + tx.amount, 0);
    const approvedValue = approved.reduce((sum, tx) => sum + tx.amount, 0);

    return [
      {
        icon: 'fa-solid fa-hourglass-half',
        tone: 'amber',
        value: String(pending.length),
        label: 'Pending approvals',
        hint: 'Credit requests waiting for your decision',
      },
      {
        icon: 'fa-solid fa-coins',
        tone: 'blue',
        value: fmtMoney(pendingValue),
        label: 'Value pending',
        hint: 'Total UGX waiting across all requests',
      },
      {
        icon: 'fa-solid fa-circle-check',
        tone: 'green',
        value: fmtMoney(approvedValue),
        label: 'Approved total',
        hint: 'Credit you have approved so far',
      },
    ];
  }
}
