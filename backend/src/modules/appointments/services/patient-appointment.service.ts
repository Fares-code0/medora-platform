/**
 * A patient's own appointments (contract §4.1/§4.2) — **reads only**.
 *
 * Booking, cancelling, rescheduling and re-confirming are specified in
 * the contract and deliberately absent here. Every one of them needs a
 * rule no source in this repository states: may a patient cancel a
 * `confirmed` appointment, and up to when? ADR-001's table says which
 * *statuses* may follow which; it does not say **who** may move between
 * them, and inventing a cancellation window would put clinical-operations
 * policy in a service class.
 *
 * The reads have no such gap. Ownership, the status vocabulary, paging
 * and the event history are all fully specified, so they ship now and let
 * the mobile client build its appointment list and detail screens against
 * real data.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AppointmentStatus } from '../../../generated/prisma/enums';
import { PatientSelfScopeService, type Principal } from '../../../shared/authz';
import { ProfilePhotoUrls, type PhotoUrlLookup } from '../../../shared/files';
import {
  appointmentActionToWire,
  appointmentPriorityToWire,
  appointmentStatusToWire,
  STATUS_FROM_WIRE,
} from '../dto/appointment-enums';
import type {
  PatientAppointmentDetail,
  PatientAppointmentEvent,
  PatientAppointmentSummary,
} from '../dto/patient-appointment.dto';
import type { PatientAppointmentQuery } from '../dto/patient-appointment.schema';
import {
  PatientAppointmentRepository,
  type DetailRow,
  type SummaryRow,
} from '../repositories/patient-appointment.repository';
import { CLINIC_TIMEZONE, type ClinicTimezoneSource } from './clinic-timezone';

export interface PaginatedAppointments {
  readonly items: readonly PatientAppointmentSummary[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
  /**
   * The IANA zone the clinic operates in (audit R-12).
   *
   * Returned alongside UTC timestamps so the client **formats** rather
   * than computes. "Today" is a question about the clinic's timezone, not
   * the device's — a patient who travels changes their device zone, not
   * their appointment.
   */
  readonly clinicTimezone: string;
}

@Injectable()
export class PatientAppointmentService {
  constructor(
    private readonly appointments: PatientAppointmentRepository,
    private readonly scope: PatientSelfScopeService,
    @Inject(CLINIC_TIMEZONE) private readonly timezone: ClinicTimezoneSource,
    private readonly photos: ProfilePhotoUrls,
  ) {}

  async listOwn(
    principal: Principal,
    query: PatientAppointmentQuery,
  ): Promise<PaginatedAppointments> {
    const clinicTimezone = await this.timezone.current();
    const patientId = await this.scope.patientIdFor(principal);

    // An account with no linked clinical record owns no appointments.
    // That is the normal state right after registration (ADR-030 §4), so
    // it is an empty page and not an error — a 404 on one's own list is
    // indistinguishable from a broken session.
    if (patientId === null) {
      return {
        items: [],
        page: query.page,
        pageSize: query.pageSize,
        totalItems: 0,
        totalPages: 0,
        clinicTimezone,
      };
    }

    const { rows, totalItems } = await this.appointments.listOwn(patientId, {
      status: query.status?.map((wire) => STATUS_FROM_WIRE[wire] as AppointmentStatus),
      // `upcoming=true` resolves against the server's clock, never the
      // client's, and never overrides an explicit `from`.
      from: query.from ?? (query.upcoming === true ? new Date() : undefined),
      to: query.to,
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    });

    // One lookup for the page. The embedded doctor's `photoUrl` is stored
    // as a `files.id`; the wire gets a signed, scan-gated URL or null.
    const photo = await this.photos.lookup(rows.map((row) => row.doctor.photoUrl));

    return {
      items: rows.map((row) => toSummary(row, photo)),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
      clinicTimezone,
    };
  }

  async ownById(
    principal: Principal,
    appointmentId: string,
  ): Promise<PatientAppointmentDetail & { readonly clinicTimezone: string }> {
    const patientId = await this.scope.patientIdFor(principal);

    // Unlinked account and unknown appointment produce the same 404 as
    // "someone else's appointment" — see the repository's `findOwn`.
    if (patientId === null) throw AppException.notFound('Appointment not found');

    const row = await this.appointments.findOwn(patientId, appointmentId);
    if (row === null) throw AppException.notFound('Appointment not found');

    const photo = await this.photos.lookup([row.doctor.photoUrl]);

    return {
      ...toDetail(row, photo),
      clinicTimezone: await this.timezone.current(),
    };
  }
}

function toSummary(row: SummaryRow, photo: PhotoUrlLookup): PatientAppointmentSummary {
  return {
    id: row.publicId,
    startsAt: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    status: appointmentStatusToWire(row.status as AppointmentStatus),
    priority: appointmentPriorityToWire(row.priority as never),
    reason: row.reason,
    isNewPatient: row.isNewPatient,
    isFollowUp: row.isFollowUp,
    visitType: row.visitType.name,
    departmentName: row.department?.name ?? null,
    doctor: { ...row.doctor, photoUrl: photo(row.doctor.photoUrl) },
  };
}

function toDetail(row: DetailRow, photo: PhotoUrlLookup): PatientAppointmentDetail {
  return {
    ...toSummary(row, photo),
    notes: row.notes,
    cancelledReason: row.cancelledReason,
    events: row.events.map(toEvent),
  };
}

/**
 * Collapses an actor to a coarse category.
 *
 * The stored `actor_name` is never projected. A patient reading their own
 * appointment history has no need for the name of the receptionist who
 * moved it, and exposing one would make this route a second, unaudited
 * path into the clinic's staff directory.
 */
function toEvent(event: DetailRow['events'][number]): PatientAppointmentEvent {
  const role = event.actor?.role.code;

  return {
    action: appointmentActionToWire(event.action as never),
    fromStatus:
      event.fromStatus === null ? null : appointmentStatusToWire(event.fromStatus as never),
    toStatus: event.toStatus === null ? null : appointmentStatusToWire(event.toStatus as never),
    occurredAt: event.occurredAt.toISOString(),
    actor: event.actorId === null ? 'system' : role === 'patient' ? 'patient' : 'clinic',
    reason: event.reason,
  };
}
