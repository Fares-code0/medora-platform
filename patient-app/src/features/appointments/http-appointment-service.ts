import {
  appointmentEndpoints,
  type WireAppointmentDetail,
  type WireAppointmentEvent,
  type WireAppointmentSummary,
  type WireRescheduleRequest,
  type WireSlot,
  type WireVisitType,
} from '@/api/endpoints/appointments';

import type {
  Appointment,
  AppointmentDetail,
  AppointmentEvent,
  AppointmentPage,
  AppointmentService,
  BookableSlot,
  RescheduleRequest,
  VisitType,
} from './model/types';

/**
 * The HTTP adapter for appointments — checklist I-01…I-06.
 *
 * ── Everything is live ───────────────────────────────────────────────
 *
 * Reads, slots, visit types, booking, cancellation and the reschedule
 * request workflow all call the routes in `api/endpoints/appointments.ts`
 * (patient-app end-to-end contract §3). The ADR-033 refusals this adapter
 * used to carry are gone: the owner decided cancellation and the
 * request-based reschedule, and the server computes `availableActions`.
 *
 * ── The client still never decides ───────────────────────────────────
 *
 * `availableActions` is mapped straight from the payload and nothing here
 * derives an action from `status`. A reschedule is a REQUEST — the
 * appointment keeps its time until the hospital approves.
 *
 * ── The one place a device clock is used, and what it costs ──────────
 *
 * `list('upcoming')` sends `upcoming=true`, which the server resolves
 * against its own clock — correct, and immune to a wrong device clock.
 *
 * `list('past')` has no such shorthand: `upcoming=false` is accepted by
 * the query schema but the service only acts on `true`, so there is no
 * server-side "before now". The adapter therefore sends `to=<device
 * now>`, using a parameter the contract defines rather than inventing
 * one. A device whose clock is wrong partitions Upcoming and Past at the
 * wrong instant; nothing else drifts — every timestamp still renders from
 * the server's value and the clinic's timezone. Closing it needs one line
 * in the backend service (`upcoming === false` → `to: new Date()`).
 *
 * ── Pages ───────────────────────────────────────────────────────────
 *
 * `page` is passed through and `hasMore` is derived from the server's
 * `page`/`totalPages`.
 */

function toEvent(wire: WireAppointmentEvent, index: number): AppointmentEvent {
  return {
    // A list key, not an identifier — the projection has no event id.
    id: `${index}:${wire.occurredAt}`,
    at: wire.occurredAt,
    fromStatus: wire.fromStatus,
    toStatus: wire.toStatus,
    actor: wire.actor,
    reason: wire.reason,
  };
}

function toAppointment(wire: WireAppointmentSummary, clinicTimezone: string | null): Appointment {
  return {
    id: wire.id,
    startsAt: wire.startsAt,
    durationMin: wire.durationMin,
    status: wire.status,
    priority: wire.priority,
    doctor: wire.doctor,
    departmentName: wire.departmentName,
    visitType: wire.visitType,
    reason: wire.reason,
    // The list projection carries neither; the detail one carries both.
    notes: null,
    cancelledReason: null,
    // The list sends one zone for the page; the detail sends its own.
    clinicTimezone,
    hospital: wire.hospital ?? null,
    // The server's own list, passed through. Never derived from `status`.
    availableActions: wire.availableActions,
  };
}

function toRescheduleRequest(wire: WireRescheduleRequest): RescheduleRequest {
  return {
    id: wire.id,
    appointmentId: wire.appointmentId,
    status: wire.status,
    requestedSlot: {
      id: wire.requestedSlot.id,
      startsAt: wire.requestedSlot.startsAt,
      durationMin: wire.requestedSlot.durationMin,
    },
    note: wire.note,
    decisionReason: wire.decisionReason,
    createdAt: wire.createdAt,
    decidedAt: wire.decidedAt,
  };
}

function toDetail(wire: WireAppointmentDetail): AppointmentDetail {
  return {
    ...toAppointment(wire, wire.clinicTimezone),
    notes: wire.notes,
    cancelledReason: wire.cancelledReason,
    events: wire.events.map(toEvent),
    pendingRescheduleRequest:
      wire.pendingRescheduleRequest === null || wire.pendingRescheduleRequest === undefined
        ? null
        : toRescheduleRequest(wire.pendingRescheduleRequest),
  };
}

function toSlot(wire: WireSlot): BookableSlot {
  return {
    id: wire.id,
    startsAt: wire.startsAt,
    durationMin: wire.durationMin,
    hospital: wire.hospital,
  };
}

function toVisitType(wire: WireVisitType): VisitType {
  return { id: wire.id, name: wire.name, durationMin: wire.durationMin };
}

export const httpAppointmentService: AppointmentService = {
  async list(scope, page = 1): Promise<AppointmentPage> {
    const response =
      scope === 'upcoming'
        ? await appointmentEndpoints.list({ upcoming: true, sort: 'startsAt:asc', page })
        : await appointmentEndpoints.list({
            to: new Date().toISOString(),
            sort: 'startsAt:desc',
            page,
          });
    const { items, totalItems, totalPages, clinicTimezone } = response.data;
    return {
      items: items.map((item) => toAppointment(item, clinicTimezone)),
      totalItems,
      // The server's own arithmetic, not the length of this page: a full
      // last page is not "has more", and asking for the page after it
      // returns an empty one.
      hasMore: response.data.page < totalPages,
    };
  },

  async getById(id): Promise<AppointmentDetail> {
    const response = await appointmentEndpoints.byId(id);
    return toDetail(response.data);
  },

  async listSlots(doctorId, fromIso, toIso): Promise<readonly BookableSlot[]> {
    const response = await appointmentEndpoints.slots(doctorId, fromIso, toIso);
    return response.data.map(toSlot);
  },

  async listVisitTypes(): Promise<readonly VisitType[]> {
    const response = await appointmentEndpoints.visitTypes();
    return response.data.map(toVisitType);
  },

  async book(request, idempotencyKey): Promise<AppointmentDetail> {
    const response = await appointmentEndpoints.book(
      {
        slotId: request.slotId,
        reason: request.reason,
        // Omitted rather than sent empty or null: an absent field is "the
        // patient chose nothing" and the server resolves its default.
        ...(request.visitTypeId === undefined ? {} : { visitTypeId: request.visitTypeId }),
        ...(request.notes === undefined ? {} : { notes: request.notes }),
      },
      idempotencyKey,
    );
    return toDetail(response.data);
  },

  async cancel(id, request): Promise<AppointmentDetail> {
    const response = await appointmentEndpoints.cancel(id, {
      reasonCode: request.reasonCode,
      ...(request.note === undefined ? {} : { note: request.note }),
    });
    return toDetail(response.data);
  },

  async requestReschedule(id, submission, idempotencyKey): Promise<RescheduleRequest> {
    const response = await appointmentEndpoints.requestReschedule(
      id,
      {
        slotId: submission.slotId,
        ...(submission.note === undefined ? {} : { note: submission.note }),
      },
      idempotencyKey,
    );
    return toRescheduleRequest(response.data);
  },

  async listRescheduleRequests(id): Promise<readonly RescheduleRequest[]> {
    const response = await appointmentEndpoints.rescheduleRequests(id);
    return response.data.map(toRescheduleRequest);
  },

  async withdrawRescheduleRequest(requestId): Promise<RescheduleRequest> {
    const response = await appointmentEndpoints.withdrawRescheduleRequest(requestId);
    return toRescheduleRequest(response.data);
  },
};
