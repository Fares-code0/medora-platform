/**
 * The patient's appointment actions (ADR-049): booking a published slot,
 * cancelling before the start, and the reschedule-request lifecycle.
 *
 * Every route resolves the patient from the session through
 * `PatientSelfScopeService` — there is no patient parameter anywhere — and
 * every row it touches is loaded through a WHERE that names that patient,
 * so another patient's appointment and an unknown id are the same 404.
 *
 * Audit and outbox run after the commit, never inside it (API §5).
 */

import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PatientSelfScopeService, type Principal } from '../../../shared/authz';
import { isUniqueViolation } from '../../../shared/database';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import { appointmentStatusToWire } from '../dto/appointment-enums';
import type {
  PatientAppointmentDetail,
  PatientSlotView,
  PatientVisitTypeView,
  RescheduleRequestView,
} from '../dto/patient-appointment.dto';
import type {
  PatientBookInput,
  PatientCancelInput,
  PatientRescheduleRequestInput,
  PatientSlotQuery,
} from '../dto/patient-appointment.schema';
import {
  PatientBookingRepository,
  SlotUnavailable,
  type ActionAppointmentRow,
  type RequestRow,
  type SlotRow,
} from '../repositories/patient-booking.repository';

import { PatientAppointmentService } from './patient-appointment.service';
import { cancelRefusal, patientCancelledReason, rescheduleRefusal } from './patient-appointment.policy';
import { toRequestView } from './reschedule-request.projection';

const PATIENT_ROLE = 'patient';
const DAY_MS = 86_400_000;
const DEFAULT_SLOT_WINDOW_DAYS = 31;

/** 403 `patient_only` — the routes exist for the patient audience alone. */
export function assertPatient(principal: Principal): void {
  if (principal.roleCode !== PATIENT_ROLE) {
    throw AppException.forbidden('Only a patient account can use this route', 'patient_only');
  }
}

function slotTaken(detail = 'The slot is no longer available; choose another'): AppException {
  return AppException.conflict(detail, 'slot_taken');
}

function slotNotFound(): AppException {
  return AppException.notFound('Slot not found');
}

function appointmentNotFound(): AppException {
  return AppException.notFound('Appointment not found');
}

/**
 * The phase-21 trigger's refusals, seen when a slot changed under us.
 * Also read by the doctor reschedule (`AppointmentService.reschedule`, R-01).
 */
export function isSlotTriggerRefusal(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return (
    text.includes('appointments_published_slot_available_check') ||
    text.includes('appointments_active_employment_check') ||
    text.includes('Appointment must use an available matching published slot') ||
    text.includes('Hospital appointment requires an active matching doctor employment')
  );
}

@Injectable()
export class PatientBookingService {
  constructor(
    private readonly bookings: PatientBookingRepository,
    private readonly scope: PatientSelfScopeService,
    private readonly reads: PatientAppointmentService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  // ── Reads ────────────────────────────────────────────────────────────

  /** `GET /patient/doctors/:doctorId/slots` — bookable published slots. */
  async slots(principal: Principal, doctorId: string, query: PatientSlotQuery): Promise<PatientSlotView[]> {
    assertPatient(principal);
    const now = new Date();
    const from = query.from !== undefined && query.from > now ? query.from : now;
    const to = query.to ?? new Date(from.getTime() + DEFAULT_SLOT_WINDOW_DAYS * DAY_MS);
    if (to <= from) return [];

    const rows = await this.bookings.bookableSlots(doctorId, from, to);
    return rows.map((row) => ({
      id: row.id,
      startsAt: row.startsAt.toISOString(),
      durationMin: row.durationMin,
      hospital: row.hospital,
    }));
  }

  /** `GET /patient/visit-types` — the active catalogue. */
  async visitTypes(principal: Principal): Promise<PatientVisitTypeView[]> {
    assertPatient(principal);
    return (await this.bookings.visitTypes()).map((row) => ({
      id: row.id,
      name: row.name,
      durationMin: row.defaultDurationMin,
    }));
  }

  // ── Booking ──────────────────────────────────────────────────────────

  /** `POST /me/appointments` — book a published slot; starts `pending`. */
  async book(
    principal: Principal,
    input: PatientBookInput,
  ): Promise<PatientAppointmentDetail & { clinicTimezone: string }> {
    const patientPublicId = await this.linkedPatient(principal);
    const patient = await this.bookings.patient(patientPublicId, principal.userId);
    if (patient === null) throw notLinked();

    const slot = await this.bookings.slot(input.slotId);
    // A withdrawn or unpublishable slot is not offered to anyone, so it is
    // answered as absent rather than as taken.
    if (slot === null || !slot.bookable || slot.withdrawn) throw slotNotFound();
    if (slot.startsAt.getTime() <= Date.now()) throw slotTaken('The slot has already started');

    const visitTypeId = await this.bookings.visitTypeId(input.visitTypeId);
    if (visitTypeId === null) {
      if (input.visitTypeId !== undefined) {
        throw AppException.validation({ visitTypeId: ['Unknown or inactive visit type'] });
      }
      throw AppException.validation(
        { visitTypeId: ['A visit type is required'] },
        'No default visit type is configured; choose one',
        'visit_type_required',
      );
    }

    // OD-14: an insured patient books only where the hospital covers the
    // provider; an uninsured patient is not checked.
    const covered = await this.bookings.insuranceCovered(patient.id, slot.hospitalId, startOfUtcDay(new Date()));
    if (covered === false) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, {
        message: 'Your insurance is not accepted at this hospital',
        code: 'insurance_not_covered',
        detail: 'The hospital has no active coverage agreement with your insurance provider',
      });
    }

    let booked: Awaited<ReturnType<PatientBookingRepository['book']>>;
    try {
      booked = await this.bookings.book({
        slot,
        patientId: patient.id,
        userId: principal.userId,
        actorName: patient.actorName,
        visitTypeId,
        reason: input.reason,
        notes: input.notes === undefined || input.notes === '' ? null : input.notes,
      });
    } catch (error: unknown) {
      throw this.bookingError(error);
    }

    await this.audit.record({
      action: 'appointment.book',
      actor: { userId: principal.userId, role: principal.roleCode },
      entityType: 'appointment',
      entityId: booked.publicId,
      hospitalId: slot.hospitalId,
      metadata: { status: 'pending', by: 'patient', hospitalRecordOpened: booked.hospitalCreated },
    });
    await this.outbox.publish({
      topic: 'appointment.created',
      payload: {
        appointmentId: booked.publicId,
        patientId: patientPublicId,
        doctorId: slot.doctorId,
        startsAt: slot.startsAt.toISOString(),
        status: 'pending',
      },
      dedupeKey: `appointment.created:${booked.publicId}`,
    });

    return this.reads.ownById(principal, booked.publicId);
  }

  private bookingError(error: unknown): unknown {
    if (error instanceof SlotUnavailable) {
      return error.reason === 'withdrawn' || error.reason === 'unbookable'
        ? slotNotFound()
        : slotTaken(error.reason === 'started' ? 'The slot has already started' : undefined);
    }
    if (isUniqueViolation(error) || isSlotTriggerRefusal(error)) return slotTaken();
    return error;
  }

  // ── Cancellation ──────────────────────────────────────────────────────

  /** `POST /me/appointments/:id/cancel` — before `startsAt`, with a closed reason. */
  async cancel(
    principal: Principal,
    appointmentId: string,
    input: PatientCancelInput,
  ): Promise<PatientAppointmentDetail & { clinicTimezone: string }> {
    const patientPublicId = await this.linkedPatient(principal);
    const appointment = await this.bookings.ownAppointment(patientPublicId, appointmentId);
    if (appointment === null) throw appointmentNotFound();

    const refusal = cancelRefusal(appointment, new Date());
    if (refusal !== null) throw AppException.conflict(refusal);

    const patient = await this.bookings.patient(patientPublicId, principal.userId);
    const cancelledReason = patientCancelledReason(input.reasonCode, input.note);
    const done = await this.bookings.cancel({
      appointment,
      userId: principal.userId,
      actorName: patient?.actorName ?? 'Patient',
      cancelledReason,
      reasonCode: input.reasonCode,
    });
    if (!done) {
      throw AppException.conflict(
        'The appointment changed while this request was in flight; reload and try again',
      );
    }

    await this.audit.record({
      action: 'appointment.patient_cancel',
      actor: { userId: principal.userId, role: principal.roleCode },
      entityType: 'appointment',
      entityId: appointment.publicId,
      hospitalId: appointment.hospitalId,
      metadata: {
        from: appointmentStatusToWire(appointment.status),
        status: 'cancelled',
        reasonCode: input.reasonCode,
      },
    });
    // The doctor is told; the patient who cancelled is not notified of their
    // own act (contract §5) — hence a topic of its own, not `appointment.cancelled`.
    await this.outbox.publish({
      topic: 'appointment.cancelled_by_patient',
      payload: {
        appointmentId: appointment.publicId,
        patientId: patientPublicId,
        doctorId: appointment.doctorId,
        startsAt: appointment.startsAt.toISOString(),
        status: 'cancelled',
      },
      dedupeKey: `appointment.cancelled_by_patient:${appointment.publicId}`,
    });

    return this.reads.ownById(principal, appointment.publicId);
  }

  // ── Reschedule requests ───────────────────────────────────────────────

  /** `POST /me/appointments/:id/reschedule-requests`. */
  async requestReschedule(
    principal: Principal,
    appointmentId: string,
    input: PatientRescheduleRequestInput,
  ): Promise<RescheduleRequestView> {
    const patientPublicId = await this.linkedPatient(principal);
    const appointment = await this.bookings.ownAppointment(patientPublicId, appointmentId);
    if (appointment === null) throw appointmentNotFound();

    await this.bookings.supersedeStale({ appointmentIds: [appointment.id] });
    const refusal = rescheduleRefusal(
      {
        status: appointment.status,
        startsAt: appointment.startsAt,
        hasHospital: appointment.hospitalId !== null && appointment.doctorEmploymentId !== null,
        hasPendingRequest: await this.bookings.hasPendingRequest(appointment.id),
      },
      new Date(),
    );
    if (refusal !== null) {
      throw AppException.conflict(
        refusal,
        refusal.includes('already pending') ? 'reschedule_request_pending' : 'conflict',
      );
    }

    const slot = await this.bookings.slot(input.slotId);
    if (slot === null || !slot.bookable || slot.withdrawn) throw slotNotFound();
    assertSameBook(slot, appointment);
    if (slot.id === appointment.publishedSlotId) {
      throw AppException.validation({ slotId: ['This is the appointment’s current slot'] });
    }
    if (slot.startsAt.getTime() <= Date.now()) throw slotTaken('The slot has already started');
    if (await this.bookings.slotHeld(slot.id, appointment.id)) throw slotTaken();

    let created: RequestRow;
    try {
      created = await this.bookings.createRequest({
        appointmentId: appointment.id,
        hospitalId: slot.hospitalId,
        doctorEmploymentId: slot.doctorEmploymentId,
        slotId: slot.id,
        userId: principal.userId,
        note: input.note === undefined || input.note === '' ? null : input.note,
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'A reschedule request for this appointment is already pending',
          'reschedule_request_pending',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'appointment.reschedule_request',
      actor: { userId: principal.userId, role: principal.roleCode },
      entityType: 'appointment',
      entityId: appointment.publicId,
      hospitalId: appointment.hospitalId,
      metadata: { requestId: created.id, status: 'pending' },
    });
    await this.outbox.publish({
      topic: 'appointment.reschedule_request.created',
      payload: {
        appointmentId: appointment.publicId,
        patientId: patientPublicId,
        doctorId: appointment.doctorId,
        requestId: created.id,
      },
      dedupeKey: `appointment.reschedule_request.created:${created.id}`,
    });

    return toRequestView(created, await this.bookings.slotTimings([created.requestedSlotId]));
  }

  /** `GET /me/appointments/:id/reschedule-requests` — newest first. */
  async listRequests(principal: Principal, appointmentId: string): Promise<RescheduleRequestView[]> {
    const patientPublicId = await this.linkedPatient(principal);
    const appointment = await this.bookings.ownAppointment(patientPublicId, appointmentId);
    if (appointment === null) throw appointmentNotFound();

    await this.bookings.supersedeStale({ appointmentIds: [appointment.id] });
    const rows = await this.bookings.requestsFor(appointment.id);
    const slots = await this.bookings.slotTimings(rows.map((row) => row.requestedSlotId));
    return rows.map((row) => toRequestView(row, slots));
  }

  /** `POST /me/reschedule-requests/:id/withdraw` — pending only. */
  async withdraw(principal: Principal, requestId: string): Promise<RescheduleRequestView> {
    const patientPublicId = await this.linkedPatient(principal);
    const request = await this.bookings.ownRequest(patientPublicId, requestId);
    if (request === null) throw AppException.notFound('Reschedule request not found');

    await this.bookings.supersedeStale({ appointmentIds: [request.appointmentId] });
    const withdrawn = await this.bookings.withdraw(request.id);
    if (withdrawn === null) {
      throw AppException.conflict('Only a pending reschedule request can be withdrawn');
    }

    await this.audit.record({
      action: 'appointment.reschedule_request_withdraw',
      actor: { userId: principal.userId, role: principal.roleCode },
      entityType: 'appointment',
      entityId: withdrawn.appointmentPublicId,
      hospitalId: withdrawn.hospitalId,
      metadata: { requestId: withdrawn.id, status: 'withdrawn' },
    });

    return toRequestView(withdrawn, await this.bookings.slotTimings([withdrawn.requestedSlotId]));
  }

  /**
   * The caller's `PT-…` handle. A non-patient is 403 `patient_only`; an
   * unlinked patient account is 409 `patient_not_linked`, so the app can
   * show the linking screen.
   */
  private async linkedPatient(principal: Principal): Promise<string> {
    assertPatient(principal);
    const patientId = await this.scope.patientIdFor(principal);
    if (patientId === null) throw notLinked();
    return patientId;
  }
}

function notLinked(): AppException {
  return AppException.conflict(
    'This account is not yet linked to a patient record; link it at the hospital desk',
    'patient_not_linked',
  );
}

/** DISCOVERY_AND_BOOKING §6: a reschedule never moves across hospitals or doctors. */
function assertSameBook(slot: SlotRow, appointment: ActionAppointmentRow): void {
  if (slot.hospitalId !== appointment.hospitalId || slot.doctorEmploymentId !== appointment.doctorEmploymentId) {
    throw AppException.validation(
      { slotId: ['The slot must be with the same doctor at the same hospital'] },
      'A reschedule cannot move to another doctor or hospital',
      'slot_not_eligible',
    );
  }
}

function startOfUtcDay(instant: Date): Date {
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}
