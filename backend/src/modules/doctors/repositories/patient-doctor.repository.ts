/**
 * Patient-facing reads over `doctors` (ADR-030 §10).
 *
 * Every query here carries the same two predicates, and they are the
 * reason this file exists rather than a shared doctor repository with a
 * flag:
 *
 *   `verificationStatus = VERIFIED` and `practiceStatus = ACTIVE`
 *
 * **Those are safety properties, not filter preferences.** Showing a
 * patient a practitioner the clinic has not verified — or one it has
 * suspended — is a clinical-safety failure, not a UX inconsistency. A
 * caller cannot turn them off because there is no parameter to turn off,
 * and both columns are indexed (`04-people.prisma`), so the guarantee is
 * free.
 *
 * The `select` clauses are explicit and never spread. That is what makes
 * the projection enforceable: a column added to `doctors` tomorrow does
 * not appear in a patient response by default, and
 * `patient-doctor.dto.spec.ts` fails if one ever does.
 *
 * Soft deletes are handled globally by M4.2's client extension, so
 * `deletedAt` is not repeated here.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { PatientDoctorDetail, PatientDoctorSummary } from '../dto/patient-doctor.dto';

/**
 * The filters `GET /patient/doctors` accepts.
 *
 * The optional members are spelled `?: T | undefined` rather than `?: T`
 * because the project runs `exactOptionalPropertyTypes`. A Zod schema
 * with `.optional()` produces a present-but-undefined property, and under
 * that flag the two are different types — so the looser spelling here is
 * what lets a parsed query be passed straight through without a cast that
 * would erase the checking.
 */
export interface DoctorSearchCriteria {
  readonly q?: string | undefined;
  readonly specialtyId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly sort: 'name:asc' | 'name:desc' | 'rating:desc';
  readonly page: number;
  readonly pageSize: number;
}

export interface DoctorPage {
  readonly items: readonly PatientDoctorSummary[];
  readonly totalItems: number;
}

/** Applied to every patient-facing read. Not overridable by any caller. */
const PATIENT_VISIBLE = {
  verificationStatus: 'VERIFIED',
  practiceStatus: 'ACTIVE',
} as const;

const SUMMARY_SELECT = {
  id: true,
  fullName: true,
  title: true,
  specialty: true,
  photoUrl: true,
  yearsOfExperience: true,
  languages: true,
  ratingAvg: true,
  department: { select: { name: true } },
} as const;

@Injectable()
export class PatientDoctorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async search(criteria: DoctorSearchCriteria): Promise<DoctorPage> {
    const where = {
      ...PATIENT_VISIBLE,
      ...(criteria.q === undefined
        ? {}
        : // `mode: 'insensitive'` rather than a raw ILIKE: the pg_trgm GIN
          // index is in place for a later ranked search (M26), and this
          // stays a plain predicate until that milestone owns it.
          { fullName: { contains: criteria.q, mode: 'insensitive' as const } }),
      ...(criteria.specialtyId === undefined
        ? {}
        : { specialties: { some: { specialtyId: criteria.specialtyId } } }),
      ...(criteria.departmentId === undefined ? {} : { departmentId: criteria.departmentId }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.doctor.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: orderFor(criteria.sort),
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.doctor.count({ where }),
    ]);

    return { items: rows.map(toSummary), totalItems };
  }

  /**
   * One doctor, or `null`.
   *
   * `null` covers "no such doctor" and "not patient-visible" alike, and
   * the caller turns both into the same 404. A separate answer for the
   * second would confirm that a suspended practitioner exists.
   */
  async findById(doctorId: string): Promise<PatientDoctorDetail | null> {
    if (!UUID.test(doctorId)) return null;

    const row = await this.prisma.db.doctor.findFirst({
      where: { id: doctorId, ...PATIENT_VISIBLE },
      select: {
        ...SUMMARY_SELECT,
        biography: true,
        education: true,
        certifications: true,
        skills: true,
        officeLocation: true,
        officeHours: true,
        specialties: {
          select: { specialty: { select: { id: true, name: true } } },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });

    if (row === null) return null;

    return {
      ...toSummary(row),
      biography: row.biography,
      education: row.education,
      certifications: row.certifications,
      skills: row.skills,
      officeLocation: row.officeLocation,
      officeHours: row.officeHours,
      specialties: row.specialties.map((link) => link.specialty),
    };
  }

  /** The specialty filter chips — active entries only. */
  async listSpecialties(): Promise<
    readonly { id: string; name: string; parentId: string | null }[]
  > {
    return this.prisma.db.specialty.findMany({
      where: { active: true },
      select: { id: true, name: true, parentId: true },
      orderBy: { name: 'asc' },
    });
  }
}

/** The row shape `SUMMARY_SELECT` produces. */
interface SummaryRow {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly photoUrl: string | null;
  readonly yearsOfExperience: number;
  readonly languages: string[];
  readonly ratingAvg: { toNumber(): number } | null;
  readonly department: { name: string } | null;
}

function toSummary(row: SummaryRow): PatientDoctorSummary {
  return {
    id: row.id,
    fullName: row.fullName,
    title: row.title,
    specialty: row.specialty,
    departmentName: row.department?.name ?? null,
    // As stored — a `files.id`, not yet a URL. `PatientDoctorService`
    // resolves it through `ProfilePhotoUrls` before it reaches the wire.
    photoUrl: row.photoUrl,
    yearsOfExperience: row.yearsOfExperience,
    languages: row.languages,
    // `Decimal` serializes as an object through `JSON.stringify`, which
    // would put `{ s, e, d }` on the wire where the contract promises a
    // number. Converted here, once, rather than in each caller.
    ratingAvg: row.ratingAvg === null ? null : row.ratingAvg.toNumber(),
  };
}

function orderFor(sort: DoctorSearchCriteria['sort']) {
  switch (sort) {
    case 'name:desc':
      return { fullName: 'desc' } as const;
    case 'rating:desc':
      // Nulls last: a doctor with no survey yet is not the worst-rated
      // one, and sorting them to the top of a descending list would say
      // the opposite.
      return { ratingAvg: { sort: 'desc', nulls: 'last' } } as const;
    case 'name:asc':
    default:
      return { fullName: 'asc' } as const;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
