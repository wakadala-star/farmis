import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { Brand } from '../../../shared/brand/brand';

/**
 * Sign-in screen — a clean form with real validation. Credentials go
 * to the backend (POST /api/auth/signin), which sets an httpOnly JWT
 * cookie; after sign-in the router sends each role to its own
 * workspace.
 */
@Component({
  selector: 'app-sign-in',
  imports: [ReactiveFormsModule, RouterLink, Brand],
  templateUrl: './sign-in.html',
})
export class SignIn implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly hidePassword = signal(true);
  /** True while the sign-in request is in flight (button shows "Logging in…"). */
  protected readonly submitting = signal(false);

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('registered')) {
      this.notice.set('Account created — sign in with your credentials to continue.');
    }
  }

  protected invalid(control: 'email' | 'password'): boolean {
    const field = this.form.controls[control];
    return field.invalid && (field.touched || field.dirty);
  }

  protected togglePassword(): void {
    this.hidePassword.update((hidden) => !hidden);
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
      const { email, password } = this.form.getRawValue();
      const result = await this.auth.signIn(email, password);

      if (result.ok) {
        succeeded = true;
        const redirect =
          this.route.snapshot.queryParamMap.get('from') ||
          this.auth.homeForRole(this.auth.role() ?? 'owner');
        // Keep the loading state until navigation swaps the view,
        // so the button never flashes back to "Sign In".
        void this.router.navigateByUrl(redirect);
        return;
      }
      this.error.set(result.message);
    } finally {
      // Reset only on failure — on success the view is being replaced.
      if (!succeeded) this.submitting.set(false);
    }
  }
}
