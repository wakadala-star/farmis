/** The three access levels of the FARMIS management system. */
export type Role = 'owner' | 'supervisor' | 'worker';

export interface User {
  id: string;
  fullName: string;
  email: string;
  password: string;
  role: Role;
}

export interface Session {
  id: string;
  fullName: string;
  email: string;
  role: Role;
}

export interface AuthResult {
  ok: boolean;
  message: string;
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Farm Owner',
  supervisor: 'Farm Supervisor',
  worker: 'Farm Worker',
};

export const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'owner', label: 'Farm Owner' },
  { value: 'supervisor', label: 'Farm Supervisor' },
  { value: 'worker', label: 'Farm Worker' },
];

/** Prefilled demo account so sign-in flows seamlessly until the backend exists. */
export const DEMO_CREDENTIALS = {
  email: 'owner@farmis.com',
  password: 'Farmis123',
};
