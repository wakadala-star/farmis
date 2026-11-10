import { Component, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import {
  DEPT_OPTIONS,
  Department,
  ROLE_OPTIONS,
  Role,
} from '../../../core/models';
import { Brand } from '../../../shared/brand/brand';

/** Group validator: password and confirmation must match. */
function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = String(group.get('password')?.value ?? '');
  const confirm = String(group.get('confirm')?.value ?? '');
  return password && confirm && password !== confirm
    ? { mismatch: true }
    : null;
}

const ROLE_ICONS: Record<Role, string> = {
  owner: 'fa-solid fa-crown',
  supervisor: 'fa-solid fa-user-tie',
  worker: 'fa-solid fa-hard-hat',
};

/**
 * Sign-up screen. The form posts to the backend (POST /api/auth/signup);
 * on success it routes to the sign-in form.
 */
@Component({
  selector: 'app-sign-up',
  imports: [ReactiveFormsModule, RouterLink, Brand],
  templateUrl: './sign-up.html',
})
export class SignUp {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly roleOptions = ROLE_OPTIONS;
  protected readonly deptOptions = DEPT_OPTIONS;

  protected readonly form = new FormGroup(
    {
      fullName: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(2)],
      }),
      email: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.email],
      }),
      role: new FormControl<Role | ''>('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
      department: new FormControl<Department>('crops', {
        nonNullable: true,
      }),
      password: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required, Validators.minLength(6)],
      }),
      confirm: new FormControl('', {
        nonNullable: true,
        validators: [Validators.required],
      }),
    },
    { validators: passwordsMatch },
  );

  protected readonly error = signal('');
  protected readonly hidePassword = signal(true);
  protected readonly roleIcon = signal('fa-solid fa-id-badge');
  /** True while the sign-up request is in flight (button shows "Creating account…"). */
  protected readonly submitting = signal(false);
  /** Department is only relevant for supervisors and workers. */
  protected readonly showDepartment = signal(false);

  protected invalid(control: 'fullName' | 'email' | 'role' | 'password' | 'confirm'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  protected mismatched(): boolean {
    return (
      this.form.invalid &&
      this.form.errors?.['mismatch'] === true &&
      this.form.controls.confirm.touched
    );
  }

  protected togglePassword(): void {
    this.hidePassword.update((hidden) => !hidden);
  }

  protected onRoleChange(): void {
    const role = this.form.controls.role.value;
    this.roleIcon.set(
      (role ? ROLE_ICONS[role as Role] : undefined) ?? 'fa-solid fa-id-badge',
    );
    this.showDepartment.set(role === 'supervisor' || role === 'worker');
  }

  protected async onSubmit(): Promise<void> {
    // Blocks double submits, including Enter pressed while in flight.
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.error.set('');
    this.submitting.set(true);
    let succeeded = false;
    try {
      const { fullName, email, password, role, department } = this.form.getRawValue();
      const result = await this.auth.signUp({
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        role: role as Role,
        // The department only applies to supervisors and workers.
        department:
          role === 'owner' ? undefined : (department as Department),
      });

      if (result.ok) {
        succeeded = true;
        // Keep the loading state until navigation swaps the view.
        void this.router.navigate(['/signin'], {
          queryParams: { registered: '1' },
        });
        return;
      }
      this.error.set(result.message);
    } finally {
      // Reset only on failure — on success the view is being replaced.
      if (!succeeded) this.submitting.set(false);
    }
  }
}
