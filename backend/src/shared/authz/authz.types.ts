/**
 * The authorization ports (RM M7.1, M7.2).
 *
 * Three things authorization needs that this milestone cannot supply:
 * the stored permission matrix and per-user overrides (M5.1, M5.2), a
 * cache to keep resolution off the hot path (Redis, M6/M19), and the
 * care-relationship rows (M5.6). Each is an interface with a `Symbol`
 * token, and each has a placeholder implementation alongside it.
 *
 * This is the same move `AUDIT_DISPATCHER` made at M2.3: fixing the
 * shape now is the point, because M8 onward will inject these tokens
 * long before the adapters behind them are real, and none of those call
 * sites should need editing when the adapters land.
 */

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { Permission, PermissionMatrix, PlatformRole } from './permission-catalogue';

/**
 * Who is acting, as far as authorization is concerned.
 *
 * Deliberately narrower than the session user: no name, no email,
 * nothing a 403 could accidentally echo back. It is **derived from**
 * M6's `AuthenticatedUser` rather than being a second thing the request
 * carries — see `principalOf` below.
 *
 * `roleCode` is a plain string, not `PlatformRole`, and that is the
 * point: the `roles` table holds six codes and the permission matrix has
 * five columns. `nurse` exists as a role a user can hold and has no
 * column, by ADR-017 §6 and the M5 seed's own reasoning — no source says
 * what a nurse may do. Typing this field to the five-role union would
 * make such a principal unrepresentable, and the resolver would then
 * either crash on the missing column or reject a user the database
 * considers valid. A string plus a fail-closed lookup is the honest
 * shape. See ADR-027 and open item RA-027.1.
 */
export interface Principal {
  readonly userId: string;
  /** The role **code** as `roles.code` spells it — may have no matrix column. */
  readonly roleCode: string;
  /** The `sid` claim, for cache scoping and audit correlation. */
  readonly sessionId?: string;
  /**
   * `users.authz_version` as read with the session on this request. Part of
   * the permission cache key: any change to the account's authorization
   * bumps it in the same transaction, so a cached set can never outlive the
   * change (multi-hospital §2.8–§2.10). Absent → the cache is bypassed.
   */
  readonly authzVersion?: number;
}

/**
 * Narrows M6's authenticated user to what authorization needs.
 *
 * One conversion, in one place. The alternative — a second principal
 * slot on the request, written by one guard and read by another — is
 * the mismatch that fails **open**: `getPrincipal` returns `undefined`,
 * and a route that should have been checked is checked against nobody.
 * This branch briefly had exactly that, and it is why the second slot is
 * gone.
 */
export function principalOf(user: AuthenticatedUser): Principal {
  return {
    userId: user.id,
    roleCode: user.role,
    sessionId: user.sessionId,
    ...(user.authzVersion === undefined ? {} : { authzVersion: user.authzVersion }),
  };
}

/**
 * Per-user grants and revocations layered over the role bundle
 * (DB §A5 `user_permissions`, API §15.5).
 *
 * Two-sided on purpose. A single "extra permissions" list could not
 * express taking one away, which is the half that matters for a role
 * bundle you cannot otherwise narrow for one person.
 */
export interface PermissionOverrides {
  readonly granted: readonly Permission[];
  readonly revoked: readonly Permission[];
}

export const NO_OVERRIDES: PermissionOverrides = { granted: [], revoked: [] };

/**
 * Where the matrix and the overrides come from.
 *
 * M5.1 and M5.2 replace the implementation with one reading
 * `role_permissions` and `user_permissions`. The interface is shaped by
 * those tables so the adapter is a translation and not a redesign.
 */
export interface RoleRepository {
  /** The stored matrix. Implementations may return junk; callers normalize. */
  currentMatrix(): Promise<unknown>;
  overridesFor(userId: string): Promise<PermissionOverrides>;
  /** Every user holding a role — what `forgetRole` needs to invalidate. */
  userIdsWithRole(roleCode: string): Promise<readonly string[]>;
  /**
   * The base role's code for a custom role (`roles.base_role_id`), `null`
   * for a system role or an unknown code.
   */
  baseRoleCodeOf(roleCode: string): Promise<string | null>;
}

export const ROLE_REPOSITORY = Symbol('ROLE_REPOSITORY');

/**
 * The effective-permission cache (RM M7.1 — "Redis-cached, invalidated
 * on change").
 *
 * Keyed by **user id**, not by role: a role-keyed cache cannot express
 * per-user overrides, so it would be wrong the first time anyone used
 * API §15.5.
 *
 * Every method may fail, and failing is not the same as denying. The
 * resolver treats an unavailable cache as a miss and reads through —
 * an authorization system that denies on an *infrastructure* fault locks
 * clinicians out of charts during an incident, which is a worse outcome
 * than a slow request.
 */
export interface PermissionCache {
  get(userId: string): Promise<readonly Permission[] | undefined>;
  set(userId: string, permissions: readonly Permission[]): Promise<void>;
  /** Invalidate one user — an override changed (API §15.5). */
  forget(userId: string): Promise<void>;
  /** Invalidate many — the matrix changed for a whole role (API §15.3). */
  forgetMany(userIds: readonly string[]): Promise<void>;
  /** Invalidate everything — the matrix was replaced wholesale. */
  clear(): Promise<void>;
}

export const PERMISSION_CACHE = Symbol('PERMISSION_CACHE');

/**
 * The care relationship (DB §13.1 `patient_doctor_assignments`).
 *
 * One question, asked one way. ADR-022 makes this service-layer scoping
 * in v1, with RLS as defence in depth at M37; this port is where both
 * eventually meet.
 */
export interface PatientAssignmentRepository {
  isAssigned(doctorUserId: string, patientId: string): Promise<boolean>;
}

export const PATIENT_ASSIGNMENT_REPOSITORY = Symbol('PATIENT_ASSIGNMENT_REPOSITORY');

/**
 * The account-to-record link (ADR-030, `patients.user_id`).
 *
 * The counterpart to `PatientAssignmentRepository`. That port answers
 * "does a care relationship exist between this doctor and this patient";
 * this one answers "which patient record, if any, is this account".
 *
 * Returns the public `PT-…` handle rather than the surrogate key, because
 * that is the vocabulary every route and every response already speaks.
 *
 * `null` is the ordinary answer, not an error: a staff account has no
 * patient record, and a patient account has none until it is linked —
 * which ADR-030 §4 keeps as a separate, deliberately undecided flow
 * (RA-030.1).
 */
export interface PatientSelfRepository {
  findPatientIdByUserId(userId: string): Promise<string | null>;
}

export const PATIENT_SELF_REPOSITORY = Symbol('PATIENT_SELF_REPOSITORY');

/** What `PermissionResolver` returns when a caller wants the whole picture. */
export interface EffectivePermissions {
  readonly principal: Principal;
  readonly permissions: readonly Permission[];
  /** The bundle before overrides — useful to audit and to explain a decision. */
  readonly fromRole: readonly Permission[];
  readonly overrides: PermissionOverrides;
}

export type { Permission, PermissionMatrix, PlatformRole };
