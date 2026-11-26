/**
 * Reads behind the patient-facing hospital directory (contract §2).
 *
 * Clinics, locations, departments and employments are tenant data: under
 * RLS a patient's own scope sees none of them, so — as the patient doctor
 * directory does (`patient-doctor.repository.ts`) — these reads run under
 * `system` scope. They are bounded by the explicit `select`s below to
 * organisational names and counts; no table here holds PHI, and nothing is
 * spread.
 *
 * Active only: a hospital that is not `ACTIVE` or is soft-deleted does not
 * exist for a patient, and the same holds for each clinic, location and
 * department listed under one.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService, runAsSystem } from '../../../shared/database';
import type {
  PatientHospitalDetail,
  PatientHospitalSummary,
} from '../dto/patient-hospital.dto';

const ACTIVE_HOSPITAL = { status: 'ACTIVE', deletedAt: null } as const;
const ACTIVE_ORG = { status: 'ACTIVE', deletedAt: null } as const;
const ACTIVE_DEPARTMENT = { status: 'ACTIVE', deletedAt: null } as const;

/** The doctor directory's own visibility rule, applied to specialties. */
const VISIBLE_DOCTOR = {
  verificationStatus: 'VERIFIED',
  practiceStatus: 'ACTIVE',
  deletedAt: null,
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PatientHospitalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(criteria: {
    readonly q?: string | undefined;
    readonly page: number;
    readonly pageSize: number;
  }): Promise<{ items: readonly PatientHospitalSummary[]; totalItems: number }> {
    const where = {
      ...ACTIVE_HOSPITAL,
      ...(criteria.q === undefined
        ? {}
        : { name: { contains: criteria.q, mode: 'insensitive' as const } }),
    };

    const [rows, totalItems] = await runAsSystem(
      async () =>
        await Promise.all([
          this.prisma.db.hospital.findMany({
            where,
            select: {
              id: true,
              name: true,
              locations: {
                where: ACTIVE_ORG,
                select: { city: true },
                orderBy: { name: 'asc' },
                take: 1,
              },
              _count: {
                select: {
                  clinics: { where: ACTIVE_ORG },
                  departments: { where: ACTIVE_DEPARTMENT },
                },
              },
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
            skip: (criteria.page - 1) * criteria.pageSize,
            take: criteria.pageSize,
          }),
          this.prisma.db.hospital.count({ where }),
        ]),
    );

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        city: row.locations[0]?.city ?? null,
        clinicCount: row._count.clinics,
        departmentCount: row._count.departments,
      })),
      totalItems,
    };
  }

  /** One active hospital, or `null` (unknown, inactive and malformed alike). */
  async findById(hospitalId: string): Promise<PatientHospitalDetail | null> {
    if (!UUID.test(hospitalId)) return null;

    return runAsSystem(async () => {
      const row = await this.prisma.db.hospital.findFirst({
        where: { id: hospitalId, ...ACTIVE_HOSPITAL },
        select: {
          id: true,
          name: true,
          phone: true,
          clinics: { where: ACTIVE_ORG, select: { id: true, name: true }, orderBy: { name: 'asc' } },
          locations: {
            where: ACTIVE_ORG,
            select: { id: true, name: true, addressLine1: true, city: true, timezone: true },
            orderBy: { name: 'asc' },
          },
          departments: {
            where: ACTIVE_DEPARTMENT,
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          },
        },
      });
      if (row === null) return null;

      // The schema has no hospital ↔ specialty table: the specialties a
      // hospital offers are those of the patient-visible doctors it employs.
      const specialties = await this.prisma.db.specialty.findMany({
        where: {
          active: true,
          doctors: {
            some: {
              doctor: {
                ...VISIBLE_DOCTOR,
                employments: { some: { hospitalId: row.id, endedAt: null } },
              },
            },
          },
        },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      return {
        id: row.id,
        name: row.name,
        description: null,
        phone: row.phone,
        clinics: row.clinics,
        locations: row.locations.map((location) => ({
          id: location.id,
          name: location.name,
          addressLine: location.addressLine1,
          city: location.city,
          timezone: location.timezone,
        })),
        departments: row.departments,
        specialties,
      };
    });
  }
}
