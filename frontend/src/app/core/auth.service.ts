import { Injectable, computed, signal } from '@angular/core';
import {
  AuthResult,
  DEMO_CREDENTIALS,
  Role,
  Session,
  User,
} from './models';

const USERS_KEY = 'farmis.users';
const SESSION_KEY = 'farmis.session';

/**
 * The demo owner account that ships with the UI.
 * Prefilled on the sign-in screen so authentication can be
 * demonstrated end-to-end before a backend exists.
 */
const DEMO_USER: User = {
  id: 'demo-owner',
  fullName: 'Wakadala Mark',
  email: DEMO_CREDENTIALS.email,
  password: DEMO_CREDENTIALS.password,
  role: 'owner',
};

export interface SignUpModel {
  fullName: string;
  email: string;
  password: string;
  role: Role;
}

/**
 * MOCK AUTHENTICATION — stands in for the future backend.
 *
 * - Sign-ups persist users in localStorage (the stand-in "database").
 * - Sign-in validates credentials against that store plus the demo
 *   account, then opens a session used by the route guards.
 *
 * When the API arrives, replace the bodies of signUp/signIn/signOut
 * with HTTP calls — the components and guards will not change.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _session = signal<Session | null>(readJson<Session>(SESSION_KEY));

  /** Current session (null when signed out). */
  readonly session = this._session.asReadonly();
  readonly isAuthenticated = computed(() => this._session() !== null);
  readonly fullName = computed(() => this._session()?.fullName ?? 'there');
  readonly role = computed<Role | null>(() => this._session()?.role ?? null);
  readonly initials = computed(() => initialsOf(this._session()?.fullName ?? ''));

  signUp(model: SignUpModel): AuthResult {
    const users = this.readUsers();
    const email = model.email.trim().toLowerCase();

    const taken =
      users.some((user) => user.email.toLowerCase() === email) ||
      email === DEMO_USER.email;
    if (taken) {
      return { ok: false, message: 'An account with this email already exists.' };
    }

    users.push({ ...model, email, id: `user_${Date.now()}` });
    writeJson(USERS_KEY, users);
    return { ok: true, message: 'Account created successfully.' };
  }

  signIn(email: string, password: string): AuthResult {
    const target = email.trim().toLowerCase();
    const user = [...this.readUsers(), DEMO_USER].find(
      (candidate) => candidate.email.toLowerCase() === target,
    );

    if (!user || user.password !== password) {
      return {
        ok: false,
        message: 'Incorrect email or password. Try the prefilled demo credentials.',
      };
    }

    const session: Session = {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    };
    writeJson(SESSION_KEY, session);
    this._session.set(session);
    return { ok: true, message: `Welcome back, ${user.fullName}.` };
  }

  signOut(): void {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable — session only lives in memory */
    }
    this._session.set(null);
  }

  private readUsers(): User[] {
    return readJson<User[]>(USERS_KEY) ?? [];
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — session only lives in memory */
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
