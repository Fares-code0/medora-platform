/**
 * `POST /me/appointments` — a patient books a doctor-published slot
 * (DR-10, DR-11, OD-08, OD-09, OD-14; `API_CONTRACT_CHANGES.md` §6 and
 * §10 `book_appointment`; audit SLT-03, SLT-04, SLT-05).
 *
 * ## One transaction, the slot decides everything
 *
 * Inside the doctor's schedule lock (BE-1, shared with the doctor's own
 * booking path so the two serialise) the slot row is locked `FOR UPDATE`
 * and re-read. The hospital, the doctor (through the slot's employment),
 * the time and the duration are the slot's; the body cannot carry them
 * (the schema is strict). In order:
 *
 * 1. the slot exists (else 404), is not withdrawn and still offerable
 *    (`409 slot_taken`, `detail: withdrawn`), starts in the future
 *    (`past`), and holds no live appointment and no overlapping booking
 *    or time off (`booked` / `withdrawn`);
 * 2. OD-14: an insured patient's provider is accepted at the slot's
 *    hospital on the slot's date, else `422 insurance_not_covered`; an
 *    uninsured patient is not checked;
 * 3. OD-09: the patient's Hospital Medical Record there is opened if this
 *    is the first interaction with that hospital;
 * 4. the appointment is inserted with `published_slot_id`.
 *
 * The partial unique index `appointments_one_active_booking_per_slot`,
 * the `appointments_no_overlap` exclusion and the insert trigger are the
 * final guards; a violation of any is the same `409 slot_taken`, so N
 * concurrent bookings of one slot yield exactly one success (DR-11).
 *
 * ## Why the transaction runs under `system` scope
 *
 * Under a `patient` tenant scope the organisational rows the booking must
 * read — `published_slots`, `doctor_employments`, `doctor_time_off`,
 * `hospital_insurance_coverage` (`org_visible`) — are invisible, and the
 * appointment insert trigger `validate_active_appointment_employment`
 * itself reads `doctor_employments` and `published_slots` `FOR UPDATE`
 * under the caller's policies, so the insert cannot succeed in that scope.
 * The booking transaction therefore runs under `runAsSystem`, reviewed:
 * every statement in it is keyed by the slot id or by the caller's own
 * `patients.id` (resolved from the session, never the body); it writes
 * only that patient's appointment, its event and that patient's record;
 * and the response is read afterwards through the patient's own scope
 * (`PatientAppointmentService.ownById`). No other patient's data is read
 * or returned.
 *
 * ## Status on creation
 *
 * `scheduled`. No source fixes the initial status of a patient booking of
 * a published slot; the slot is the doctor's own offer, so the booking is
 * not a request awaiting the doctor's answer (`pending`), and `scheduled`
 * is the initial status the doctor's own booking path uses (API §5.3).
 * The doctor is notified through the existing `appointment.created`
 * outbox topic, as on that path — recorded inside the booking
 * transaction (`publishWithin`), so it commits with the booking.
 *
 * ## Not here
 *
 * Patient cancel / reschedule / accept-proposal and `availableActions`
 * (ADR-033, unresolved), and booking-window / lead-time policy values
 * (OD-08 implementation policy, not yet set).
 */

import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PatientSelfScopeService, principalOf } from '../../../shared/authz';
import { runAsSystem } from '../../../shared/database';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import { appointmentPriorityToWire, appointmentStatusToWire } from '../dto/appointment-enums';
import type { PatientAppointmentDetail } from '../dto/patient-appointment.dto';
import type { BookAppointmentInput } from '../dto/published-slot.schema';
import { AppointmentRepository } from '../repositories/appointment.repository';
import { PublishedSlotRepository } from '../repositories/published-slot.repository';

import {
  ACTIVE_EMPLOYMENT,
  mentionsConstraint,
  NO_OVERLAP,
  ONE_BOOKING_PER_SLOT,
  SLOT_AVAILABLE,
} from './booking-errors';
import { CLINIC_TIMEZONE, type ClinicTimezoneSource } from './clinic-timezone';
import { PatientAppointmentService } from './patient-appointment.service';
import { assertPatient } from './published-slot.service';
import { SlotConflictChecker } from './slot-conflict.checker';

type SlotTakenReason = 'booked' | 'withdrawn' | 'past';

@Injectable()
export class PatientBookingService {
  constructor(
    private readonly slots: PublishedSlotRepository,
    private readonly appointments: AppointmentRepository,
    private readonly conflicts: SlotConflictChecker,
    private readonly self: PatientSelfScopeService,
    private readonly patientAppointments: PatientAppointmentService,
    @Inject(CLINIC_TIMEZONE) private readonly timezone: ClinicTimezoneSource,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  async book(
    user: AuthenticatedUser,
    input: BookAppointmentInput,
  ): Promise<PatientAppointmentDetail & { readonly clinicTimezone: string }> {
    assertPatient(user);
    const principal = principalOf(user);

    // KD-4 / RA-030.1: an account not yet linked to a patient identity
    // cannot book — there is no one to book for.
    const patientPublicId = await this.self.patientIdFor(principal);
    const patientId =
      patientPublicId === null ? null : await this.slots.patientUuid(patientPublicId);
    if (patientPublicId === null || patientId === null) {
      throw AppException.conflict(
        'Link your account to your patient identity before booking',
        'patient_identity_required',
      );
    }

    const visitTypeId = await this.resolveVisitType(input.visitTypeId);

    // Whose schedule lock to take. Read before the lock; the slot is
    // re-read under it, and its employment cannot change (a Phase 21
    // trigger forbids moving a slot between employments).
    const doctorId = await runAsSystem(() => this.slots.slotDoctor(input.slotId));
    if (doctorId === null) throw AppException.notFound('Slot not found');

    const [departmentId, displayName, timeZone] = await Promise.all([
      this.appointments.defaultDepartmentId(doctorId),
      this.appointments.displayNameForUser(user.id),
      this.timezone.current(),
    ]);
    const actorName = displayName ?? user.publicId;

    const booked = await runAsSystem(() =>
      this.conflicts.underScheduleLock([doctorId], async (tx) => {
        const slot = await this.slots.lockSlotForBooking(input.slotId, tx);
        if (slot === null) throw AppException.notFound('Slot not found');

        if (slot.withdrawnAt !== null || !slot.offerable || slot.doctorId !== doctorId) {
          throw slotTaken('withdrawn');
        }
        if (slot.startsAt.getTime() <= Date.now()) throw slotTaken('past');
        if ((await this.slots.liveBookingOf(slot.id, tx)) !== null) throw slotTaken('booked');

        const occupied = await this.conflicts.findOccupancy({
          doctorId: slot.doctorId,
          bufferMin: slot.bufferMin,
          timeZone,
          candidate: { startsAt: slot.startsAt, durationMin: slot.durationMinutes },
          tx,
        });
        if (occupied !== null) {
          throw slotTaken(occupied.rule === 'inside-time-off' ? 'withdrawn' : 'booked');
        }

        // OD-14: insured → validate coverage; uninsured → no check.
        const providerId = await this.slots.activeInsuranceProvider(patientId, slot.startsAt, tx);
        if (
          providerId !== null &&
          !(await this.slots.hospitalCovers(slot.hospitalId, providerId, slot.startsAt, tx))
        ) {
          throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, {
            code: 'insurance_not_covered',
            message: 'Your insurance is not accepted at this hospital',
            detail: 'The hospital of this slot does not accept your active insurance provider',
          });
        }

        // OD-09: the first real interaction opens the record there.
        const record = await this.slots.ensureRecord(patientId, slot.hospitalId, tx);

        const row = await this.slots.insertBooking(
          {
            publicId: await this.appointments.nextReference(tx),
            slot,
            patientId,
            hospitalMedicalRecordId: record.id,
            departmentId,
            visitTypeId,
            reason: input.reason,
            notes: input.notes ?? null,
            isNewPatient: record.created,
            actorId: user.id,
            actorName,
          },
          tx,
        );

        // The doctor's notification (`appointment.created`, audience
        // doctor) commits with the booking or not at all (RM M19.1).
        await this.outbox.publishWithin(tx, {
          topic: 'appointment.created',
          payload: {
            appointmentId: row.publicId,
            patientId: patientPublicId,
            doctorId: slot.doctorId,
            startsAt: row.startsAt.toISOString(),
            status: appointmentStatusToWire(row.status),
          },
          dedupeKey: `appointment.created:${row.publicId}:${row.updatedAt.toISOString()}`,
        });

        return { row, slot, recordCreated: record.created };
      }),
    ).catch((error: unknown) => {
      if (error instanceof AppException) throw error;
      if (mentionsConstraint(error, [ONE_BOOKING_PER_SLOT, NO_OVERLAP])) throw slotTaken('booked');
      if (mentionsConstraint(error, [SLOT_AVAILABLE, ACTIVE_EMPLOYMENT])) {
        throw slotTaken('withdrawn');
      }
      throw error;
    });

    await this.audit.record({
      action: 'appointment.book',
      actor: { userId: user.id, role: user.role },
      entityType: 'appointment',
      entityId: booked.row.publicId,
      hospitalId: booked.slot.hospitalId,
      metadata: {
        status: appointmentStatusToWire(booked.row.status),
        priority: appointmentPriorityToWire(booked.row.priority as never),
        channel: 'patient',
        publishedSlotId: booked.slot.id,
        medicalRecordOpened: booked.recordCreated,
      },
    });

    await this.activity.record({
      userId: user.id,
      kind: 'profile',
      summary: 'Booked an appointment',
      detail: booked.row.publicId,
    });

    return this.patientAppointments.ownById(principal, booked.row.publicId);
  }

  /** `visitTypeId` when sent (must be active), else the first active one. */
  private async resolveVisitType(visitTypeId: string | undefined): Promise<string> {
    if (visitTypeId !== undefined) {
      if (await this.slots.activeVisitType(visitTypeId)) return visitTypeId;
      throw AppException.validation(
        { visitTypeId: ['Unknown visit type'] },
        'The visit type is not one this clinic offers',
      );
    }

    const fallback = await this.slots.defaultVisitTypeId();
    if (fallback === null) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
        message: 'Service unavailable',
        code: 'service_unavailable',
        detail: 'No visit type is configured',
      });
    }

    return fallback;
  }
}

/**
 * `409 slot_taken` — contract §10 `book_appointment`: `detail` carries the
 * reason, one of `booked | withdrawn | past`, so the client can branch on
 * it and offer fresh slots.
 */
function slotTaken(reason: SlotTakenReason): AppException {
  return AppException.conflict(reason, 'slot_taken', 'The slot is no longer available');
}
