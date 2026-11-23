/**
 * Administrative scope (multi-hospital §2.2, §2.3; OD-07).
 *
 * | Scope | Held by | May |
 * | --- | --- | --- |
 * | `platform` | an `admin` with an active `platform_admin_grants` row | platform administration; never PHI by default |
 * | `hospital` | an `admin` with exactly one active hospital `admin` assignment | administration of that hospital only; cannot switch hospital or reach platform routes |
 * | `none` | every other `admin` (unmapped, ambiguous, or the hospital is inactive) | nothing administrative — deny by default |
 *
 * An unmapped administrator is not inferred to be a Platform Admin: the
 * legacy test accounts that predate the grant table hold `none` and are left
 * otherwise unchanged (owner decision; deleted before production).
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { AppException } from '../../common/errors/app.exception';
import { HospitalContextService } from './hospital-context.service';

export type AdminScope =
  | { readonly kind: 'platform' }
  | { readonly kind: 'hospital'; readonly hospitalId: string }
  | { readonly kind: 'none' };

@Injectable()
export class AdminScopeService {
  constructor(private readonly contexts: HospitalContextService) {}

  /** Resolved at most once per request (shares the hospital-context memo). */
  async scopeOf(user: Pick<AuthenticatedUser, 'id' | 'role'>): Promise<AdminScope> {
    if (user.role !== 'admin') return { kind: 'none' };
    const context = await this.contexts.forRequest(user);
    if (context.kind === 'platform') return { kind: 'platform' };
    if (context.kind === 'hospital' && context.source === 'hospital_admin_assignment') {
      return { kind: 'hospital', hospitalId: context.hospitalId };
    }
    return { kind: 'none' };
  }

  /** 403 unless the caller is a Platform Admin. */
  async requirePlatform(user: Pick<AuthenticatedUser, 'id' | 'role'>): Promise<void> {
    if ((await this.scopeOf(user)).kind !== 'platform') throw AppException.forbidden();
  }

  /**
   * 403 unless the caller administers `hospitalId`: its own Hospital Admin,
   * or a Platform Admin (administrative, non-PHI operations only).
   */
  async requireHospital(
    user: Pick<AuthenticatedUser, 'id' | 'role'>,
    hospitalId: string,
  ): Promise<AdminScope> {
    const scope = await this.scopeOf(user);
    if (scope.kind === 'platform') return scope;
    if (scope.kind === 'hospital' && scope.hospitalId === hospitalId) return scope;
    throw AppException.forbidden();
  }

  /**
   * The hospital an administrative query is confined to: `null` for a
   * Platform Admin (all hospitals), the hospital id for a Hospital Admin.
   * Throws for `none`.
   */
  async hospitalFilterFor(user: Pick<AuthenticatedUser, 'id' | 'role'>): Promise<string | null> {
    const scope = await this.scopeOf(user);
    if (scope.kind === 'platform') return null;
    if (scope.kind === 'hospital') return scope.hospitalId;
    throw AppException.forbidden();
  }
}
