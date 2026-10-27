import path from 'node:path';

// The two demo accounts from packages/database/prisma/seed.ts. Tests never create users;
// they sign in as one of these through the saved storage state.
export const DEMO_PASSWORD = 'password';

export const accounts = {
  admin: { email: 'admin@erp.local', name: 'Admin User', role: 'ADMIN' },
  staff: { email: 'staff@erp.local', name: 'Staff User', role: 'STAFF' },
} as const;

export type AccountName = keyof typeof accounts;

/** Where auth.setup.ts saves each account's cookies. Gitignored. */
export function storageState(name: AccountName) {
  return path.resolve(import.meta.dirname, '..', '.auth', `${name}.json`);
}
