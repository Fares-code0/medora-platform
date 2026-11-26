/**
 * Persistence for hospital, clinic, location and department administration
 * (ADM-01). Every query runs on the request's tenant-scoped client, so the
 * RLS policies apply as they do to any other caller: `hospitals_write`
 * admits a Platform Admin only; the organisational tables admit a Platform
 * Admin or the Hospital Admin of that hospital. Nothing is deleted.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

export interface HospitalRow {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly status: string;
  readonly timezone: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ClinicRow {
  readonly id: string;
  readonly publicId: string;
  readonly hospitalId: string;
  readonly name: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface LocationRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string;
  readonly latitude: Prisma.Decimal | null;
  readonly longitude: Prisma.Decimal | null;
  readonly status: string;
  readonly timezone: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface DepartmentRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly catalogueDepartmentId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface Page<T> {
  readonly rows: T[];
  readonly total: number;
}

export interface Paging {
  readonly page: number;
  readonly pageSize: number;
}

const HOSPITAL = {
  id: true,
  publicId: true,
  name: true,
  legalName: true,
  status: true,
  timezone: true,
  phone: true,
  email: true,
  createdAt: true,
  updatedAt: true,
} as const;
const CLINIC = {
  id: true,
  publicId: true,
  hospitalId: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
const LOCATION = {
  id: true,
  hospitalId: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  postalCode: true,
  countryCode: true,
  latitude: true,
  longitude: true,
  status: true,
  timezone: true,
  createdAt: true,
  updatedAt: true,
} as const;
const DEPARTMENT = {
  id: true,
  hospitalId: true,
  name: true,
  description: true,
  status: true,
  catalogueDepartmentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const contains = (q: string | undefined) =>
  q === undefined ? {} : { name: { contains: q, mode: 'insensitive' as const } };
const skip = ({ page, pageSize }: Paging) => ({ skip: (page - 1) * pageSize, take: pageSize });

@Injectable()
export class HospitalAdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── hospitals ── */

  async listHospitals(
    filter: { id: string | null; status?: string | undefined; q?: string | undefined },
    paging: Paging,
  ): Promise<Page<HospitalRow>> {
    const where: Prisma.HospitalWhereInput = {
      deletedAt: null,
      ...(filter.id === null ? {} : { id: filter.id }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...contains(filter.q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.hospital.findMany({
        where,
        select: HOSPITAL,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skip(paging),
      }),
      this.prisma.db.hospital.count({ where }),
    ]);
    return { rows, total };
  }

  hospital(id: string): Promise<HospitalRow | null> {
    return this.prisma.db.hospital.findFirst({ where: { id, deletedAt: null }, select: HOSPITAL });
  }

  createHospital(data: Prisma.HospitalCreateInput): Promise<HospitalRow> {
    return this.prisma.db.hospital.create({ data, select: HOSPITAL });
  }

  updateHospital(id: string, data: Prisma.HospitalUpdateInput): Promise<HospitalRow> {
    return this.prisma.db.hospital.update({ where: { id }, data, select: HOSPITAL });
  }

  /* ── clinics ── */

  async listClinics(
    hospitalId: string,
    filter: { status?: string | undefined; q?: string | undefined },
    paging: Paging,
  ): Promise<Page<ClinicRow>> {
    const where: Prisma.ClinicWhereInput = {
      hospitalId,
      deletedAt: null,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...contains(filter.q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.clinic.findMany({
        where,
        select: CLINIC,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skip(paging),
      }),
      this.prisma.db.clinic.count({ where }),
    ]);
    return { rows, total };
  }

  clinic(hospitalId: string, id: string): Promise<ClinicRow | null> {
    return this.prisma.db.clinic.findFirst({ where: { id, hospitalId, deletedAt: null }, select: CLINIC });
  }

  createClinic(data: Prisma.ClinicUncheckedCreateInput): Promise<ClinicRow> {
    return this.prisma.db.clinic.create({ data, select: CLINIC });
  }

  updateClinic(id: string, data: Prisma.ClinicUpdateInput): Promise<ClinicRow> {
    return this.prisma.db.clinic.update({ where: { id }, data, select: CLINIC });
  }

  /* ── locations ── */

  async listLocations(
    hospitalId: string,
    filter: { status?: string | undefined; q?: string | undefined },
    paging: Paging,
  ): Promise<Page<LocationRow>> {
    const where: Prisma.HospitalLocationWhereInput = {
      hospitalId,
      deletedAt: null,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...contains(filter.q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.hospitalLocation.findMany({
        where,
        select: LOCATION,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skip(paging),
      }),
      this.prisma.db.hospitalLocation.count({ where }),
    ]);
    return { rows, total };
  }

  location(hospitalId: string, id: string): Promise<LocationRow | null> {
    return this.prisma.db.hospitalLocation.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: LOCATION,
    });
  }

  createLocation(data: Prisma.HospitalLocationUncheckedCreateInput): Promise<LocationRow> {
    return this.prisma.db.hospitalLocation.create({ data, select: LOCATION });
  }

  updateLocation(id: string, data: Prisma.HospitalLocationUpdateInput): Promise<LocationRow> {
    return this.prisma.db.hospitalLocation.update({ where: { id }, data, select: LOCATION });
  }

  /* ── departments ── */

  async listDepartments(
    hospitalId: string,
    filter: { status?: 'ACTIVE' | 'INACTIVE' | undefined; q?: string | undefined },
    paging: Paging,
  ): Promise<Page<DepartmentRow>> {
    const where: Prisma.HospitalDepartmentWhereInput = {
      hospitalId,
      deletedAt: null,
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...contains(filter.q),
    };
    const [rows, total] = await Promise.all([
      this.prisma.db.hospitalDepartment.findMany({
        where,
        select: DEPARTMENT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...skip(paging),
      }),
      this.prisma.db.hospitalDepartment.count({ where }),
    ]);
    return { rows, total };
  }

  department(hospitalId: string, id: string): Promise<DepartmentRow | null> {
    return this.prisma.db.hospitalDepartment.findFirst({
      where: { id, hospitalId, deletedAt: null },
      select: DEPARTMENT,
    });
  }

  async catalogueDepartmentExists(id: string): Promise<boolean> {
    const row = await this.prisma.db.department.findFirst({ where: { id }, select: { id: true } });
    return row !== null;
  }

  createDepartment(data: Prisma.HospitalDepartmentUncheckedCreateInput): Promise<DepartmentRow> {
    return this.prisma.db.hospitalDepartment.create({ data, select: DEPARTMENT });
  }

  updateDepartment(id: string, data: Prisma.HospitalDepartmentUncheckedUpdateInput): Promise<DepartmentRow> {
    return this.prisma.db.hospitalDepartment.update({ where: { id }, data, select: DEPARTMENT });
  }
}
