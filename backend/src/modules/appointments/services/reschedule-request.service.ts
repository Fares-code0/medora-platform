/**
 * The clinic's side of a patient reschedule request (ADR-049).
 *
 * Scoped exactly like the doctor's own book (`AppointmentService`): the
 * caller's `doctors` row, appointments under a current employment, in the
 * WHERE — so another doctor's request is the same 404 as an unknown one.
 *
 * Approval moves the SAME appointment row onto the requested slot, with
 * status `rescheduled` through the ADR-001 machine; the old slot is freed
 * by that move. If the requested slot was taken while the request waited,
 * the transaction rolls back, the answer is `409 slot_taken`, and the
 * request stays pending for the clinic to reject.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { isUniqueViolation } from '../../../shared/database';
import { OUTBOX, type OutboxPort } from '../../../shared/outbox';
import type { RescheduleRequestView } from '../dto/patient-appointment.dto';
import type {
  RejectRescheduleRequestInput,
  RescheduleRequestListQuery,
} from '../dto/patient-appointment.schema';
import {
  PatientBookingRepository,
  SlotUnavailable,
  type ActionAppointmentRow,
  type RequestRow,
} from '../repositories/patient-booking.repository';

import { appointmentStatusMachine } from './appointment-status.machine';
import { PATIENT_RESCHEDULABLE } from './patient-appointment.policy';
import { toRequestView } from './reschedule-request.projection';

/** The appointment can no longer move: the request is superseded. */
class AppointmentNotMovable extends Error {}

function requestNotFound(): AppException {
  return AppException.notFound('Reschedule request not found');
}

function slotTaken(): AppException {
  return AppException.conflict(
    'The requested slot is no longer available; reject the request instead',
    'slot_taken',
  );
}

@Injectable()
export class RescheduleRequestService {
  constructor(
    private readonly requests: PatientBookingRepository,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(OUTBOX) private readonly outbox: OutboxPort,
  ) {}

  /** `GET /appointments/reschedule-requests?status=` — the caller's own book. */
  async list(user: AuthenticatedUser, query: RescheduleRequestListQuery): Promise<RescheduleRequestView[]> {
    const doctorId = await this.requireDoctor(user);
    await this.requests.supersedeStale({});
    const rows = await this.requests.requestsForDoctor(doctorId, query.status);
    const slots = await this.requests.slotTimings(rows.map((row) => row.requestedSlotId));
    return rows.map((row) => toRequestView(row, slots));
  }

  /** `POST /appointments/reschedule-requests/:id/approve`. */
  async approve(user: AuthenticatedUser, requestId: string): Promise<RescheduleRequestView> {
    const doctorId = await this.requireDoctor(user);
    const request = await this.requests.requestForDoctor(doctorId, requestId);
    if (request === null) throw requestNotFound();
    if (request.status !== 'pending') throw notPending(request);

    const slot = await this.requests.slot(request.requestedSlotId);
    if (slot === null || !slot.bookable || slot.withdrawn) throw slotTaken();

    const actorName = (await this.requests.displayName(user.id)) ?? user.publicId;
    let result: Awaited<ReturnType<PatientBookingRepository['approve']>>;
    try {
      result = await this.requests.approve({
        requestId: request.id,
        doctorId,
        slot,
        userId: user.id,
        actorName,
        assertMovable: (appointment: ActionAppointmentRow) => {
          if (
            !PATIENT_RESCHEDULABLE.includes(appointment.status) ||
            appointment.startsAt.getTime() <= Date.now()
          ) {
            throw new AppointmentNotMovable();
          }
          appointmentStatusMachine.assert(appointment.status, 'RESCHEDULED');
        },
      });
    } catch (error: unknown) {
      if (error instanceof AppointmentNotMovable) {
        await this.requests.supersede(request.id);
        throw AppException.conflict(
          'The appointment can no longer be moved; the request has been superseded',
        );
      }
      if (error instanceof SlotUnavailable || isUniqueViolation(error)) throw slotTaken();
      throw error;
    }

    if (result.kind === 'not_pending') throw notPending(request);
    if (result.kind === 'stale') {
      throw AppException.conflict(
        'The appointment changed while this request was in flight; reload and try again',
        'stale_write',
      );
    }

    const appointment = result.appointment;
    await this.audit.record({
      action: 'appointment.reschedule_request_approve',
      actor: { userId: user.id, role: user.role },
      entityType: 'appointment',
      entityId: appointment.publicId,
      hospitalId: appointment.hospitalId,
      metadata: {
        requestId: request.id,
        status: 'rescheduled',
        previousStartsAt: result.previousStartsAt.toISOString(),
      },
    });
    await this.outbox.publish({
      topic: 'appointment.reschedule_request.approved',
      payload: {
        appointmentId: appointment.publicId,
        patientId: appointment.patient.publicId,
        doctorId: appointment.doctorId,
        startsAt: appointment.startsAt.toISOString(),
        status: 'rescheduled',
      },
      dedupeKey: `appointment.reschedule_request.approved:${request.id}`,
    });

    return this.view(request.id, doctorId);
  }

  /** `POST /appointments/reschedule-requests/:id/reject` — the appointment is untouched. */
  async reject(
    user: AuthenticatedUser,
    requestId: string,
    input: RejectRescheduleRequestInput,
  ): Promise<RescheduleRequestView> {
    const doctorId = await this.requireDoctor(user);
    const request = await this.requests.requestForDoctor(doctorId, requestId);
    if (request === null) throw requestNotFound();
    if (request.status !== 'pending') throw notPending(request);

    const rejected = await this.requests.reject(request.id, user.id, input.reason);
    if (rejected === null) throw notPending(request);

    const appointment = await this.requests.requestAppointment(rejected.appointmentId);
    await this.audit.record({
      action: 'appointment.reschedule_request_reject',
      actor: { userId: user.id, role: user.role },
      entityType: 'appointment',
      entityId: rejected.appointmentPublicId,
      hospitalId: rejected.hospitalId,
      metadata: { requestId: rejected.id, status: 'rejected' },
    });
    await this.outbox.publish({
      topic: 'appointment.reschedule_request.rejected',
      payload: {
        appointmentId: rejected.appointmentPublicId,
        patientId: appointment?.patient.publicId ?? null,
        doctorId,
        startsAt: appointment?.startsAt.toISOString() ?? null,
      },
      dedupeKey: `appointment.reschedule_request.rejected:${rejected.id}`,
    });

    return toRequestView(rejected, await this.requests.slotTimings([rejected.requestedSlotId]));
  }

  private async view(requestId: string, doctorId: string): Promise<RescheduleRequestView> {
    const row = await this.requests.requestForDoctor(doctorId, requestId);
    if (row === null) throw requestNotFound();
    return toRequestView(row, await this.requests.slotTimings([row.requestedSlotId]));
  }

  private async requireDoctor(user: AuthenticatedUser): Promise<string> {
    const doctorId = await this.requests.doctorIdForUser(user.id);
    if (doctorId === null) throw AppException.notFound('No doctor profile for this account');
    return doctorId;
  }
}

function notPending(request: RequestRow): AppException {
  return AppException.conflict(`The reschedule request is ${request.status}, not pending`);
}
