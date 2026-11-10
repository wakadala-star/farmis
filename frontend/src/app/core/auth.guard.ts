import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { Role } from './models';

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

/** Restricts a workspace to one role. Signed-in visitors of the wrong
 *  role are sent back to their own workspace home. */
export const roleGuard = (role: Role): CanActivateFn => (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/signin'], {
      queryParams: { from: state.url },
    });
  }

  const current = auth.role() ?? 'owner';
  return current === role
    ? true
    : router.createUrlTree([auth.homeForRole(current)]);
};

/** Keeps already signed-in users off the auth screens and sends them
 *  to the home of whichever role their session carries. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.isAuthenticated()
    ? router.createUrlTree([auth.homeForRole(auth.role() ?? 'owner')])
    : true;
};
