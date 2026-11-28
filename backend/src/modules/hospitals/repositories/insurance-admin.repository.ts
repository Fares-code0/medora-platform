/**
 * Persistence for insurance configuration (ADM-03): the platform's
 * `insurance_providers` lookup (no RLS: reference data, no tenant column)
 * and a hospital's `hospital_insurance_coverage` rows (organisational RLS:
 * a Platform Admin, or the Hospital Admin of that hospital).
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';
import type { Page, Paging } from './hospital-admin.repository';

export interface ProviderRow {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly phone: string | null;
  readonly website: string | null;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CoverageRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly providerId: string;
  readonly planCode: string;
  readonly planName: string;
  readonly active: boolean;
  readonly startsOn: Date | null;
  readonly endsOn: Date | null;
  readonly createdAt: Date;
}

const PROVIDER = {
  id: true,
  code: true,
  name: true,
  phone: true,
  website: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;
const COVERAGE = {
  id: true,
  hospitalId: true,
  providerId: true,
  planCode: true,
  planName: true,
  active: true,
  startsOn: true,
  endsOn: true,
  createdAt: true,
} as const;

const skip = ({ page, pageSize }: Paging) => ({ skip: (page - 1) * pageSize, take: pageSize });

@Injectable()
export class InsuranceAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listProviders(
    filter: { active?: boolean | undefined; q?: string | undefined },
    paging: Paging,
  ): Promise<Page<ProviderRow>> {
    const where: Prisma.InsuranceProviderWhereInput = {
      ...(filter.active === undefined ? {} : { active: filter.active }),
      ...(filter.q === undefined ? {} : { name: { contains: filter.q, mode: 'insensitive' } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.insuranceProvider.findMany({
        where,
        select: PROVIDER,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skip(paging),
      }),
      this.prisma.db.insuranceProvider.count({ where }),
    ]);
    return { rows, total };
  }

  provider(id: string): Promise<ProviderRow | null> {
    return this.prisma.db.insuranceProvider.findFirst({ where: { id }, select: PROVIDER });
  }

  createProvider(data: Prisma.InsuranceProviderUncheckedCreateInput): Promise<ProviderRow> {
    return this.prisma.db.insuranceProvider.create({ data, select: PROVIDER });
  }

  updateProvider(id: string, data: Prisma.InsuranceProviderUncheckedUpdateInput): Promise<ProviderRow> {
    return this.prisma.db.insuranceProvider.update({ where: { id }, data, select: PROVIDER });
  }

  async listCoverage(
    hospitalId: string,
    filter: { active?: boolean | undefined; providerId?: string | undefined },
    paging: Paging,
  ): Promise<Page<CoverageRow>> {
    const where: Prisma.HospitalInsuranceCoverageWhereInput = {
      hospitalId,
      ...(filter.active === undefined ? {} : { active: filter.active }),
      ...(filter.providerId === undefined ? {} : { providerId: filter.providerId }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.hospitalInsuranceCoverage.findMany({
        where,
        select: COVERAGE,
        orderBy: [{ planName: 'asc' }, { id: 'asc' }],
        ...skip(paging),
      }),
      this.prisma.db.hospitalInsuranceCoverage.count({ where }),
    ]);
    return { rows, total };
  }

  coverage(hospitalId: string, id: string): Promise<CoverageRow | null> {
    return this.prisma.db.hospitalInsuranceCoverage.findFirst({
      where: { id, hospitalId },
      select: COVERAGE,
    });
  }

  createCoverage(data: Prisma.HospitalInsuranceCoverageUncheckedCreateInput): Promise<CoverageRow> {
    return this.prisma.db.hospitalInsuranceCoverage.create({ data, select: COVERAGE });
  }

  updateCoverage(
    id: string,
    data: Prisma.HospitalInsuranceCoverageUncheckedUpdateInput,
  ): Promise<CoverageRow> {
    return this.prisma.db.hospitalInsuranceCoverage.update({ where: { id }, data, select: COVERAGE });
  }

  /** Coverage is configuration, not a record: a removed row leaves only its audit entry. */
  async deleteCoverage(id: string): Promise<void> {
    await this.prisma.db.hospitalInsuranceCoverage.delete({ where: { id } });
  }
}
