import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth.service';
import { DEMO_CREDENTIALS } from '../../../core/models';
import { Brand } from '../../../shared/brand/brand';

/**
 * Sign-in screen. The demo owner credentials are prefilled so the
 * flow lands on the owner dashboard seamlessly; validation is real,
 * but there is no backend call yet.
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
    email: new FormControl(DEMO_CREDENTIALS.email, {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl(DEMO_CREDENTIALS.password, {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly hidePassword = signal(true);

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

  protected onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { email, password } = this.form.getRawValue();
    const result = this.auth.signIn(email, password);

    if (result.ok) {
      const redirect =
        this.route.snapshot.queryParamMap.get('from') || '/dashboard';
      void this.router.navigateByUrl(redirect);
    } else {
      this.error.set(result.message);
    }
  }
}
