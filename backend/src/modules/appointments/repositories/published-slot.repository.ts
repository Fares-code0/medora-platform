/**
 * Doctor-published slots and the patient booking that consumes one
 * (DR-10, DR-11, OD-08, OD-09, OD-14 — `API_CONTRACT_CHANGES.md` §6).
 *
 * ## Two tenant shapes, kept apart by method
 *
 * - **The doctor's methods** (`ownSlotsOverlapping`, `insertSlots`,
 *   `listOwn`, `lockOwnSlot`, `withdraw`) run under the request's own
 *   tenant context — `hospital`, the doctor's active employment — and
 *   every one also names that hospital and doctor in its WHERE clause, so
 *   it behaves identically with Row-Level Security on or off.
 * - **The patient's methods** (`patientVisibleDoctor`, `bookableSlots`,
 *   `slotDoctor` and the `*ForBooking` / booking writes) are called by the
 *   services under `runAsSystem`, for the reason given at each call site:
 *   `published_slots`, `doctor_employments`, `doctor_time_off` and
 *   `hospital_insurance_coverage` are organisational rows a `patient`
 *   scope cannot see (`org_visible`), and the appointment-insert trigger
 *   `validate_active_appointment_employment` reads two of them under the
 *   caller's own policies. Every such statement is keyed by the slot id
 *   and the caller's own patient id, and none returns another patient's
 *   data.
 *
 * Soft deletes: a transaction client does not carry the soft-delete
 * extension, so `deletedAt: null` / `deleted_at IS NULL` is spelled out.
 */

import { Injectable } from '@nestjs/common';

import type { AppointmentStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

import { LIVE_STATUSES, type ScheduleTx } from './appointment.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The wire spelling of `LIVE_STATUSES`, for raw SQL (`appointment_status`). */
const LIVE_WIRE = ['scheduled', 'confirmed', 'pending', 'rescheduled', 'awaiting-patient'];

/** How many bookable slots one patient listing returns at most. */
export const BOOKABLE_SLOT_LIMIT = 200;

export interface OwnSlotRow {
  readonly id: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly createdAt: Date;
  readonly withdrawnAt: Date | null;
  /** The live appointment holding the slot, if any. */
  readonly bookedBy: string | null;
}

export interface BookableSlotRow {
  readonly id: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly hospitalId: string;
  readonly hospitalName: string;
  readonly timezone: string;
}

/** A slot as the booking transaction sees it, after locking it. */
export interface LockedSlotRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly doctorEmploymentId: string;
  readonly doctorId: string;
  readonly startsAt: Date;
  readonly durationMinutes: number;
  readonly withdrawnAt: Date | null;
  /** Employment active, hospital ACTIVE, doctor patient-visible. */
  readonly offerable: boolean;
  readonly bufferMin: number;
}

export interface BookedAppointmentRow {
  readonly id: string;
  readonly publicId: string;
  readonly startsAt: Date;
  readonly status: AppointmentStatus;
  readonly priority: string;
  readonly updatedAt: Date;
}

@Injectable()
export class PublishedSlotRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── The doctor's own slots ────────────────────────────────────────────

  /**
   * The doctor's live (not withdrawn) slots at `hospitalId` whose
   * interval, widened by `bufferMin` on both sides, touches `[from, to)`.
   */
  async ownSlotsOverlapping(
    input: {
      readonly doctorId: string;
      readonly hospitalId: string;
      readonly from: Date;
      readonly to: Date;
      readonly bufferMin: number;
    },
    tx: ScheduleTx,
  ): Promise<readonly { id: string; startsAt: Date }[]> {
    const buffer = Math.max(0, input.bufferMin);

    return tx.$queryRaw<{ id: string; startsAt: Date }[]>`
      SELECT s.id::text AS id, s.starts_at AS "startsAt"
        FROM published_slots s
        JOIN doctor_employments e ON e.id = s.doctor_employment_id AND e.hospital_id = s.hospital_id
       WHERE e.doctor_id = ${input.doctorId}::uuid
         AND s.hospital_id = ${input.hospitalId}::uuid
         AND s.withdrawn_at IS NULL
         AND s.starts_at - make_interval(mins => ${buffer}::int) < ${input.to}
         AND s.starts_at + make_interval(mins => s.duration_minutes + ${buffer}::int) > ${input.from}
       ORDER BY s.starts_at`;
  }

  async insertSlots(
    input: {
      readonly hospitalId: string;
      readonly doctorEmploymentId: string;
      readonly slots: readonly { startsAt: Date; durationMin: number }[];
    },
    tx: ScheduleTx,
  ): Promise<readonly OwnSlotRow[]> {
    const created: OwnSlotRow[] = [];
    for (const slot of input.slots) {
      const row = await tx.publishedSlot.create({
        data: {
          hospitalId: input.hospitalId,
          doctorEmploymentId: input.doctorEmploymentId,
          startsAt: slot.startsAt,
          durationMinutes: slot.durationMin,
        },
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          createdAt: true,
          withdrawnAt: true,
        },
      });
      created.push({ ...row, bookedBy: null });
    }

    return created;
  }

  /** The doctor's own slots at `hospitalId`, newest window first by start. */
  async listOwn(criteria: {
    readonly doctorId: string;
    readonly hospitalId: string;
    readonly from: Date | undefined;
    readonly to: Date | undefined;
    readonly page: number;
    readonly pageSize: number;
  }): Promise<{ rows: readonly OwnSlotRow[]; totalItems: number }> {
    const where = {
      hospitalId: criteria.hospitalId,
      employment: { is: { doctorId: criteria.doctorId } },
      ...(criteria.from === undefined && criteria.to === undefined
        ? {}
        : {
            startsAt: {
              ...(criteria.from === undefined ? {} : { gte: criteria.from }),
              ...(criteria.to === undefined ? {} : { lt: criteria.to }),
            },
          }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.publishedSlot.findMany({
        where,
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          createdAt: true,
          withdrawnAt: true,
          appointments: {
            where: { deletedAt: null, status: { in: [...LIVE_STATUSES] } },
            select: { publicId: true },
            take: 1,
          },
        },
        orderBy: { startsAt: 'asc' },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.publishedSlot.count({ where }),
    ]);

    return {
      rows: rows.map(({ appointments, ...row }) => ({
        ...row,
        bookedBy: appointments[0]?.publicId ?? null,
      })),
      totalItems,
    };
  }

  /**
   * Locks one of the doctor's own slots at `hospitalId` (`FOR UPDATE`), or
   * returns `null` when it is not theirs or does not exist — the caller
   * answers both with the same 404.
   */
  async lockOwnSlot(
    input: { readonly slotId: string; readonly doctorId: string; readonly hospitalId: string },
    tx: ScheduleTx,
  ): Promise<{ id: string; withdrawnAt: Date | null } | null> {
    if (!UUID.test(input.slotId)) return null;

    const rows = await tx.$queryRaw<{ id: string; withdrawnAt: Date | null }[]>`
      SELECT s.id::text AS id, s.withdrawn_at AS "withdrawnAt"
        FROM published_slots s
        JOIN doctor_employments e ON e.id = s.doctor_employment_id AND e.hospital_id = s.hospital_id
       WHERE s.id = ${input.slotId}::uuid
         AND s.hospital_id = ${input.hospitalId}::uuid
         AND e.doctor_id = ${input.doctorId}::uuid
         FOR UPDATE OF s`;

    return rows[0] ?? null;
  }

  async withdraw(slotId: string, now: Date, tx: ScheduleTx): Promise<OwnSlotRow> {
    const row = await tx.publishedSlot.update({
      where: { id: slotId },
      data: { withdrawnAt: now },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        createdAt: true,
        withdrawnAt: true,
      },
    });

    return { ...row, bookedBy: null };
  }

  /** One slot already locked by `lockOwnSlot`, as the doctor's view reads it. */
  async ownSlot(slotId: string, tx: ScheduleTx): Promise<OwnSlotRow> {
    const row = await tx.publishedSlot.findUniqueOrThrow({
      where: { id: slotId },
      select: {
        id: true,
        startsAt: true,
        durationMinutes: true,
        createdAt: true,
        withdrawnAt: true,
      },
    });

    return { ...row, bookedBy: null };
  }

  /** The live appointment holding a slot, or `null`. */
  async liveBookingOf(slotId: string, tx: ScheduleTx): Promise<string | null> {
    const row = await tx.appointment.findFirst({
      where: { publishedSlotId: slotId, deletedAt: null, status: { in: [...LIVE_STATUSES] } },
      select: { publicId: true },
    });

    return row?.publicId ?? null;
  }

  // ── Patient discovery and booking (called under `runAsSystem`) ─────────

  /**
   * Whether `doctorId` is a doctor the patient directory shows — the same
   * predicate as `PatientDoctorRepository`'s `PATIENT_VISIBLE`.
   */
  async patientVisibleDoctor(doctorId: string): Promise<boolean> {
    if (!UUID.test(doctorId)) return false;

    const row = await this.prisma.db.doctor.findFirst({
      where: {
        id: doctorId,
        verificationStatus: 'VERIFIED',
        practiceStatus: 'ACTIVE',
        employments: {
          some: { endedAt: null, hospital: { is: { status: 'ACTIVE', deletedAt: null } } },
        },
      },
      select: { id: true },
    });

    return row !== null;
  }

  /**
   * DR-10 — the doctor's bookable inventory: published, not withdrawn,
   * starting after `now`, at an active employment of an ACTIVE hospital,
   * and not occupied — no live appointment on the slot, none of the
   * doctor's live appointments within the buffer of it, and no time off
   * over it. The same three tests the booking transaction re-runs under
   * lock; a listed slot is a snapshot, never a reservation.
   *
   * Projects only slot and hospital fields: never working hours (AST-C6),
   * never another patient's booking.
   */
  // `async` + `await` on purpose: a Prisma query is lazy and runs when it is
  // first awaited. Returned un-awaited from inside `runAsSystem`, it would
  // execute after the system context had ended — under the caller's
  // (patient) scope, where RLS hides every slot.
  async bookableSlots(criteria: {
    readonly doctorId: string;
    readonly from: Date;
    readonly to: Date | undefined;
  }): Promise<readonly BookableSlotRow[]> {
    const to = criteria.to ?? new Date('9999-12-31T00:00:00Z');

    return await this.prisma.$queryRaw<BookableSlotRow[]>`
      SELECT s.id::text AS id, s.starts_at AS "startsAt", s.duration_minutes AS "durationMinutes",
             h.id::text AS "hospitalId", h.name AS "hospitalName", h.timezone AS timezone
        FROM published_slots s
        JOIN doctor_employments e ON e.id = s.doctor_employment_id AND e.hospital_id = s.hospital_id
        JOIN hospitals h ON h.id = s.hospital_id
        JOIN doctors d ON d.id = e.doctor_id
       WHERE e.doctor_id = ${criteria.doctorId}::uuid
         AND e.ended_at IS NULL
         AND h.status = 'ACTIVE' AND h.deleted_at IS NULL
         AND d.deleted_at IS NULL
         AND s.withdrawn_at IS NULL
         AND s.starts_at > now()
         AND s.starts_at >= ${criteria.from}
         AND s.starts_at < ${to}
         AND NOT EXISTS (
               SELECT 1 FROM appointments a
                WHERE a.published_slot_id = s.id AND a.deleted_at IS NULL
                  AND a.status::text = ANY(${LIVE_WIRE}::text[]))
         AND NOT EXISTS (
               SELECT 1 FROM appointments a
                WHERE a.doctor_id = d.id AND a.deleted_at IS NULL
                  AND a.status::text = ANY(${LIVE_WIRE}::text[])
                  AND a.starts_at - make_interval(mins => d.buffer_min) < s.starts_at + make_interval(mins => s.duration_minutes)
                  AND a.starts_at + make_interval(mins => a.duration_min + d.buffer_min) > s.starts_at)
         AND NOT EXISTS (
               SELECT 1 FROM doctor_time_off t
                WHERE t.doctor_id = d.id
                  AND t.starts_at < s.starts_at + make_interval(mins => s.duration_minutes)
                  AND t.ends_at > s.starts_at)
       ORDER BY s.starts_at
       LIMIT ${BOOKABLE_SLOT_LIMIT}`;
  }

  /** The doctor a slot belongs to — read before the lock, to know whose lock. */
  async slotDoctor(slotId: string): Promise<string | null> {
    if (!UUID.test(slotId)) return null;

    const rows = await this.prisma.$queryRaw<{ doctorId: string }[]>`
      SELECT e.doctor_id::text AS "doctorId"
        FROM published_slots s
        JOIN doctor_employments e ON e.id = s.doctor_employment_id AND e.hospital_id = s.hospital_id
       WHERE s.id = ${slotId}::uuid`;

    return rows[0]?.doctorId ?? null;
  }

  /**
   * Locks the slot row for the booking (`FOR UPDATE OF s`). Concurrent
   * bookings — and a concurrent withdrawal — queue here; each re-reads the
   * slot as the previous holder committed it.
   */
  async lockSlotForBooking(slotId: string, tx: ScheduleTx): Promise<LockedSlotRow | null> {
    const rows = await tx.$queryRaw<LockedSlotRow[]>`
      SELECT s.id::text AS id, s.hospital_id::text AS "hospitalId",
             s.doctor_employment_id::text AS "doctorEmploymentId", e.doctor_id::text AS "doctorId",
             s.starts_at AS "startsAt", s.duration_minutes AS "durationMinutes",
             s.withdrawn_at AS "withdrawnAt", d.buffer_min AS "bufferMin",
             (e.ended_at IS NULL AND h.status = 'ACTIVE' AND h.deleted_at IS NULL
              AND d.deleted_at IS NULL
              AND d.verification_status::text = 'verified' AND d.practice_status::text = 'active') AS offerable
        FROM published_slots s
        JOIN doctor_employments e ON e.id = s.doctor_employment_id AND e.hospital_id = s.hospital_id
        JOIN hospitals h ON h.id = s.hospital_id
        JOIN doctors d ON d.id = e.doctor_id
       WHERE s.id = ${slotId}::uuid
         FOR UPDATE OF s`;

    return rows[0] ?? null;
  }

  /**
   * OD-14 — the patient's active insurance on `onDate`, or `null`
   * (uninsured). Active means flagged active, not deleted, and not
   * expired by the slot's date.
   */
  async activeInsuranceProvider(
    patientId: string,
    onDate: Date,
    tx: ScheduleTx,
  ): Promise<string | null> {
    const row = await tx.patientInsurance.findFirst({
      where: {
        patientId,
        isActive: true,
        deletedAt: null,
        OR: [{ validUntil: null }, { validUntil: { gte: startOfUtcDay(onDate) } }],
      },
      select: { providerId: true },
    });

    return row?.providerId ?? null;
  }

  /** OD-14 — whether `hospitalId` accepts `providerId` on `onDate`. */
  async hospitalCovers(
    hospitalId: string,
    providerId: string,
    onDate: Date,
    tx: ScheduleTx,
  ): Promise<boolean> {
    const day = startOfUtcDay(onDate);
    const row = await tx.hospitalInsuranceCoverage.findFirst({
      where: {
        hospitalId,
        providerId,
        active: true,
        provider: { is: { active: true } },
        AND: [
          { OR: [{ startsOn: null }, { startsOn: { lte: day } }] },
          { OR: [{ endsOn: null }, { endsOn: { gte: day } }] },
        ],
      },
      select: { id: true },
    });

    return row !== null;
  }

  /**
   * OD-09 — the patient's Hospital Medical Record at `hospitalId`, opened
   * now if this is their first interaction with that hospital. `ON
   * CONFLICT DO NOTHING` on the `(patient_id, hospital_id)` key, so two
   * concurrent first bookings at one hospital open one record, not an
   * error.
   */
  async ensureRecord(
    patientId: string,
    hospitalId: string,
    tx: ScheduleTx,
  ): Promise<{ id: string; created: boolean }> {
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO hospital_medical_records (patient_id, hospital_id, created_at, updated_at)
      VALUES (${patientId}::uuid, ${hospitalId}::uuid, now(), now())
      ON CONFLICT (patient_id, hospital_id) DO NOTHING
      RETURNING id::text AS id`;
    if (inserted[0] !== undefined) return { id: inserted[0].id, created: true };

    const existing = await tx.hospitalMedicalRecord.findFirstOrThrow({
      where: { patientId, hospitalId },
      select: { id: true },
    });

    return { id: existing.id, created: false };
  }

  /**
   * The caller's own `patients.id` from the `PT-…` reference the self
   * scope resolved from the session. Read under the request's own
   * (`patient`) scope, where the caller's row is visible.
   */
  async patientUuid(publicId: string): Promise<string | null> {
    const row = await this.prisma.db.patient.findFirst({
      where: { publicId },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /** The visit type a booking that names none is recorded as. */
  async defaultVisitTypeId(): Promise<string | null> {
    const row = await this.prisma.db.visitType.findFirst({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true },
    });

    return row?.id ?? null;
  }

  async activeVisitType(id: string): Promise<boolean> {
    const row = await this.prisma.db.visitType.findFirst({
      where: { id, active: true },
      select: { id: true },
    });

    return row !== null;
  }

  /**
   * The appointment and its `created` event, stamped from the slot. The
   * partial unique `appointments_one_active_booking_per_slot` and the
   * `appointments_no_overlap` exclusion are the final guards; the caller
   * maps their violations to `409 slot_taken`.
   */
  async insertBooking(
    input: {
      readonly publicId: string;
      readonly slot: LockedSlotRow;
      readonly patientId: string;
      readonly hospitalMedicalRecordId: string;
      readonly departmentId: string | null;
      readonly visitTypeId: string;
      readonly reason: string;
      readonly notes: string | null;
      readonly isNewPatient: boolean;
      readonly actorId: string;
      readonly actorName: string;
    },
    tx: ScheduleTx,
  ): Promise<BookedAppointmentRow> {
    const created = await tx.appointment.create({
      data: {
        publicId: input.publicId,
        patientId: input.patientId,
        doctorId: input.slot.doctorId,
        hospitalId: input.slot.hospitalId,
        hospitalMedicalRecordId: input.hospitalMedicalRecordId,
        doctorEmploymentId: input.slot.doctorEmploymentId,
        publishedSlotId: input.slot.id,
        departmentId: input.departmentId,
        visitTypeId: input.visitTypeId,
        startsAt: input.slot.startsAt,
        durationMin: input.slot.durationMinutes,
        status: 'SCHEDULED',
        priority: 'NORMAL',
        reason: input.reason,
        notes: input.notes,
        isNewPatient: input.isNewPatient,
        isFollowUp: false,
        ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
      },
      select: {
        id: true,
        publicId: true,
        startsAt: true,
        status: true,
        priority: true,
        updatedAt: true,
      },
    });

    await tx.appointmentEvent.create({
      data: {
        appointmentId: created.id,
        action: 'CREATED',
        toStatus: 'SCHEDULED',
        ...(UUID.test(input.actorId) ? { actorId: input.actorId } : {}),
        actorName: input.actorName,
      },
    });

    return created;
  }
}

function startOfUtcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}
