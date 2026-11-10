import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../../core/auth.service';
import {
  FarmDataService,
  TransactionRec,
  dayKey,
  fmtClock,
  fmtDay,
  fmtMoney,
  statusLabel,
  statusTone,
} from '../../../core/farm-data.service';
import { Department } from '../../../core/models';
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
  private readonly auth = inject(AuthService);
  private readonly data = inject(FarmDataService);

  readonly dept = (this.auth.department() ?? 'crops') as Department;

  readonly fmtClock = fmtClock;
  readonly fmtDay = fmtDay;
  readonly fmtMoney = fmtMoney;
  readonly statusTone = statusTone;
  readonly statusLabel = statusLabel;
  /** Epoch ms → 'YYYY-MM-DD' (local day of the transaction). */
  readonly dayOf = (ms: number) => dayKey(new Date(ms));

  readonly notice = signal('');

  readonly tiles = computed<MetaTile[]>(() => this.buildTiles());

  /** Credit transactions waiting for a decision. */
  readonly pending = computed(() => this.data.pendingTransactions(this.dept));

  /** Already decided transactions, newest first. */
  readonly history = computed(() =>
    this.data
      .transactionsOf(this.dept)
      .filter((tx) => tx.status !== 'pending'),
  );

  approve(tx: TransactionRec): void {
    this.data.setTransactionStatus(tx.id, 'approved');
    this.notice.set(`${fmtMoney(tx.amount)} for ${tx.worker} approved.`);
  }

  reject(tx: TransactionRec): void {
    this.data.setTransactionStatus(tx.id, 'rejected');
    this.notice.set(`${fmtMoney(tx.amount)} for ${tx.worker} rejected.`);
  }

  private buildTiles(): MetaTile[] {
    const pending = this.data.pendingTransactions(this.dept);
    const approved = this.data
      .transactionsOf(this.dept)
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
