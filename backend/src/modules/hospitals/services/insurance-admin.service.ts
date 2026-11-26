/**
 * Insurance configuration (ADM-03).
 *
 * | Operation | Who |
 * | --- | --- |
 * | create / update an insurance provider | Platform Admin only (a platform lookup) |
 * | list / read providers | any administrator with a scope (needed to configure coverage) |
 * | list / add / update / remove a hospital's coverage | Platform Admin, or the Hospital Admin of that hospital |
 *
 * A provider is never deleted (patients' policies reference it): it is
 * deactivated with `active`. Coverage rows are configuration; removing one
 * deletes the row and leaves its audit entry. No row here is PHI.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { AdminScopeService } from '../../../shared/authz';
import type {
  CreateCoverageInput,
  CreateProviderInput,
  ListCoverageQuery,
  ListProvidersQuery,
  UpdateCoverageInput,
  UpdateProviderInput,
} from '../dto/insurance-admin.schema';
import { HospitalAdminRepository } from '../repositories/hospital-admin.repository';
import {
  type CoverageRow,
  InsuranceAdminRepository,
  type ProviderRow,
} from '../repositories/insurance-admin.repository';
import { changedFields, definedOnly, orConflict, pageView, type PageView } from './hospital-admin.service';

export interface ProviderView {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly phone: string | null;
  readonly website: string | null;
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CoverageView {
  readonly id: string;
  readonly hospitalId: string;
  readonly providerId: string;
  readonly planCode: string;
  readonly planName: string;
  readonly active: boolean;
  /** `YYYY-MM-DD` */
  readonly startsOn: string | null;
  /** `YYYY-MM-DD` */
  readonly endsOn: string | null;
  readonly createdAt: string;
}

const day = (date: Date | null): string | null => (date === null ? null : date.toISOString().slice(0, 10));
const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined || value === null ? value : new Date(`${value}T00:00:00.000Z`);

const toProvider = (row: ProviderRow): ProviderView => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});
const toCoverage = (row: CoverageRow): CoverageView => ({
  ...row,
  startsOn: day(row.startsOn),
  endsOn: day(row.endsOn),
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class InsuranceAdminService {
  constructor(
    private readonly insurance: InsuranceAdminRepository,
    private readonly hospitals: HospitalAdminRepository,
    private readonly scopes: AdminScopeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /* ── providers ── */

  async listProviders(actor: AuthenticatedUser, query: ListProvidersQuery): Promise<PageView<ProviderView>> {
    await this.scopes.hospitalFilterFor(actor); // any scoped administrator; `none` is refused
    return pageView(await this.insurance.listProviders(query, query), query, toProvider);
  }

  async getProvider(actor: AuthenticatedUser, providerId: string): Promise<ProviderView> {
    await this.scopes.hospitalFilterFor(actor);
    return toProvider(await this.requireProvider(providerId));
  }

  async createProvider(actor: AuthenticatedUser, input: CreateProviderInput): Promise<ProviderView> {
    await this.scopes.requirePlatform(actor);
    const row = await orConflict(
      () =>
        this.insurance.createProvider({
          code: input.code ?? null,
          name: input.name,
          phone: input.phone ?? null,
          website: input.website ?? null,
          ...(input.active === undefined ? {} : { active: input.active }),
          createdBy: actor.id,
        }),
      'An insurance provider with that name or code already exists',
    );
    await this.record(actor, 'hospital.insurance_provider_created', null, row.id, { active: row.active });
    return toProvider(row);
  }

  async updateProvider(
    actor: AuthenticatedUser,
    providerId: string,
    input: UpdateProviderInput,
  ): Promise<ProviderView> {
    await this.scopes.requirePlatform(actor);
    const current = await this.requireProvider(providerId);
    const row = await orConflict(
      () => this.insurance.updateProvider(providerId, { ...definedOnly(input), updatedBy: actor.id }),
      'An insurance provider with that name or code already exists',
    );
    await this.record(actor, 'hospital.insurance_provider_updated', null, current.id, {
      changed: changedFields(input),
      ...(input.active === undefined ? {} : { previous: String(current.active), next: String(input.active) }),
    });
    return toProvider(row);
  }

  /* ── hospital coverage ── */

  async listCoverage(
    actor: AuthenticatedUser,
    hospitalId: string,
    query: ListCoverageQuery,
  ): Promise<PageView<CoverageView>> {
    await this.scoped(actor, hospitalId);
    return pageView(await this.insurance.listCoverage(hospitalId, query, query), query, toCoverage);
  }

  async getCoverage(actor: AuthenticatedUser, hospitalId: string, coverageId: string): Promise<CoverageView> {
    await this.scoped(actor, hospitalId);
    return toCoverage(await this.requireCoverage(hospitalId, coverageId));
  }

  async addCoverage(
    actor: AuthenticatedUser,
    hospitalId: string,
    input: CreateCoverageInput,
  ): Promise<CoverageView> {
    await this.scoped(actor, hospitalId);
    const provider = await this.insurance.provider(input.providerId);
    if (provider === null) throw AppException.validation({ providerId: ['Unknown insurance provider'] });
    if (!provider.active) throw AppException.validation({ providerId: ['The insurance provider is inactive'] });
    const row = await orConflict(
      () =>
        this.insurance.createCoverage({
          hospitalId,
          providerId: input.providerId,
          planCode: input.planCode,
          planName: input.planName,
          ...(input.active === undefined ? {} : { active: input.active }),
          startsOn: toDate(input.startsOn) ?? null,
          endsOn: toDate(input.endsOn) ?? null,
        }),
      'This hospital already has that plan for the provider',
    );
    await this.record(actor, 'hospital.insurance_coverage_added', hospitalId, row.id, {
      providerId: row.providerId,
      planCode: row.planCode,
    });
    return toCoverage(row);
  }

  async updateCoverage(
    actor: AuthenticatedUser,
    hospitalId: string,
    coverageId: string,
    input: UpdateCoverageInput,
  ): Promise<CoverageView> {
    await this.scoped(actor, hospitalId);
    const current = await this.requireCoverage(hospitalId, coverageId);
    // The window is checked against the stored side of a one-sided change.
    const startsOn = input.startsOn === undefined ? day(current.startsOn) : input.startsOn;
    const endsOn = input.endsOn === undefined ? day(current.endsOn) : input.endsOn;
    if (startsOn !== null && endsOn !== null && endsOn < startsOn) {
      throw AppException.validation({ endsOn: ['endsOn must not be before startsOn'] });
    }
    const { startsOn: _s, endsOn: _e, ...rest } = input;
    const row = await this.insurance.updateCoverage(coverageId, {
      ...definedOnly(rest),
      ...(input.startsOn === undefined ? {} : { startsOn: toDate(input.startsOn) ?? null }),
      ...(input.endsOn === undefined ? {} : { endsOn: toDate(input.endsOn) ?? null }),
    });
    await this.record(actor, 'hospital.insurance_coverage_updated', hospitalId, current.id, {
      changed: changedFields(input),
      ...(input.active === undefined ? {} : { previous: String(current.active), next: String(input.active) }),
    });
    return toCoverage(row);
  }

  async removeCoverage(actor: AuthenticatedUser, hospitalId: string, coverageId: string): Promise<void> {
    await this.scoped(actor, hospitalId);
    const current = await this.requireCoverage(hospitalId, coverageId);
    await this.insurance.deleteCoverage(current.id);
    await this.record(actor, 'hospital.insurance_coverage_removed', hospitalId, current.id, {
      providerId: current.providerId,
      planCode: current.planCode,
    });
  }

  /* ── shared ── */

  private async scoped(actor: AuthenticatedUser, hospitalId: string): Promise<void> {
    await this.scopes.requireHospital(actor, hospitalId);
    if ((await this.hospitals.hospital(hospitalId)) === null) throw AppException.notFound('Hospital not found');
  }

  private async requireProvider(id: string): Promise<ProviderRow> {
    const row = await this.insurance.provider(id);
    if (row === null) throw AppException.notFound('Insurance provider not found');
    return row;
  }

  private async requireCoverage(hospitalId: string, id: string): Promise<CoverageRow> {
    const row = await this.insurance.coverage(hospitalId, id);
    if (row === null) throw AppException.notFound('Insurance coverage not found');
    return row;
  }

  private async record(
    actor: AuthenticatedUser,
    action: string,
    hospitalId: string | null,
    entityId: string,
    metadata: Record<string, string | number | boolean>,
  ): Promise<void> {
    await this.audit.record({
      action,
      actor: { userId: actor.id, role: actor.role, sessionId: actor.sessionId },
      entityType: action.includes('provider') ? 'insurance_provider' : 'hospital_insurance_coverage',
      entityId,
      hospitalId,
      metadata,
    });
  }
}
