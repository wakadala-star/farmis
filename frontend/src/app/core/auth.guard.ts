import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Blocks protected screens until a session exists; otherwise sends
 *  the visitor to the sign-in form (the default entry of the system). */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAuthenticated()
    ? true
    : router.createUrlTree(['/signin'], {
        queryParams: { from: state.url },
      });
};

/** Keeps already signed-in users off the auth screens and sends them
 *  to their dashboard. For now every role opens the owner dashboard —
 *  supervisor/worker routing arrives with their screens. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAuthenticated()
    ? router.createUrlTree(['/dashboard'])
    : true;
};
