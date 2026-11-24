import { Inject, Injectable, Logger } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { memoizeInRequest } from './request-scope';

/**
 * Administrative scope (S5; OD-07 and the approved implementation decisions
 * of 2026-11-23, `docs/multi-hospital/OWNER_DECISIONS.md`).
 *
 * | Kind | When | Reaches |
 * | --- | --- | --- |
 * | `platform` | the account holds the `admin` role **and** a live, explicit `platform_admin_assignments` grant | platform-wide administration; no clinical or PHI access because of it |
 * | `hospital` | the account holds the `admin` role, **no** live grant, and live hospital `admin` assignments in **exactly one** hospital, which is active | that hospital's rows only; other hospitals' rows are 404 (ADR-022) |
 * | `none` | anything else | nothing administrative: refused (fail closed) |
 *
 * Resolved from the database on every request (at most once per request,
 * `memoizeInRequest`); never read from the token or the client. The `admin`
 * role alone is never platform scope (M-13): an unmapped administrator is
 * `none`, not `platform`.
 */
export type AdminScope =
  | { readonly kind: 'platform' }
  | { readonly kind: 'hospital'; readonly hospitalId: string; readonly hospitalName: string }
  | { readonly kind: 'none'; readonly reason: AdminScopeRefusal };

export type AdminScopeRefusal =
  | 'not_admin_role'
  | 'not_mapped'
  | 'ambiguous_hospital_admin'
  | 'hospital_not_active'
  | 'conflicting_designations'
  | 'resolution_unavailable';

/** A scope a handler may act under: never `none` (the guard refused that). */
export type ResolvedAdminScope = Exclude<AdminScope, { readonly kind: 'none' }>;

/**
 * The hospital a query must be restricted to, or `null` for platform-wide.
 * The only place a resolved scope turns into a filter, so "platform" can
 * never be spelled as a missing hospital id by accident.
 */
export function hospitalFilterOf(scope: ResolvedAdminScope): string | null {
  return scope.kind === 'hospital' ? scope.hospitalId : null;
}

export const ADMIN_SCOPE_REPOSITORY = Symbol('ADMIN_SCOPE_REPOSITORY');

export interface AdminScopeHospitalAssignment {
  readonly hospitalId: string;
  readonly hospitalName: string;
  /** Hospital `ACTIVE` and not soft-deleted. */
  readonly hospitalActive: boolean;
}

export interface AdminScopeFacts {
  /** A live `platform_admin_assignments` row exists. */
  readonly platformAdmin: boolean;
  /** Every live hospital `admin` assignment, whatever the hospital's state. */
  readonly hospitalAdminAssignments: readonly AdminScopeHospitalAssignment[];
}

export interface AdminScopeRepository {
  facts(userId: string): Promise<AdminScopeFacts>;
}

@Injectable()
export class AdminScopeService {
  private readonly logger = new Logger(AdminScopeService.name);

  constructor(@Inject(ADMIN_SCOPE_REPOSITORY) private readonly repository: AdminScopeRepository) {}

  /**
   * The caller's scope, resolved at most once per request. A failed lookup
   * is not cached and fails closed as `none`.
   */
  async forRequest(user: Pick<AuthenticatedUser, 'id' | 'role'>): Promise<AdminScope> {
    try {
      return await memoizeInRequest(`admin-scope:${user.id}:${user.role}`, () =>
        this.resolve(user),
      );
    } catch {
      this.logger.warn('Admin scope resolution unavailable');
      return { kind: 'none', reason: 'resolution_unavailable' };
    }
  }

  async resolve(user: Pick<AuthenticatedUser, 'id' | 'role'>): Promise<AdminScope> {
    // The role is the database's: the access-token guard refuses a token
    // whose role claim no longer matches the account (ADR-046).
    if (user.role !== 'admin') return { kind: 'none', reason: 'not_admin_role' };

    const facts = await this.repository.facts(user.id);
    return scopeFromFacts(facts);
  }
}

/** Pure, so the decision table is unit-tested without a database. */
export function scopeFromFacts(facts: AdminScopeFacts): AdminScope {
  if (facts.platformAdmin) {
    // The database refuses this combination; if it ever exists, neither
    // designation is honoured.
    return facts.hospitalAdminAssignments.length > 0
      ? { kind: 'none', reason: 'conflicting_designations' }
      : { kind: 'platform' };
  }

  const hospitals = new Map<string, AdminScopeHospitalAssignment>();
  for (const assignment of facts.hospitalAdminAssignments) {
    hospitals.set(assignment.hospitalId, assignment);
  }

  if (hospitals.size === 0) return { kind: 'none', reason: 'not_mapped' };
  if (hospitals.size > 1) return { kind: 'none', reason: 'ambiguous_hospital_admin' };

  const [only] = [...hospitals.values()];
  if (only === undefined) return { kind: 'none', reason: 'not_mapped' };
  if (!only.hospitalActive) return { kind: 'none', reason: 'hospital_not_active' };

  return { kind: 'hospital', hospitalId: only.hospitalId, hospitalName: only.hospitalName };
}
