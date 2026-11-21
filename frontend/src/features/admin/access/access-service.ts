import type {
  MatrixPreview,
  PermissionMatrix,
  PermissionMatrixState,
  PlatformRole,
} from '../permissions';

/**
 * Users, roles and staff invitations — the port (ADM-09, FE-10.10).
 *
 * Three surfaces of Platform Settings that the live API serves, split out
 * of the settings document (which it does not): the Users panel, the
 * permission matrix, and the administrator invitation. Two adapters, picked
 * once in `service.ts` — the demo settings store, and the HTTP adapter over
 * API §2.10, §15 and ADR-035 §5.
 */

/**
 * An account as the Users panel shows it. `role` is a role **code**, not
 * the matrix's five: the live list is every account on the platform —
 * patients included — and a role an administrator created (API §15.4) is a
 * code the frontend has never heard of.
 */
export interface AccessUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  /** Null for an account that has never signed in. */
  readonly lastActiveAt: string | null;
}

/** Server-side filters for the Users panel (API §2.10's `q` and `role`). */
export interface AccessUserQuery {
  /** Name or email; empty means everyone. */
  readonly search: string;
  /** A role code, or `'all'`. */
  readonly role: string;
}

/** Active accounts per matrix role — what a matrix change would reach. */
export type RoleCounts = Readonly<Record<PlatformRole, number>>;

/**
 * The roles an invitation may confer (ADR-035 §5). Not `doctor` — doctors
 * self-register and are verified — and not `patient`.
 */
export const INVITABLE_ROLES = ['admin', 'reception', 'laboratory', 'pharmacy'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export interface StaffInvitationInput {
  readonly email: string;
  readonly role: InvitableRole;
}

/** What the server confirms: the invitation exists and when it lapses. */
export interface StaffInvitation {
  readonly email: string;
  readonly role: string;
  readonly expiresAt: string;
}

export interface AccessCapabilities {
  /** "Reset defaults" on the matrix — the live API has no such route. */
  readonly resetMatrix: boolean;
}

/**
 * A role as API §15.1 lists it: the five platform roles and any an
 * administrator created from one (§15.4). A custom role copies its base
 * role's capabilities when it is created; it has no matrix column
 * (`inMatrix` false), and the web client cannot open a workspace for it —
 * the session names the role but not its base (DEC-013).
 */
export interface AccessRole {
  readonly code: string;
  readonly label: string;
  /** Null for a platform role; the template's code for a custom one. */
  readonly baseRole: string | null;
  readonly system: boolean;
  /** Accounts holding it, active or not. */
  readonly members: number;
  readonly activeMembers: number;
  readonly inMatrix: boolean;
}

export interface CreateRoleInput {
  readonly code: string;
  readonly label: string;
  readonly baseRole: PlatformRole;
}

export interface AccessService {
  readonly capabilities: AccessCapabilities;
  listUsers(query: AccessUserQuery): Promise<readonly AccessUser[]>;
  /** Role and active flag only — API §2.10. Resolves to the server's row. */
  updateUser(
    id: string,
    changes: { readonly role?: string; readonly active?: boolean },
  ): Promise<AccessUser>;
  getMatrix(): Promise<PermissionMatrixState>;
  roleCounts(): Promise<RoleCounts>;
  /**
   * What saving this matrix would change, and for whom — against the stored
   * matrix, not the editor's copy of it (API §15.3's dry run). Writes nothing.
   */
  previewMatrix(matrix: PermissionMatrix): Promise<MatrixPreview>;
  /** Rejects with `PermissionConflictError` when another save landed first. */
  saveMatrix(input: {
    matrix: PermissionMatrix;
    baseRevision: number;
    actor: string;
  }): Promise<PermissionMatrixState>;
  resetMatrix(actor: string): Promise<PermissionMatrixState>;
  invite(input: StaffInvitationInput): Promise<StaffInvitation>;
  /** Every role, platform and custom — API §15.1. */
  listRoles(): Promise<readonly AccessRole[]>;
  /** A custom role from a platform role's bundle — API §15.4. Resolves to the server's row. */
  createRole(input: CreateRoleInput): Promise<AccessRole>;
}
