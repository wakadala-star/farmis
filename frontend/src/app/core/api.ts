import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

/**
 * Base URL of the FARMIS API.
 * Dev: http://localhost:4000/api · Prod: the Render service (environment.prod.ts).
 */
export const API_BASE = environment.apiBase;

/**
 * Every API request carries the httpOnly session cookie, so the
 * backend must be reached with `withCredentials: true`.
 */
export const withCredentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
