import { Component, computed, inject, signal } from '@angular/core';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { FarmApiService, StaffRec } from '../../../core/farm-api.service';
import { fmtDay } from '../../../core/farm-data.service';
import { DEPT_LABELS, Department } from '../../../core/models';

/**
 * Owner Workers & HR — the full farm team: recruit a worker or a
 * supervisor into a chosen department (the owner sets the initial
 * password), review who is active, and remove someone (the account
 * is deactivated; history stays intact).
 */
@Component({
  selector: 'app-owner-workers',
  imports: [ReactiveFormsModule],
  templateUrl: './owner-workers.html',
})
export class OwnerWorkers {
  private readonly api = inject(FarmApiService);

  readonly fmtDay = fmtDay;

  readonly staff = this.api.staff;
  readonly loading = this.api.staffLoading;
  readonly loadError = this.api.staffError;

  readonly notice = signal('');
  readonly error = signal('');
  readonly submitting = signal(false);
  /** Member id whose removal is in flight (disables that button). */
  readonly removingId = signal('');

  /** Rows whose photo failed to load → render initials instead. */
  private readonly failedAvatars = signal<ReadonlySet<string>>(new Set());

  /** Phase 2E: team photo URL (null → initials fallback). */
  avatarSrc(member: StaffRec): string | null {
    return this.failedAvatars().has(member.id)
      ? null
      : this.api.avatarSrc(member);
  }

  markAvatarFailed(id: string): void {
    this.failedAvatars.update((set) => new Set(set).add(id));
  }

  readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(2)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.minLength(6)],
    }),
    role: new FormControl<'worker' | 'supervisor'>('worker', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    department: new FormControl<Department>('crops', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  /** Accounts still on the farm (inactive ones drop out of the count). */
  readonly activeCount = computed(
    () => this.staff().filter((m) => m.employmentStatus === 'active').length,
  );

  constructor() {
    void this.api.ensure('staff');
  }

  retry(): void {
    void this.api.ensure('staff');
  }

  invalid(control: 'name' | 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  roleLabel(role: string): string {
    return role === 'owner'
      ? 'Owner'
      : role === 'supervisor'
        ? 'Supervisor'
        : 'Worker';
  }

  roleChip(role: string): string {
    return role === 'owner'
      ? 'chip--amber'
      : role === 'supervisor'
        ? 'chip--blue'
        : 'chip--neutral';
  }

  deptLabel(dept: Department | null): string {
    return dept ? DEPT_LABELS[dept] : 'Farm-wide';
  }

  /** Owners are never removable (and never listed as removable). */
  canRemove(member: StaffRec): boolean {
    return member.employmentStatus === 'active' && member.role !== 'owner';
  }

  async recruit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set(
        'Enter a full name, a valid email and a password of at least 6 characters.',
      );
      return;
    }
    if (this.submitting()) return;

    const { name, email, password, role, department } = this.form.getRawValue();
    const taken = this.staff().some(
      (m) => m.email.toLowerCase() === email.trim().toLowerCase(),
    );
    if (taken) {
      this.error.set('An account with that email already exists on the farm.');
      return;
    }

    this.submitting.set(true);
    try {
      const res = await this.api.recruitMember({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        role,
        department,
      });
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.form.reset({
        name: '',
        email: '',
        password: '',
        role: 'worker',
        department: 'crops',
      });
      this.error.set('');
      this.notice.set(res.message);
    } finally {
      this.submitting.set(false);
    }
  }

  async remove(member: StaffRec): Promise<void> {
    if (this.removingId()) return;
    this.removingId.set(member.id);
    try {
      const res = await this.api.removeMember(member.id);
      if (!res.ok) {
        this.error.set(res.message);
        return;
      }
      this.error.set('');
      this.notice.set(res.message);
    } finally {
      this.removingId.set('');
    }
  }
}
