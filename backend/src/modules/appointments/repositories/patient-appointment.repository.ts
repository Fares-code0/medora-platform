/**
 * A patient's own appointments (contract §4.1/§4.2).
 *
 * ## Ownership is a WHERE clause, not a check
 *
 * Every query is scoped by `patientId` resolved from the caller's token,
 * and there is no code path that reads an appointment without it. That
 * matters more than an equivalent-looking `if` after the fetch: a filter
 * cannot be forgotten by a later caller, and a row that is not the
 * caller's is never loaded into memory in the first place.
 *
 * `@@index([patientId, startsAt(sort: Desc)])` on `appointments` is
 * exactly this access pattern, so the scoping is also the fast path.
 *
 * The `select` clauses are explicit and never spread — the embedded
 * doctor is the patient-safe projection of contract §3, so a widened
 * select here would leak a practitioner's licence number through the
 * appointments route instead of the doctors one.
 *
 * Soft deletes are handled globally by M4.2's client extension.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { AppointmentStatus } from '../../../generated/prisma/enums';

export interface AppointmentCriteria {
  readonly status?: readonly AppointmentStatus[] | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly sort: 'startsAt:asc' | 'startsAt:desc';
  readonly page: number;
  readonly pageSize: number;
}

/** The doctor columns a patient may see. Mirrors contract §3's projection. */
const DOCTOR_SELECT = {
  id: true,
  fullName: true,
  title: true,
  specialty: true,
  photoUrl: true,
} as const;

const SUMMARY_SELECT = {
  id: true,
  hospitalId: true,
  publicId: true,
  startsAt: true,
  durationMin: true,
  status: true,
  priority: true,
  reason: true,
  isNewPatient: true,
  isFollowUp: true,
  doctor: { select: DOCTOR_SELECT },
  department: { select: { name: true } },
  visitType: { select: { name: true } },
} as const;

@Injectable()
export class PatientAppointmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listOwn(
    patientPublicId: string,
    criteria: AppointmentCriteria,
  ): Promise<{ rows: readonly SummaryRow[]; totalItems: number }> {
    const where = {
      // The public `PT-…` handle, which is what the scope service returns.
      patient: { publicId: patientPublicId },
      ...(criteria.status === undefined || criteria.status.length === 0
        ? {}
        : { status: { in: [...criteria.status] } }),
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            startsAt: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lte: criteria.to }),
            },
          }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.appointment.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: { startsAt: criteria.sort === 'startsAt:asc' ? 'asc' : 'desc' },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.appointment.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * One appointment, scoped to its owner.
   *
   * `patientPublicId` is part of the WHERE rather than checked after, so
   * "someone else's appointment" and "no such appointment" produce the
   * identical `null` — which the caller turns into the identical 404. A
   * separate answer for the second would let a patient walk
   * `APT-3001, APT-3002, …` and learn the clinic's booking volume without
   * reading a single appointment.
   */
  async findOwn(patientPublicId: string, appointmentPublicId: string): Promise<DetailRow | null> {
    return this.prisma.db.appointment.findFirst({
      where: { publicId: appointmentPublicId, patient: { publicId: patientPublicId } },
      select: {
        ...SUMMARY_SELECT,
        notes: true,
        cancelledReason: true,
        events: {
          select: {
            action: true,
            fromStatus: true,
            toStatus: true,
            occurredAt: true,
            reason: true,
            // `actorId` only — never `actorName`. The projection turns it
            // into a coarse category, and a name would make an
            // appointment history a staff directory.
            actorId: true,
            actor: { select: { role: { select: { code: true } } } },
          },
          orderBy: { occurredAt: 'desc' },
        },
      },
    });
  }
}

export interface SummaryRow {
  /** Internal; never projected — used to join reschedule requests. */
  readonly id: string;
  readonly hospitalId: string | null;
  readonly publicId: string;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly status: string;
  readonly priority: string;
  readonly reason: string;
  readonly isNewPatient: boolean;
  readonly isFollowUp: boolean;
  readonly doctor: {
    readonly id: string;
    readonly fullName: string;
    readonly title: string | null;
    readonly specialty: string;
    readonly photoUrl: string | null;
  };
  readonly department: { readonly name: string } | null;
  readonly visitType: { readonly name: string };
}

export interface DetailRow extends SummaryRow {
  readonly notes: string | null;
  readonly cancelledReason: string | null;
  readonly events: readonly {
    readonly action: string;
    readonly fromStatus: string | null;
    readonly toStatus: string | null;
    readonly occurredAt: Date;
    readonly reason: string | null;
    readonly actorId: string | null;
    readonly actor: { readonly role: { readonly code: string } } | null;
  }[];
}
