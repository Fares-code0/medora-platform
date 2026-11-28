/**
 * A patient's own appointments (contract §4.1/§4.2) — the reads.
 *
 * The write routes (booking, cancellation, reschedule requests) live in
 * `PatientBookingService` (ADR-049). The reads carry what those routes
 * decide: the owning `hospital`, the server-computed `availableActions`
 * (`patient-appointment.policy.ts`, the same rule the writes enforce) and,
 * on the detail, the `pendingRescheduleRequest`.
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
import { PatientBookingRepository } from '../repositories/patient-booking.repository';
import { CLINIC_TIMEZONE, type ClinicTimezoneSource } from './clinic-timezone';
import { patientAvailableActions } from './patient-appointment.policy';
import { toRequestView } from './reschedule-request.projection';

/** What the projection needs beyond the row. */
interface Enrichment {
  readonly photo: PhotoUrlLookup;
  readonly hospitals: ReadonlyMap<string, string>;
  readonly pending: ReadonlySet<string>;
  readonly now: Date;
}

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
    private readonly bookings: PatientBookingRepository,
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
    const ids = rows.map((row) => row.id);
    await this.bookings.supersedeStale({ appointmentIds: ids });
    const [hospitals, pending] = await Promise.all([
      this.bookings.hospitalNames(rows.map((row) => row.hospitalId)),
      this.bookings.pendingAmong(ids),
    ]);
    const context: Enrichment = { photo, hospitals, pending, now: new Date() };

    return {
      items: rows.map((row) => toSummary(row, context)),
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
    await this.bookings.supersedeStale({ appointmentIds: [row.id] });
    const [hospitals, request] = await Promise.all([
      this.bookings.hospitalNames([row.hospitalId]),
      this.bookings.pendingRequestFor(row.id),
    ]);
    const pendingRescheduleRequest =
      request === null
        ? null
        : toRequestView(request, await this.bookings.slotTimings([request.requestedSlotId]));
    const context: Enrichment = {
      photo,
      hospitals,
      pending: new Set(request === null ? [] : [row.id]),
      now: new Date(),
    };

    return {
      ...toDetail(row, context),
      pendingRescheduleRequest,
      clinicTimezone: await this.timezone.current(),
    };
  }
}

function toSummary(row: SummaryRow, context: Enrichment): PatientAppointmentSummary {
  const status = row.status as AppointmentStatus;
  const hospitalName = row.hospitalId === null ? undefined : context.hospitals.get(row.hospitalId);
  return {
    id: row.publicId,
    startsAt: row.startsAt.toISOString(),
    durationMin: row.durationMin,
    status: appointmentStatusToWire(status),
    priority: appointmentPriorityToWire(row.priority as never),
    reason: row.reason,
    isNewPatient: row.isNewPatient,
    isFollowUp: row.isFollowUp,
    visitType: row.visitType.name,
    departmentName: row.department?.name ?? null,
    doctor: { ...row.doctor, photoUrl: context.photo(row.doctor.photoUrl) },
    hospital:
      row.hospitalId === null || hospitalName === undefined
        ? null
        : { id: row.hospitalId, name: hospitalName },
    availableActions: patientAvailableActions(
      {
        status,
        startsAt: row.startsAt,
        hasHospital: row.hospitalId !== null,
        hasPendingRequest: context.pending.has(row.id),
      },
      context.now,
    ),
  };
}

function toDetail(
  row: DetailRow,
  context: Enrichment,
): Omit<PatientAppointmentDetail, 'pendingRescheduleRequest'> {
  return {
    ...toSummary(row, context),
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
