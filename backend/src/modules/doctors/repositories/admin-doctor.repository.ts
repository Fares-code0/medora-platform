/**
 * The administrator's reads and writes over `doctors` (API §3.4–3.7).
 *
 * ## Deliberately separate from `PatientDoctorRepository`
 *
 * That file carries two predicates on every query — `VERIFIED` and
 * `ACTIVE` — and calls them safety properties rather than filter
 * preferences, because a caller must not be able to turn them off. This
 * file is the roster an administrator manages, so it must show exactly
 * the practitioners that one hides: the unverified, the rejected, the
 * suspended. Two repositories rather than one with a flag, for the
 * reason the module doc gives — a single branch edited wrongly is how
 * the internal entity reaches a patient.
 *
 * ## The statistics are counts, never identities
 *
 * `patientsCount` and `appointments30d` are aggregates. No patient id,
 * name or MRN crosses this boundary, which is what lets an administrator
 * holding `doctors.manage` but not `patients.view` read the roster
 * without reaching PHI.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type { DoctorPracticeStatus, DoctorVerificationStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Appointments a suspension would disturb — the live statuses only. */
const LIVE_APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'PENDING',
  'AWAITING_PATIENT',
] as const;

const SUMMARY_SELECT = {
  id: true,
  fullName: true,
  title: true,
  specialty: true,
  licenseNumber: true,
  licenseExpiresOn: true,
  professionalCategory: true,
  verificationStatus: true,
  practiceStatus: true,
  ratingAvg: true,
  createdAt: true,
  department: { select: { name: true } },
  user: { select: { lastActiveAt: true } },
} as const;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  contactEmail: true,
  contactPhone: true,
  officeLocation: true,
  officeHours: true,
  biography: true,
  yearsOfExperience: true,
  languages: true,
  education: true,
  certifications: true,
  skills: true,
  employeeId: true,
  verifiedAt: true,
  verificationDocuments: {
    select: {
      id: true,
      kind: true,
      fileId: true,
      uploadedAt: true,
      expiresOn: true,
      decision: true,
      decidedAt: true,
      rejectReason: true,
      checkAuthentic: true,
      checkCurrent: true,
      checkIdentityMatch: true,
    },
    orderBy: { uploadedAt: 'desc' },
  },
} as const;

export type AdminDoctorSummaryRow = Prisma.DoctorGetPayload<{ select: typeof SUMMARY_SELECT }>;
export type AdminDoctorDetailRow = Prisma.DoctorGetPayload<{ select: typeof DETAIL_SELECT }>;

export interface AdminDoctorCriteria {
  readonly q?: string | undefined;
  readonly specialtyId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly verification?: DoctorVerificationStatus | undefined;
  readonly status?: DoctorPracticeStatus | undefined;
  readonly joinedFrom?: Date | undefined;
  readonly joinedTo?: Date | undefined;
  readonly sort: 'name:asc' | 'name:desc' | 'joined:asc' | 'joined:desc' | 'rating:desc';
  readonly page: number;
  readonly pageSize: number;
  /**
   * S5: a Hospital Admin's roster — doctors with an active employment at
   * this hospital. Absent (Platform Admin): every doctor, as before.
   */
  readonly hospitalId?: string | undefined;
}

@Injectable()
export class AdminDoctorRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    criteria: AdminDoctorCriteria,
  ): Promise<{ rows: readonly AdminDoctorSummaryRow[]; totalItems: number }> {
    const where: Prisma.DoctorWhereInput = {
      ...(criteria.q === undefined
        ? {}
        : {
            OR: [
              { fullName: { contains: criteria.q, mode: 'insensitive' } },
              // citext, so it already compares case-insensitively.
              { contactEmail: { contains: criteria.q } },
              { licenseNumber: { contains: criteria.q, mode: 'insensitive' } },
            ],
          }),
      ...(criteria.specialtyId === undefined
        ? {}
        : { specialties: { some: { specialtyId: criteria.specialtyId } } }),
      ...(criteria.departmentId === undefined ? {} : { departmentId: criteria.departmentId }),
      ...(criteria.verification === undefined
        ? {}
        : { verificationStatus: criteria.verification }),
      ...(criteria.status === undefined ? {} : { practiceStatus: criteria.status }),
      ...(criteria.hospitalId === undefined
        ? {}
        : { employments: { some: { hospitalId: criteria.hospitalId, endedAt: null } } }),
      ...(criteria.joinedFrom === undefined && criteria.joinedTo === undefined
        ? {}
        : {
            createdAt: {
              ...(criteria.joinedFrom === undefined ? {} : { gte: criteria.joinedFrom }),
              ...(criteria.joinedTo === undefined ? {} : { lte: criteria.joinedTo }),
            },
          }),
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

    return { rows, totalItems };
  }

  /**
   * One **live** doctor, or null.
   *
   * `findFirst` with an explicit `deletedAt: null`, not `findUnique`: the
   * soft-delete extension cannot filter `findUnique` (see
   * `shared/database/soft-delete.ts`), so a lookup by id returned a
   * soft-deleted practitioner and every admin route built on it — detail,
   * verify, reject, request-documents, suspend, reactivate — went on to
   * read or change a row that no longer exists as far as the clinic is
   * concerned. A deleted doctor is 404 (ADR-022). Nothing in this
   * repository acts on deleted doctors on purpose.
   */
  findById(doctorId: string): Promise<AdminDoctorDetailRow | null> {
    if (!UUID.test(doctorId)) return Promise.resolve(null);

    return this.prisma.db.doctor.findFirst({
      where: { id: doctorId, deletedAt: null },
      select: DETAIL_SELECT,
    });
  }

  /**
   * Assigned patients and appointments in the last 30 days, per doctor.
   *
   * Batched with `groupBy` rather than two counts per row: a 100-row
   * roster page would otherwise be 200 round trips, which is the N+1 M32.3
   * exists to find. One query each, keyed by doctor id.
   */
  async statisticsFor(
    doctorIds: readonly string[],
  ): Promise<Readonly<Record<string, { patientsCount: number; appointments30d: number }>>> {
    if (doctorIds.length === 0) return {};

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [patients, appointments] = await Promise.all([
      this.prisma.db.patient.groupBy({
        by: ['assignedDoctorId'],
        where: { assignedDoctorId: { in: [...doctorIds] } },
        _count: { _all: true },
      }),
      this.prisma.db.appointment.groupBy({
        by: ['doctorId'],
        where: { doctorId: { in: [...doctorIds] }, startsAt: { gte: since } },
        _count: { _all: true },
      }),
    ]);

    const stats: Record<string, { patientsCount: number; appointments30d: number }> = {};
    for (const id of doctorIds) stats[id] = { patientsCount: 0, appointments30d: 0 };

    for (const row of patients) {
      const id = row.assignedDoctorId;
      if (id === null) continue;
      const entry = stats[id];
      if (entry !== undefined) entry.patientsCount = row._count._all;
    }
    for (const row of appointments) {
      const entry = stats[row.doctorId];
      if (entry !== undefined) entry.appointments30d = row._count._all;
    }

    return stats;
  }

  /**
   * Live appointments from now on — API §3.7's consequence count.
   *
   * From **now**, not from the beginning of time: suspending a doctor
   * cannot disturb an appointment that has already happened, and
   * including past ones would put a number on the confirmation dialog
   * that has nothing to do with the decision being taken.
   */
  upcomingAppointmentCount(doctorId: string): Promise<number> {
    return this.prisma.db.appointment.count({
      where: {
        doctorId,
        startsAt: { gte: new Date() },
        status: { in: [...LIVE_APPOINTMENT_STATUSES] },
      },
    });
  }

  async setVerificationStatus(input: {
    readonly doctorId: string;
    readonly status: DoctorVerificationStatus;
    readonly actorId: string;
    readonly verifiedAt: Date | null;
  }): Promise<{ verificationStatus: DoctorVerificationStatus; verifiedAt: Date | null } | null> {
    // `updateMany` guarded on `deletedAt`, not `update` by id: a doctor
    // soft-deleted between `findById` and this write must not be changed.
    // Null tells the service the row is gone (404), where `update` would
    // have thrown P2025 and answered 500.
    const { count } = await this.prisma.db.doctor.updateMany({
      where: { id: input.doctorId, deletedAt: null },
      data: {
        verificationStatus: input.status,
        verifiedAt: input.verifiedAt,
        // `verified_by` records who took the decision, whichever way it
        // went — a rejection is as much a decision as an approval.
        ...(UUID.test(input.actorId)
          ? { verifiedBy: input.actorId, updatedBy: input.actorId }
          : {}),
      },
    });

    return count === 0
      ? null
      : { verificationStatus: input.status, verifiedAt: input.verifiedAt };
  }

  async setPracticeStatus(input: {
    readonly doctorId: string;
    readonly status: DoctorPracticeStatus;
    readonly actorId: string;
  }): Promise<{ practiceStatus: DoctorPracticeStatus } | null> {
    // Guarded like `setVerificationStatus`: a deleted doctor is not changed.
    const { count } = await this.prisma.db.doctor.updateMany({
      where: { id: input.doctorId, deletedAt: null },
      data: {
        practiceStatus: input.status,
        ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
      },
    });

    return count === 0 ? null : { practiceStatus: input.status };
  }

  /**
   * One live verification document of a given **live** doctor, or null.
   *
   * The relation filter matters: the document routes take a doctor id but
   * never call `findById`, so without it a soft-deleted doctor's
   * documents could still be approved or rejected.
   */
  findDocument(
    doctorId: string,
    documentId: string,
  ): Promise<{ id: string; kind: string; decision: string } | null> {
    if (!UUID.test(doctorId) || !UUID.test(documentId)) return Promise.resolve(null);

    return this.prisma.db.doctorVerificationDocument.findFirst({
      where: { id: documentId, doctorId, deletedAt: null, doctor: { deletedAt: null } },
      select: { id: true, kind: true, decision: true },
    });
  }

  async decideDocument(input: {
    readonly documentId: string;
    readonly decision: 'approved' | 'rejected';
    readonly actorId: string;
    readonly rejectReason?: string | undefined;
    readonly checks?:
      | { readonly authentic: boolean; readonly current: boolean; readonly identityMatch: boolean }
      | undefined;
  }): Promise<boolean> {
    // Guarded on both the document and its doctor being live, so a
    // deletion that lands after `findDocument` changes nothing. False is
    // a 404 to the service.
    const { count } = await this.prisma.db.doctorVerificationDocument.updateMany({
      where: { id: input.documentId, deletedAt: null, doctor: { deletedAt: null } },
      data: {
        decision: input.decision,
        decidedAt: new Date(),
        ...(UUID.test(input.actorId)
          ? { decidedBy: input.actorId, updatedBy: input.actorId }
          : {}),
        // Cleared on approval so a document re-approved after a
        // rejection does not keep the old reason beside a green tick.
        rejectReason: input.rejectReason ?? null,
        ...(input.checks === undefined
          ? {}
          : {
              checkAuthentic: input.checks.authentic,
              checkCurrent: input.checks.current,
              checkIdentityMatch: input.checks.identityMatch,
            }),
      },
    });

    return count > 0;
  }

  /** The `users.id` behind a live doctor — the notification recipient. */
  async userIdFor(doctorId: string): Promise<string | null> {
    if (!UUID.test(doctorId)) return null;

    const doctor = await this.prisma.db.doctor.findFirst({
      where: { id: doctorId, deletedAt: null },
      select: { userId: true },
    });

    return doctor?.userId ?? null;
  }
}

function orderFor(sort: AdminDoctorCriteria['sort']): Prisma.DoctorOrderByWithRelationInput {
  switch (sort) {
    case 'name:desc':
      return { fullName: 'desc' };
    case 'joined:asc':
      return { createdAt: 'asc' };
    case 'joined:desc':
      return { createdAt: 'desc' };
    case 'rating:desc':
      // Nulls last: a practitioner with no survey yet is not the worst
      // rated one, and sorting them to the top of a "best first" list
      // would say they are.
      return { ratingAvg: { sort: 'desc', nulls: 'last' } };
    case 'name:asc':
    default:
      return { fullName: 'asc' };
  }
}
