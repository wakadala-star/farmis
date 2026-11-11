import { Component, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FarmApiService } from '../../../core/farm-api.service';
import {
  dayKey,
  fmtClock,
  fmtDay,
  fmtMoney,
  statusLabel,
  statusTone,
} from '../../../core/farm-data.service';

/**
 * Worker transactions — request credit for a farm purchase (transport,
 * feed, twine…) and track the supervisor's decision. Requests land on
 * the supervisor's Transactions screen for approval.
 */
@Component({
  selector: 'app-worker-transactions',
  imports: [ReactiveFormsModule],
  templateUrl: './worker-transactions.html',
})
export class WorkerTransactions {
  private readonly api = inject(FarmApiService);

  readonly fmtClock = fmtClock;
  readonly fmtDay = fmtDay;
  readonly fmtMoney = fmtMoney;
  readonly statusLabel = statusLabel;
  readonly statusTone = statusTone;
  /** Epoch ms → 'YYYY-MM-DD' (local day of the request). */
  readonly dayOf = (ms: number) => dayKey(new Date(ms));

  readonly notice = signal('');
  readonly error = signal('');
  readonly submitting = signal(false);

  readonly form = new FormGroup({
    amount: new FormControl<number | null>(null, {
      validators: [Validators.required, Validators.min(1)],
    }),
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(200)],
    }),
  });

  /** This worker's own requests, newest first. */
  readonly requests = this.api.myTransactions;
  readonly loading = this.api.myTransactionsLoading;
  readonly loadError = this.api.myTransactionsError;

  constructor() {
    void this.api.ensure('myTransactions');
  }

  retry(): void {
    void this.api.ensure('myTransactions');
  }

  invalid(control: 'amount' | 'reason'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  async submit(): Promise<void> {
    const { amount, reason } = this.form.getRawValue();

    if (this.form.invalid || amount == null) {
      this.form.markAllAsTouched();
      this.error.set('Enter an amount above zero and say what the money is for.');
      return;
    }
    if (this.submitting()) return;

    this.submitting.set(true);
    try {
      const res = await this.api.requestCredit({
        amount: Number(amount),
        reason: reason.trim(),
      });

      if (!res.ok) {
        this.error.set(res.message);
        return;
      }

      this.form.reset({ amount: null, reason: '' });
      this.error.set('');
      this.notice.set(res.message);
    } finally {
      this.submitting.set(false);
    }
  }
}
