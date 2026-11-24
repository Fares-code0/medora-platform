/**
 * The request's Row-Level Security tenant context, derived from the
 * authorized caller (multi-hospital §2.15; RLS_BACKEND_CONTRACT.md).
 *
 * | Caller | Context |
 * | --- | --- |
 * | Platform Admin | `platform` (organisational data; no PHI) |
 * | Hospital Admin | `hospital` of its one assignment |
 * | doctor / staff in clinical standing | `hospital` of the active employment / affiliation |
 * | patient | `patient` (its own rows) |
 * | anyone else | `self` — no tenant (every tenant policy fails closed); only rows that are theirs by identity |
 *
 * Only when `DATABASE_TENANT_CONTEXT` is on; otherwise a no-op. The lookups
 * are the caller's own staffing, read under `system` scope.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { ConfigService } from '../../config';
import { PrismaService, runAsSystem, setTenantContext, type TenantContext } from '../database';
import { AdminScopeService } from './admin-scope.service';
import { HospitalContextService } from './hospital-context.service';

const STAFF_ROLES = new Set(['reception', 'laboratory', 'pharmacy', 'nurse']);

@Injectable()
export class TenantContextResolver {
  constructor(
    private readonly config: ConfigService,
    private readonly scopes: AdminScopeService,
    private readonly contexts: HospitalContextService,
    private readonly prisma: PrismaService,
  ) {}

  async apply(user: AuthenticatedUser): Promise<void> {
    if (!this.config.databaseTenantContext) return;
    setTenantContext(await runAsSystem(() => this.resolve(user)));
  }

  async resolve(user: AuthenticatedUser): Promise<TenantContext | undefined> {
    return (await this.tenantOf(user)) ?? { scope: 'self', userId: user.id };
  }

  private async tenantOf(user: AuthenticatedUser): Promise<TenantContext | undefined> {
    if (user.role === 'admin') {
      const scope = await this.scopes.scopeOf(user);
      if (scope.kind === 'platform') return { scope: 'platform', userId: user.id };
      if (scope.kind === 'hospital') return { scope: 'hospital', hospitalId: scope.hospitalId, userId: user.id };
      return undefined;
    }
    if (user.role === 'patient') {
      const patient = await this.prisma.db.patient.findFirst({ where: { userId: user.id }, select: { id: true } });
      return patient === null ? undefined : { scope: 'patient', patientId: patient.id, userId: user.id };
    }
    if (user.role === 'doctor') {
      const context = await this.contexts.forRequest(user);
      return context.kind === 'hospital'
        ? { scope: 'hospital', hospitalId: context.hospitalId, userId: user.id }
        : undefined;
    }
    if (STAFF_ROLES.has(user.role)) {
      const affiliation = await this.prisma.db.hospitalStaffAffiliation.findFirst({
        where: {
          endedAt: null,
          staff: { is: { userId: user.id, deletedAt: null } },
          hospital: { is: { status: 'ACTIVE', deletedAt: null } },
        },
        select: { hospitalId: true },
      });
      return affiliation === null
        ? undefined
        : { scope: 'hospital', hospitalId: affiliation.hospitalId, userId: user.id };
    }
    return undefined;
  }
}
