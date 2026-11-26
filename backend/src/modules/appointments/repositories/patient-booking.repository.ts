/**
 * Patient booking, cancellation and reschedule requests (ADR-049).
 *
 * ## Which tenant context each operation runs under
 *
 * A patient request runs under the `patient` RLS scope: its own rows only.
 * That is enough for reading and cancelling its own appointments and for
 * filing or withdrawing a reschedule request (the new table's policies
 * follow the parent appointment). Two things are not:
 *
 *  - **Published slots** are organisational rows of a hospital, invisible
 *    to a patient scope. The slot reads here are trusted server-side
 *    lookups — filtered in their WHERE to the doctor and slot the caller
 *    named — and run under `system`, exactly as the patient doctor
 *    directory does (`PatientDoctorRepository`).
 *  - **The booking transaction** writes into one hospital's book: it locks
 *    that hospital's slot and the doctor's employment (the phase-21 trigger
 *    reads both `FOR UPDATE`), opens the patient's Hospital Medical Record
 *    there, and inserts the appointment. It runs under the `hospital` scope
 *    of **the slot's own hospital** — the narrowest scope in which those
 *    statements are visible — never `system`, and every statement in it is
 *    keyed to the slot and the caller's own patient row.
 *
 * ## Capacity one, enforced by the database
 *
 * The slot row is locked first, then checked for a live holder; the
 * insert is then guarded by `appointments_one_live_booking_per_slot` (and
 * the older `…_one_active_booking_per_slot`). N concurrent bookings of one
 * slot therefore produce one appointment, and every other request either
 * sees the holder after the lock or loses on the unique index.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import type { AppointmentStatus } from '../../../generated/prisma/enums';
import { PrismaService, runAsSystem, runWithTenantContext } from '../../../shared/database';

import type { RescheduleRequestStatus } from '../services/patient-appointment.policy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The statuses that hold a published slot (mirrors the ADR-049 index). */
export const SLOT_HOLDING_STATUSES: readonly AppointmentStatus[] = [
  'PENDING',
  'SCHEDULED',
  'CONFIRMED',
  'RESCHEDULED',
  'AWAITING_PATIENT',
];

type Tx = Prisma.TransactionClient;

export interface SlotRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly hospitalName: string;
  readonly doctorEmploymentId: string;
  readonly doctorId: string;
  readonly doctorDepartmentId: string | null;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly withdrawn: boolean;
  /** Doctor patient-visible, employment active, hospital active. */
  readonly bookable: boolean;
}

export interface ActionAppointmentRow {
  readonly id: string;
  readonly publicId: string;
  readonly patientId: string;
  readonly doctorId: string;
  readonly status: AppointmentStatus;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly hospitalId: string | null;
  readonly doctorEmploymentId: string | null;
  readonly publishedSlotId: string | null;
  readonly updatedAt: Date;
  readonly patient: { readonly publicId: string };
}

export interface RequestRow {
  readonly id: string;
  readonly appointmentId: string;
  readonly appointmentPublicId: string;
  readonly hospitalId: string;
  readonly doctorEmploymentId: string;
  readonly requestedSlotId: string;
  readonly status: RescheduleRequestStatus;
  readonly note: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
}

export interface SlotTiming {
  readonly id: string;
  readonly startsAt: Date;
  readonly durationMin: number;
}

/** Why a booking or a move could not take the slot. */
export class SlotUnavailable extends Error {
  constructor(readonly reason: 'taken' | 'withdrawn' | 'started' | 'unbookable') {
    super(`slot ${reason}`);
  }
}

const ACTION_SELECT = {
  id: true,
  publicId: true,
  patientId: true,
  doctorId: true,
  status: true,
  startsAt: true,
  durationMin: true,
  hospitalId: true,
  doctorEmploymentId: true,
  publishedSlotId: true,
  updatedAt: true,
  patient: { select: { publicId: true } },
} as const;

const REQUEST_SELECT = {
  id: true,
  appointmentId: true,
  hospitalId: true,
  doctorEmploymentId: true,
  requestedSlotId: true,
  status: true,
  note: true,
  decisionReason: true,
  createdAt: true,
  decidedAt: true,
  appointment: { select: { publicId: true } },
} as const;

type RawRequest = Omit<RequestRow, 'appointmentPublicId' | 'status'> & {
  readonly status: string;
  readonly appointment: { readonly publicId: string };
};

function toRequestRow(row: RawRequest): RequestRow {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    appointmentPublicId: row.appointment.publicId,
    hospitalId: row.hospitalId,
    doctorEmploymentId: row.doctorEmploymentId,
    requestedSlotId: row.requestedSlotId,
    status: row.status as RescheduleRequestStatus,
    note: row.note,
    decisionReason: row.decisionReason,
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
  };
}

@Injectable()
export class PatientBookingRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lookups that decide, under `system` (see header) ─────────────────

  /** One published slot with everything bookability depends on. */
  async slot(slotId: string): Promise<SlotRow | null> {
    if (!UUID.test(slotId)) return null;

    const row = await runAsSystem(
      async () =>
        await this.prisma.publishedSlot.findUnique({
          where: { id: slotId },
          select: {
            id: true,
            hospitalId: true,
            doctorEmploymentId: true,
            startsAt: true,
            durationMinutes: true,
            withdrawnAt: true,
            hospital: { select: { name: true, status: true, deletedAt: true } },
            employment: {
              select: {
                doctorId: true,
                endedAt: true,
                doctor: {
                  select: {
                    departmentId: true,
                    verificationStatus: true,
                    practiceStatus: true,
                    deletedAt: true,
                  },
                },
              },
            },
          },
        }),
    );
    if (row === null) return null;

    const doctor = row.employment.doctor;
    return {
      id: row.id,
      hospitalId: row.hospitalId,
      hospitalName: row.hospital.name,
      doctorEmploymentId: row.doctorEmploymentId,
      doctorId: row.employment.doctorId,
      doctorDepartmentId: doctor.departmentId,
      startsAt: row.startsAt,
      durationMin: row.durationMinutes,
      withdrawn: row.withdrawnAt !== null,
      bookable:
        row.employment.endedAt === null &&
        row.hospital.status === 'ACTIVE' &&
        row.hospital.deletedAt === null &&
        doctor.deletedAt === null &&
        doctor.verificationStatus === 'VERIFIED' &&
        doctor.practiceStatus === 'ACTIVE',
    };
  }

  /**
   * A doctor's bookable slots in a window: published, not withdrawn, in
   * the future, not held by a live booking, under an active employment at
   * an active hospital, for a patient-visible doctor.
   */
  async bookableSlots(
    doctorId: string,
    from: Date,
    to: Date,
  ): Promise<readonly { id: string; startsAt: Date; durationMin: number; hospital: { id: string; name: string } }[]> {
    if (!UUID.test(doctorId)) return [];

    const rows = await runAsSystem(
      async () =>
        await this.prisma.publishedSlot.findMany({
          where: {
            withdrawnAt: null,
            startsAt: { gte: from, lte: to },
            hospital: { is: { status: 'ACTIVE', deletedAt: null } },
            employment: {
              is: {
                doctorId,
                endedAt: null,
                doctor: {
                  is: { deletedAt: null, verificationStatus: 'VERIFIED', practiceStatus: 'ACTIVE' },
                },
              },
            },
            appointments: { none: { status: { in: [...SLOT_HOLDING_STATUSES] } } },
          },
          select: {
            id: true,
            startsAt: true,
            durationMinutes: true,
            hospital: { select: { id: true, name: true } },
          },
          orderBy: { startsAt: 'asc' },
          take: 500,
        }),
    );

    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt,
      durationMin: row.durationMinutes,
      hospital: row.hospital,
    }));
  }

  /** The timing of several slots, for request views. */
  async slotTimings(slotIds: readonly string[]): Promise<ReadonlyMap<string, SlotTiming>> {
    if (slotIds.length === 0) return new Map();
    const rows = await runAsSystem(
      async () =>
        await this.prisma.publishedSlot.findMany({
          where: { id: { in: [...new Set(slotIds)] } },
          select: { id: true, startsAt: true, durationMinutes: true },
        }),
    );
    return new Map(rows.map((row) => [row.id, { id: row.id, startsAt: row.startsAt, durationMin: row.durationMinutes }]));
  }

  /** Whether a slot is held by a live booking other than `exceptAppointmentId`. */
  async slotHeld(slotId: string, exceptAppointmentId?: string): Promise<boolean> {
    const holder = await runAsSystem(
      async () =>
        await this.prisma.appointment.findFirst({
          where: {
            publishedSlotId: slotId,
            status: { in: [...SLOT_HOLDING_STATUSES] },
            ...(exceptAppointmentId === undefined ? {} : { NOT: { id: exceptAppointmentId } }),
          },
          select: { id: true },
        }),
    );
    return holder !== null;
  }

  /** Active visit types, in catalogue order. */
  async visitTypes(): Promise<readonly { id: string; name: string; defaultDurationMin: number | null }[]> {
    return this.prisma.db.visitType.findMany({
      where: { active: true },
      select: { id: true, name: true, defaultDurationMin: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    });
  }

  /** An active visit type by id, or the catalogue's default (`CONSULT`). */
  async visitTypeId(id: string | undefined): Promise<string | null> {
    const row = await this.prisma.db.visitType.findFirst({
      where: id === undefined ? { code: 'CONSULT', active: true } : { id, active: true },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** The patient's row id behind a `PT-…` handle, and the account's display name. */
  async patient(publicId: string, userId: string): Promise<{ id: string; actorName: string } | null> {
    const [patient, user] = await Promise.all([
      this.prisma.db.patient.findFirst({ where: { publicId }, select: { id: true } }),
      UUID.test(userId)
        ? this.prisma.db.user.findUnique({ where: { id: userId }, select: { displayName: true, publicId: true } })
        : Promise.resolve(null),
    ]);
    if (patient === null) return null;
    return { id: patient.id, actorName: user?.displayName ?? user?.publicId ?? 'Patient' };
  }

  /**
   * OD-14: an insured patient (an active, unexpired `patient_insurance`)
   * may book only where the hospital covers that provider today. Returns
   * `null` for an uninsured patient (no check), else whether it is covered.
   */
  async insuranceCovered(patientId: string, hospitalId: string, today: Date): Promise<boolean | null> {
    return runAsSystem(async () => {
      const insurance = await this.prisma.patientInsurance.findFirst({
        where: {
          patientId,
          isActive: true,
          deletedAt: null,
          OR: [{ validUntil: null }, { validUntil: { gte: today } }],
        },
        select: { providerId: true },
      });
      if (insurance === null) return null;

      const coverage = await this.prisma.hospitalInsuranceCoverage.findFirst({
        where: {
          hospitalId,
          providerId: insurance.providerId,
          active: true,
          AND: [
            { OR: [{ startsOn: null }, { startsOn: { lte: today } }] },
            { OR: [{ endsOn: null }, { endsOn: { gte: today } }] },
          ],
        },
        select: { id: true },
      });
      return coverage !== null;
    });
  }

  // ── Booking ──────────────────────────────────────────────────────────

  /**
   * Books `slot` for the patient: one transaction under the slot hospital's
   * scope (see header). Throws `SlotUnavailable` when the slot cannot be
   * taken; a lost race on the unique index surfaces as Prisma's P2002.
   */
  async book(input: {
    readonly slot: SlotRow;
    readonly patientId: string;
    readonly userId: string;
    readonly actorName: string;
    readonly visitTypeId: string;
    readonly reason: string;
    readonly notes: string | null;
  }): Promise<{ appointmentId: string; publicId: string; hospitalCreated: boolean }> {
    const { slot } = input;

    return runWithTenantContext(
      { scope: 'hospital', hospitalId: slot.hospitalId, userId: input.userId, patientId: input.patientId },
      async () =>
        await this.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT set_config('lock_timeout', '5000', true)`;
            // BE-1's per-doctor lock, taken first, so a doctor-side booking
            // and this one serialise on the same row.
            await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${slot.doctorId}::uuid FOR NO KEY UPDATE`;
            await this.lockSlot(tx, slot.id, slot.doctorEmploymentId);
            await this.assertSlotFree(tx, slot);

            const inserted = await tx.$queryRaw<{ id: string }[]>`
              INSERT INTO hospital_medical_records (patient_id, hospital_id, updated_at)
              VALUES (${input.patientId}::uuid, ${slot.hospitalId}::uuid, now())
              ON CONFLICT (patient_id, hospital_id) DO NOTHING
              RETURNING id::text AS id`;
            const record =
              inserted[0] ??
              (await tx.hospitalMedicalRecord.findUniqueOrThrow({
                where: { patientId_hospitalId: { patientId: input.patientId, hospitalId: slot.hospitalId } },
                select: { id: true },
              }));

            const sequence = await tx.$queryRaw<{ value: bigint }[]>`
              SELECT nextval('appointment_reference_seq') AS value`;
            const publicId = `APT-${String(sequence[0]?.value ?? 3000)}`;

            const created = await tx.appointment.create({
              data: {
                publicId,
                patientId: input.patientId,
                doctorId: slot.doctorId,
                departmentId: slot.doctorDepartmentId,
                visitTypeId: input.visitTypeId,
                startsAt: slot.startsAt,
                durationMin: slot.durationMin,
                status: 'PENDING',
                reason: input.reason,
                notes: input.notes,
                isNewPatient: inserted.length > 0,
                hospitalId: slot.hospitalId,
                hospitalMedicalRecordId: record.id,
                doctorEmploymentId: slot.doctorEmploymentId,
                publishedSlotId: slot.id,
                ...(UUID.test(input.userId) ? { createdBy: input.userId } : {}),
              },
              select: { id: true, publicId: true },
            });

            await tx.appointmentEvent.create({
              data: {
                appointmentId: created.id,
                action: 'CREATED',
                toStatus: 'PENDING',
                ...(UUID.test(input.userId) ? { actorId: input.userId } : {}),
                actorName: input.actorName,
              },
            });

            return { appointmentId: created.id, publicId: created.publicId, hospitalCreated: inserted.length > 0 };
          },
          { maxWait: 5_000, timeout: 15_000 },
        ),
    );
  }

  /** Locks the slot row and re-reads it; refuses a withdrawn or started slot. */
  private async lockSlot(tx: Tx, slotId: string, employmentId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ withdrawn: boolean; started: boolean }[]>`
      SELECT withdrawn_at IS NOT NULL AS withdrawn, starts_at <= now() AS started
        FROM published_slots
       WHERE id = ${slotId}::uuid AND doctor_employment_id = ${employmentId}::uuid
       FOR UPDATE`;
    const row = rows[0];
    if (row === undefined) throw new SlotUnavailable('unbookable');
    if (row.withdrawn) throw new SlotUnavailable('withdrawn');
    if (row.started) throw new SlotUnavailable('started');
  }

  /**
   * Under the slot lock: no live booking holds the slot, and no live
   * booking of the doctor overlaps its interval (a doctor-side booking
   * made outside the published grid).
   */
  private async assertSlotFree(tx: Tx, slot: SlotRow, exceptAppointmentId?: string): Promise<void> {
    const except = exceptAppointmentId ?? '00000000-0000-0000-0000-000000000000';
    const end = new Date(slot.startsAt.getTime() + slot.durationMin * 60_000);
    const holders = await tx.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM appointments
       WHERE id <> ${except}::uuid
         AND deleted_at IS NULL
         AND status::text IN ('pending', 'scheduled', 'confirmed', 'rescheduled', 'awaiting-patient')
         AND (published_slot_id = ${slot.id}::uuid
              OR (doctor_id = ${slot.doctorId}::uuid
                  AND starts_at < ${end}
                  AND starts_at + make_interval(mins => duration_min) > ${slot.startsAt}))
       LIMIT 1`;
    if (holders.length > 0) throw new SlotUnavailable('taken');
  }

  // ── The caller's own appointment ──────────────────────────────────────

  /** One appointment, scoped to its owner in the WHERE. */
  ownAppointment(patientPublicId: string, appointmentPublicId: string): Promise<ActionAppointmentRow | null> {
    return this.prisma.db.appointment.findFirst({
      where: { publicId: appointmentPublicId, patient: { publicId: patientPublicId } },
      select: ACTION_SELECT,
    });
  }

  /**
   * Patient cancellation: compare-and-set the status, write the event, and
   * supersede a pending reschedule request — one transaction.
   */
  async cancel(input: {
    readonly appointment: ActionAppointmentRow;
    readonly userId: string;
    readonly actorName: string;
    readonly cancelledReason: string;
    readonly reasonCode: string;
  }): Promise<boolean> {
    const { appointment } = input;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.updateMany({
        where: { id: appointment.id, status: appointment.status, startsAt: { gt: new Date() } },
        data: {
          status: 'CANCELLED',
          cancelledReason: input.cancelledReason,
          ...(UUID.test(input.userId) ? { updatedBy: input.userId } : {}),
        },
      });
      if (updated.count === 0) return false;

      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          action: 'CANCEL',
          fromStatus: appointment.status,
          toStatus: 'CANCELLED',
          ...(UUID.test(input.userId) ? { actorId: input.userId } : {}),
          actorName: input.actorName,
          reason: input.cancelledReason,
          detail: { by: 'patient', reasonCode: input.reasonCode },
        },
      });

      await tx.appointmentRescheduleRequest.updateMany({
        where: { appointmentId: appointment.id, status: 'pending' },
        data: { status: 'superseded', decidedAt: new Date() },
      });
      // The clinic's outstanding proposal, if any, is moot as well.
      await tx.appointmentRescheduleProposal.updateMany({
        where: { appointmentId: appointment.id, status: 'pending' },
        data: { status: 'expired' },
      });
      return true;
    });
  }

  // ── Reschedule requests ───────────────────────────────────────────────

  async hasPendingRequest(appointmentId: string): Promise<boolean> {
    const row = await this.prisma.db.appointmentRescheduleRequest.findFirst({
      where: { appointmentId, status: 'pending' },
      select: { id: true },
    });
    return row !== null;
  }

  /** Files a request; a second pending one loses on the partial unique index (P2002). */
  async createRequest(input: {
    readonly appointmentId: string;
    readonly hospitalId: string;
    readonly doctorEmploymentId: string;
    readonly slotId: string;
    readonly userId: string;
    readonly note: string | null;
  }): Promise<RequestRow> {
    const row = await this.prisma.db.appointmentRescheduleRequest.create({
      data: {
        appointmentId: input.appointmentId,
        hospitalId: input.hospitalId,
        doctorEmploymentId: input.doctorEmploymentId,
        requestedSlotId: input.slotId,
        note: input.note,
        ...(UUID.test(input.userId) ? { requestedBy: input.userId } : {}),
      },
      select: REQUEST_SELECT,
    });
    return toRequestRow(row);
  }

  /**
   * Marks pending requests whose appointment has started, or left the
   * reschedulable statuses, `superseded` — lazily, before they are read.
   */
  async supersedeStale(where: { appointmentIds?: readonly string[]; hospitalId?: string }): Promise<void> {
    await this.prisma.db.appointmentRescheduleRequest.updateMany({
      where: {
        status: 'pending',
        ...(where.appointmentIds === undefined ? {} : { appointmentId: { in: [...where.appointmentIds] } }),
        ...(where.hospitalId === undefined ? {} : { hospitalId: where.hospitalId }),
        appointment: {
          OR: [
            { startsAt: { lte: new Date() } },
            { status: { notIn: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED'] } },
          ],
        },
      },
      data: { status: 'superseded', decidedAt: new Date() },
    });
  }

  async requestsFor(appointmentId: string): Promise<readonly RequestRow[]> {
    const rows = await this.prisma.db.appointmentRescheduleRequest.findMany({
      where: { appointmentId },
      select: REQUEST_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toRequestRow);
  }

  async pendingRequestFor(appointmentId: string): Promise<RequestRow | null> {
    const row = await this.prisma.db.appointmentRescheduleRequest.findFirst({
      where: { appointmentId, status: 'pending' },
      select: REQUEST_SELECT,
    });
    return row === null ? null : toRequestRow(row);
  }

  /** A request of the caller's own, scoped in the WHERE. */
  async ownRequest(patientPublicId: string, requestId: string): Promise<RequestRow | null> {
    if (!UUID.test(requestId)) return null;
    const row = await this.prisma.db.appointmentRescheduleRequest.findFirst({
      where: { id: requestId, appointment: { patient: { publicId: patientPublicId } } },
      select: REQUEST_SELECT,
    });
    return row === null ? null : toRequestRow(row);
  }

  /** pending → withdrawn, compare-and-set. */
  async withdraw(requestId: string): Promise<RequestRow | null> {
    const updated = await this.prisma.db.appointmentRescheduleRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status: 'withdrawn', decidedAt: new Date() },
    });
    if (updated.count === 0) return null;
    const row = await this.prisma.db.appointmentRescheduleRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: REQUEST_SELECT,
    });
    return toRequestRow(row);
  }

  // ── Staff side ────────────────────────────────────────────────────────

  /** Requests for a doctor's own book (current employment only), by status. */
  async requestsForDoctor(doctorId: string, status: RescheduleRequestStatus): Promise<readonly RequestRow[]> {
    const rows = await this.prisma.db.appointmentRescheduleRequest.findMany({
      where: {
        status,
        appointment: { doctorId, deletedAt: null, doctorEmployment: { is: { endedAt: null } } },
      },
      select: REQUEST_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map(toRequestRow);
  }

  /** One request on the doctor's own book, or null (→ 404). */
  async requestForDoctor(doctorId: string, requestId: string): Promise<RequestRow | null> {
    if (!UUID.test(requestId)) return null;
    const row = await this.prisma.db.appointmentRescheduleRequest.findFirst({
      where: {
        id: requestId,
        appointment: { doctorId, deletedAt: null, doctorEmployment: { is: { endedAt: null } } },
      },
      select: REQUEST_SELECT,
    });
    return row === null ? null : toRequestRow(row);
  }

  /**
   * Approval: one transaction. Locks the doctor, the request (still
   * pending), the appointment and the requested slot; re-checks the slot is
   * free; moves the SAME appointment row onto it with status `rescheduled`;
   * writes the event; marks the request approved.
   *
   * Returns `'not_pending'` / `'stale'` for the caller to translate, and
   * throws `SlotUnavailable` (the request stays pending: the transaction
   * rolls back).
   */
  async approve(input: {
    readonly requestId: string;
    readonly doctorId: string;
    readonly slot: SlotRow;
    readonly assertMovable: (appointment: ActionAppointmentRow) => void;
    readonly userId: string;
    readonly actorName: string;
  }): Promise<
    | { kind: 'approved'; appointment: ActionAppointmentRow; previousStartsAt: Date }
    | { kind: 'not_pending' }
    | { kind: 'stale' }
  > {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', '5000', true)`;
        await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${input.doctorId}::uuid FOR NO KEY UPDATE`;
        const locked = await tx.$queryRaw<{ status: string; appointment_id: string }[]>`
          SELECT status, appointment_id::text AS appointment_id FROM appointment_reschedule_requests
           WHERE id = ${input.requestId}::uuid FOR UPDATE`;
        const request = locked[0];
        if (request === undefined || request.status !== 'pending') return { kind: 'not_pending' as const };

        await tx.$queryRaw`SELECT id FROM appointments WHERE id = ${request.appointment_id}::uuid FOR UPDATE`;
        const appointment = await tx.appointment.findUniqueOrThrow({
          where: { id: request.appointment_id },
          select: ACTION_SELECT,
        });
        input.assertMovable(appointment);

        await this.lockSlot(tx, input.slot.id, input.slot.doctorEmploymentId);
        await this.assertSlotFree(tx, input.slot, appointment.id);

        const updated = await tx.appointment.updateMany({
          where: { id: appointment.id, status: appointment.status },
          data: {
            status: 'RESCHEDULED',
            publishedSlotId: input.slot.id,
            startsAt: input.slot.startsAt,
            durationMin: input.slot.durationMin,
            ...(UUID.test(input.userId) ? { updatedBy: input.userId } : {}),
          },
        });
        if (updated.count === 0) return { kind: 'stale' as const };

        await tx.appointmentEvent.create({
          data: {
            appointmentId: appointment.id,
            action: 'RESCHEDULE',
            fromStatus: appointment.status,
            toStatus: 'RESCHEDULED',
            ...(UUID.test(input.userId) ? { actorId: input.userId } : {}),
            actorName: input.actorName,
            reason: 'Patient reschedule request approved',
            detail: {
              rescheduleRequestId: input.requestId,
              previousStartsAt: appointment.startsAt.toISOString(),
              startsAt: input.slot.startsAt.toISOString(),
              durationMin: input.slot.durationMin,
            },
          },
        });

        await tx.appointmentRescheduleRequest.update({
          where: { id: input.requestId },
          data: {
            status: 'approved',
            decidedAt: new Date(),
            ...(UUID.test(input.userId) ? { decidedBy: input.userId } : {}),
          },
        });
        await tx.appointmentRescheduleProposal.updateMany({
          where: { appointmentId: appointment.id, status: 'pending' },
          data: { status: 'expired' },
        });

        const moved = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id }, select: ACTION_SELECT });
        return { kind: 'approved' as const, appointment: moved, previousStartsAt: appointment.startsAt };
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  /** The appointment a request belongs to (already scoped by the request). */
  requestAppointment(appointmentId: string): Promise<ActionAppointmentRow | null> {
    return this.prisma.db.appointment.findUnique({ where: { id: appointmentId }, select: ACTION_SELECT });
  }

  /** pending → superseded (the appointment can no longer move). */
  async supersede(requestId: string): Promise<void> {
    await this.prisma.db.appointmentRescheduleRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status: 'superseded', decidedAt: new Date() },
    });
  }

  /** pending → rejected with its reason, compare-and-set. */
  async reject(requestId: string, userId: string, reason: string): Promise<RequestRow | null> {
    const updated = await this.prisma.db.appointmentRescheduleRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: {
        status: 'rejected',
        decisionReason: reason,
        decidedAt: new Date(),
        ...(UUID.test(userId) ? { decidedBy: userId } : {}),
      },
    });
    if (updated.count === 0) return null;
    const row = await this.prisma.db.appointmentRescheduleRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: REQUEST_SELECT,
    });
    return toRequestRow(row);
  }

  /** Supersedes pending requests of an appointment (staff cancel/complete/move). */
  async supersedeFor(appointmentId: string): Promise<void> {
    await this.prisma.db.appointmentRescheduleRequest.updateMany({
      where: { appointmentId, status: 'pending' },
      data: { status: 'superseded', decidedAt: new Date() },
    });
  }

  /** Hospital names by id, for the patient payloads. */
  async hospitalNames(ids: readonly (string | null)[]): Promise<ReadonlyMap<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const rows = await this.prisma.db.hospital.findMany({
      where: { id: { in: wanted } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /** Which of these appointments have a pending request. */
  async pendingAmong(appointmentIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (appointmentIds.length === 0) return new Set();
    const rows = await this.prisma.db.appointmentRescheduleRequest.findMany({
      where: { appointmentId: { in: [...appointmentIds] }, status: 'pending' },
      select: { appointmentId: true },
    });
    return new Set(rows.map((row) => row.appointmentId));
  }

  /** The doctor (`doctors.id`) behind a staff account, or null. */
  async doctorIdForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;
    const row = await this.prisma.db.doctor.findUnique({ where: { userId }, select: { id: true } });
    return row?.id ?? null;
  }

  async displayName(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;
    const row = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
    return row?.displayName ?? null;
  }
}
