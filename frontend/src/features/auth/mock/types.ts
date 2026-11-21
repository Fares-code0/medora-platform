import type { Permission, Role } from '@/types/auth';

/**
 * Mock-only types — the shape of the fake backend's *data*, nothing more.
 *
 * The error contract and the service contract used to live here, which
 * meant every page that wanted to branch on a failure imported from
 * `mock/`. They now live in `../model/` (`auth-error.ts`,
 * `auth-service.ts`), transcribed from the backend, and both adapters
 * implement them. What is left here is genuinely mock-only: the seeded
 * record, with the fake password and flags that must never leave this
 * directory.
 */

/** A seeded account: the public `SessionUser` plus mock-only secret/flags. */
export interface MockUserRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly permissions: readonly Permission[];
  /** D-27b: the account's primary clinic; absent for an admin, who spans them. */
  readonly clinicId?: string;
  /** Mock secret — never leaves this module. */
  readonly password: string;
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
}
