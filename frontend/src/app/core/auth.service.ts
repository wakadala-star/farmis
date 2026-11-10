import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthResult, Department, Role, Session } from './models';
import { API_BASE } from './api';

const SESSION_KEY = 'farmis.session';

export interface SignUpModel {
  fullName: string;
  email: string;
  password: string;
  role: Role;
  department?: Department;
}

interface ApiResponse {
  ok: boolean;
  message: string;
  session?: Session;
  userId?: string;
}

/**
 * REAL AUTHENTICATION against the FARMIS backend.
 *
 * - The JWT lives in an httpOnly cookie set by the API (never touches JS).
 * - The session *profile* (id, name, email, role, department) is cached in
 *   localStorage so the route guards can decide synchronously on reload;
 *   GET /api/auth/me revalidates it against the database on startup.
 * - signUp/signIn/signOut mirror the API's JSON contract; components and
 *   guards keep using the same signals and helpers as before.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  private readonly _session = signal<Session | null>(readJson<Session>(SESSION_KEY));

  /** Current session (null when signed out). */
  readonly session = this._session.asReadonly();
  readonly isAuthenticated = computed(() => this._session() !== null);
  readonly fullName = computed(() => this._session()?.fullName ?? 'there');
  readonly role = computed<Role | null>(() => this._session()?.role ?? null);
  readonly department = computed<Department | null>(
    () => this._session()?.department ?? null,
  );
  readonly initials = computed(() => initialsOf(this._session()?.fullName ?? ''));

  constructor() {
    void this.restoreSession();
  }

  /** Workspace home for a role — used by sign-in, guards and redirects. */
  homeForRole(role: Role): string {
    switch (role) {
      case 'supervisor':
        return '/supervisor';
      case 'worker':
        return '/worker';
      default:
        return '/dashboard';
    }
  }

  /** Create an account (POST /api/auth/signup). */
  async signUp(model: SignUpModel): Promise<AuthResult> {
    return this.post('/auth/signup', model);
  }

  /** Sign in (POST /api/auth/signin) — stores the session on success. */
  async signIn(email: string, password: string): Promise<AuthResult> {
    const result = await this.post('/auth/signin', { email, password });
    if (result.ok && result.session) {
      this.setSession(result.session);
    }
    return result;
  }

  /** Sign out — clears the cookie server-side and the local session. */
  signOut(): void {
    this.setSession(null);
    void firstValueFrom(
      this.http.post<ApiResponse>(`${API_BASE}/auth/signout`, {}),
    ).catch(() => {
      /* backend unreachable — local session is already cleared */
    });
  }

  /** Revalidate the cached session against the backend on startup. */
  private async restoreSession(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ ok: boolean; session: Session }>(`${API_BASE}/auth/me`),
      );
      this.setSession(res.session ?? null);
    } catch (err) {
      // 401 → the cached session expired; anything else (e.g. the API
      // being temporarily down) leaves the cached session untouched.
      if (err instanceof HttpErrorResponse && err.status === 401) {
        this.setSession(null);
      }
    }
  }

  private async post(path: string, body: unknown): Promise<AuthResult> {
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse>(`${API_BASE}${path}`, body),
      );
      return { ok: res.ok !== false, message: res.message, session: res.session };
    } catch (err) {
      return { ok: false, message: messageOf(err) };
    }
  }

  private setSession(session: Session | null): void {
    this._session.set(session);
    try {
      if (session) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      /* storage unavailable — session only lives in memory */
    }
  }
}

/** Extract the backend's { ok, message } body from an HTTP error. */
function messageOf(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as { message?: string } | null;
    if (body?.message) return body.message;
    if (err.status === 0) return 'Cannot reach the FARMIS server. Is the backend running?';
    return `Request failed (${err.status}).`;
  }
  return 'Something went wrong. Please try again.';
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'F';
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  return initials.toUpperCase();
}
