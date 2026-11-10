/** The three access levels of the FARMIS management system. */
export type Role = 'owner' | 'supervisor' | 'worker';

/** The two farm departments a supervisor or worker belongs to. */
export type Department = 'crops' | 'livestock';

export interface User {
  id: string;
  fullName: string;
  email: string;
  password: string;
  role: Role;
  /** Set for supervisors and workers — scopes their workspace data. */
  department?: Department;
}

export interface Session {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  department?: Department;
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

export const DEPT_LABELS: Record<Department, string> = {
  crops: 'Crops Department',
  livestock: 'Livestock Department',
};

export const DEPT_SHORT: Record<Department, string> = {
  crops: 'Crops',
  livestock: 'Livestock',
};

export const DEPT_OPTIONS: { value: Department; label: string }[] = [
  { value: 'crops', label: 'Crops Department' },
  { value: 'livestock', label: 'Livestock Department' },
];

/** A demo login shipped with the UI (documented in the README). */
export interface DemoAccount {
  label: string;
  email: string;
  password: string;
  role: Role;
  department?: Department;
  icon: string;
}

/**
 * Every demo account shipped with the UI. Each role opens its own
 * workspace after sign-in:
 *   owner        → /dashboard
 *   supervisor   → /supervisor (crop or livestock, from department)
 *   worker       → /worker
 */
export const DEMO_ACCOUNTS: DemoAccount[] = [
  {
    label: 'Owner',
    email: 'owner@farmis.com',
    password: 'Farmis123',
    role: 'owner',
    icon: 'fa-solid fa-crown',
  },
  {
    label: 'Crop Supervisor',
    email: 'crops@farmis.com',
    password: 'Farmis123',
    role: 'supervisor',
    department: 'crops',
    icon: 'fa-solid fa-user-tie',
  },
  {
    label: 'Livestock Supervisor',
    email: 'livestock@farmis.com',
    password: 'Farmis123',
    role: 'supervisor',
    department: 'livestock',
    icon: 'fa-solid fa-user-tie',
  },
  {
    label: 'Crops Worker',
    email: 'crops.worker@farmis.com',
    password: 'Farmis123',
    role: 'worker',
    department: 'crops',
    icon: 'fa-solid fa-hard-hat',
  },
  {
    label: 'Livestock Worker',
    email: 'livestock.worker@farmis.com',
    password: 'Farmis123',
    role: 'worker',
    department: 'livestock',
    icon: 'fa-solid fa-hard-hat',
  },
];
