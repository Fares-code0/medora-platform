/**
 * Reads behind authenticated patient discovery (DSC-01, DSC-02, DSC-04).
 *
 * ## Why `runAsSystem`
 *
 * Discovery spans hospitals the patient has no relationship with
 * (DR-09: "no hospital relationship is needed to search"). Under a
 * patient's own tenant scope `app_rls.org_visible(hospital_id)` hides
 * `clinics`, `hospital_locations`, `doctor_employments`, `published_slots`
 * and `hospital_insurance_coverage` of every hospital but their own, so
 * these are reviewed trusted lookups: each one selects an explicit list of
 * public, non-PHI columns and nothing else. The slot-occupied check is an
 * existence predicate (`appointments: { none }`) — no appointment column,
 * and certainly no patient id, is ever selected.
 *
 * The one read made in the caller's own scope is their insurance policy
 * (`patient_insurance` is visible to the patient who owns it).
 *
 * ## Visibility (L6)
 *
 * A doctor is offered only when verified, actively practising, not
 * soft-deleted, and holding an active employment (`ended_at IS NULL`) at an
 * ACTIVE, non-deleted hospital. The predicates are constants here, with no
 * parameter that can switch them off.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService, runAsSystem } from '../../../shared/database';

import type { Coordinates } from './discovery.geo';

/**
 * A slot is occupied by any appointment not in a released status. Matches
 * `appointments_one_live_booking_per_slot` and the patient slot listing's
 * `SLOT_HOLDING_STATUSES` (ADR-049): a `rescheduled` booking still holds its
 * slot, so discovery never advertises a slot the listing would hide.
 */
const RELEASED_STATUSES = ['CANCELLED', 'COMPLETED', 'NO_SHOW'] as const;

const ACTIVE_HOSPITAL = { status: 'ACTIVE', deletedAt: null } as const;

const VISIBLE_DOCTOR = {
  verificationStatus: 'VERIFIED',
  practiceStatus: 'ACTIVE',
  deletedAt: null,
} as const;

const LOCATION_SELECT = {
  id: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  region: true,
  countryCode: true,
  latitude: true,
  longitude: true,
} as const;

const ACTIVE_LOCATIONS = {
  where: { status: 'ACTIVE', deletedAt: null },
  select: LOCATION_SELECT,
  orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
};

export interface SlotRow {
  readonly slotId: string;
  readonly employmentId: string;
  readonly hospitalId: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
}

export interface LocationRow {
  readonly id: string;
  readonly name: string;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly city: string;
  readonly region: string | null;
  readonly countryCode: string;
  readonly latitude: { toNumber(): number } | null;
  readonly longitude: { toNumber(): number } | null;
}

export interface CandidateDoctor {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly photoUrl: string | null;
  readonly yearsOfExperience: number;
  readonly languages: string[];
  readonly specialties: readonly { isPrimary: boolean; specialty: { id: string; name: string } }[];
  readonly employment: {
    readonly id: string;
    readonly department: { id: string; name: string } | null;
    readonly hospital: {
      readonly id: string;
      readonly name: string;
      readonly timezone: string;
      readonly locations: readonly LocationRow[];
    };
  };
}

export interface CandidateFilters {
  readonly q?: string | undefined;
  readonly specialtyId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly hospitalId?: string | undefined;
  readonly clinicId?: string | undefined;
  readonly locationId?: string | undefined;
}

@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The provider of the caller's active, unexpired policy, or `null`.
   * Read in the caller's own scope — never another patient's.
   */
  async activeInsuranceProvider(userId: string, today: Date): Promise<string | null> {
    const policy = await this.prisma.db.patientInsurance.findFirst({
      where: {
        patient: { is: { userId } },
        isActive: true,
        OR: [{ validUntil: null }, { validUntil: { gte: today } }],
      },
      select: { providerId: true },
      orderBy: { id: 'asc' },
    });

    return policy?.providerId ?? null;
  }

  /** Hospitals (of those given) accepting `providerId` today. */
  async coveredHospitals(
    hospitalIds: readonly string[],
    providerId: string,
    today: Date,
  ): Promise<ReadonlySet<string>> {
    if (hospitalIds.length === 0) return new Set();

    const rows = await runAsSystem(
      async () =>
        await this.prisma.db.hospitalInsuranceCoverage.findMany({
          where: {
            hospitalId: { in: [...hospitalIds] },
            providerId,
            active: true,
            AND: [
              { OR: [{ startsOn: null }, { startsOn: { lte: today } }] },
              { OR: [{ endsOn: null }, { endsOn: { gte: today } }] },
            ],
          },
          select: { hospitalId: true },
        }),
    );

    return new Set(rows.map((row) => row.hospitalId));
  }

  /**
   * Earliest free published slot per employment: not withdrawn, in the
   * future, and with no occupying appointment (existence check only).
   */
  async nextSlots(
    employmentIds: readonly string[],
    now: Date,
  ): Promise<ReadonlyMap<string, SlotRow>> {
    if (employmentIds.length === 0) return new Map();

    const rows = await runAsSystem(
      async () =>
        await this.prisma.db.publishedSlot.findMany({
          where: {
            doctorEmploymentId: { in: [...employmentIds] },
            withdrawnAt: null,
            startsAt: { gt: now },
            appointments: { none: { status: { notIn: [...RELEASED_STATUSES] } } },
          },
          select: {
            id: true,
            doctorEmploymentId: true,
            hospitalId: true,
            startsAt: true,
            durationMinutes: true,
          },
          orderBy: [{ doctorEmploymentId: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
          distinct: ['doctorEmploymentId'],
        }),
    );

    return new Map(
      rows.map((row) => [
        row.doctorEmploymentId,
        {
          slotId: row.id,
          employmentId: row.doctorEmploymentId,
          hospitalId: row.hospitalId,
          startsAt: row.startsAt,
          durationMinutes: row.durationMinutes,
        },
      ]),
    );
  }

  async candidateDoctors(filters: CandidateFilters): Promise<readonly CandidateDoctor[]> {
    const employmentWhere = {
      endedAt: null,
      hospital: {
        is: {
          ...ACTIVE_HOSPITAL,
          ...(filters.hospitalId === undefined ? {} : { id: filters.hospitalId }),
          ...(filters.clinicId === undefined
            ? {}
            : { clinics: { some: { id: filters.clinicId, status: 'ACTIVE', deletedAt: null } } }),
          ...(filters.locationId === undefined
            ? {}
            : {
                locations: {
                  some: { id: filters.locationId, status: 'ACTIVE', deletedAt: null },
                },
              }),
        },
      },
      ...(filters.departmentId === undefined ? {} : { hospitalDepartmentId: filters.departmentId }),
    } as const;

    const q = filters.q;
    const where = {
      ...VISIBLE_DOCTOR,
      employments: { some: employmentWhere },
      ...(filters.specialtyId === undefined
        ? {}
        : { specialties: { some: { specialtyId: filters.specialtyId } } }),
      ...(q === undefined
        ? {}
        : {
            OR: [
              { fullName: { contains: q, mode: 'insensitive' as const } },
              { specialty: { contains: q, mode: 'insensitive' as const } },
              {
                specialties: {
                  some: { specialty: { name: { contains: q, mode: 'insensitive' as const } } },
                },
              },
              {
                employments: {
                  some: {
                    ...employmentWhere,
                    hospital: {
                      is: {
                        ...employmentWhere.hospital.is,
                        name: { contains: q, mode: 'insensitive' as const },
                      },
                    },
                  },
                },
              },
            ],
          }),
    };

    const rows = await runAsSystem(
      async () =>
        await this.prisma.db.doctor.findMany({
          where,
          select: {
            id: true,
            fullName: true,
            title: true,
            specialty: true,
            photoUrl: true,
            yearsOfExperience: true,
            languages: true,
            specialties: {
              select: { isPrimary: true, specialty: { select: { id: true, name: true } } },
            },
            employments: {
              where: employmentWhere,
              select: {
                id: true,
                department: { select: { id: true, name: true } },
                hospital: {
                  select: {
                    id: true,
                    name: true,
                    timezone: true,
                    locations: ACTIVE_LOCATIONS,
                  },
                },
              },
              take: 1,
            },
          },
          orderBy: { id: 'asc' },
        }),
    );

    const candidates: CandidateDoctor[] = [];
    for (const { employments, ...doctor } of rows) {
      const employment = employments[0];
      if (employment !== undefined) candidates.push({ ...doctor, employment });
    }
    return candidates;
  }
}

/** Coordinates of a location, or `null` unless both are known. */
export function coordinatesOf(location: LocationRow): Coordinates | null {
  if (location.latitude === null || location.longitude === null) return null;
  return { latitude: location.latitude.toNumber(), longitude: location.longitude.toNumber() };
}

