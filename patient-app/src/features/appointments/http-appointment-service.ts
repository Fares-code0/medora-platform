import {
  appointmentEndpoints,
  type WireAppointmentDetail,
  type WireAppointmentEvent,
  type WireAppointmentSummary,
} from '@/api/endpoints/appointments';
import { EndpointNotImplementedError } from '@/api/seam';
import type { MessageKey } from '@/i18n';

import type {
  Appointment,
  AppointmentDetail,
  AppointmentEvent,
  AppointmentPage,
  AppointmentService,
  BookableSlot,
} from './model/types';

/**
 * The HTTP adapter for appointments — checklist I-01, I-02, I-06.
 *
 * ── Reads are live; every write refuses, by name ─────────────────────
 *
 * `GET /me/appointments` and `/me/appointments/{id}` are served today.
 * `listSlots`, `book`, `cancel`, `requestReschedule` and `acceptProposal`
 * are **blocked on ADR-033**, which is written up and awaiting a
 * product/clinical owner. Each rejects with `EndpointNotImplementedError`
 * naming ADR-033 rather than calling a path that does not exist.
 *
 * This is the same partial shape the doctor adapter takes, and for a
 * sharper reason: the appointment writes are not merely unbuilt. ADR-001
 * says which statuses may follow which and **not who may make a
 * transition**. A client that guessed would be putting clinical-operations
 * policy in a mobile app.
 *
 * ── What is deliberately NOT mapped ──────────────────────────────────
 *
 * `availableActions` and `proposedSlots` are left `undefined`, not `[]`.
 * See `model/types.ts` — `[]` asserts "no action is available", which is
 * a statement about policy that nobody has made.
 *
 * ── The one place a device clock is used, and what it costs ──────────
 *
 * `list('upcoming')` sends `upcoming=true`, which the server resolves
 * against its own clock — correct, and immune to a wrong device clock.
 *
 * `list('past')` has no such shorthand: `upcoming=false` is accepted by
 * the query schema but the service only acts on `true`
 * (`patient-appointment.service.ts` — `from: query.from ?? (upcoming ===
 * true ? new Date() : undefined)`), so there is no server-side "before
 * now". The adapter therefore sends `to=<device now>`, using a parameter
 * the contract defines rather than inventing one.
 *
 * ── Pages ───────────────────────────────────────────────────────────
 *
 * `page` is passed through and `hasMore` is derived from the server's
 * `page`/`totalPages`. Before this the adapter asked for page one and
 * returned `items` alone, so a patient with a longer history than one
 * page could not reach the rest of it and nothing said so — the silent
 * half of the same gap G-02 closed for doctor search.
 *
 * The cost is stated rather than hidden: a device whose clock is wrong
 * partitions Upcoming and Past at the wrong instant. Nothing else drifts
 * — every timestamp still renders from the server's value and the
 * clinic's timezone. Closing it needs one line in the backend service
 * (`upcoming === false` → `to: new Date()`), which is a backend change
 * and not this branch's to make. Recorded as a cross-branch dependency
 * in the checklist row.
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
  };
}

function toDetail(wire: WireAppointmentDetail): AppointmentDetail {
  return {
    ...toAppointment(wire, wire.clinicTimezone),
    notes: wire.notes,
    cancelledReason: wire.cancelledReason,
    events: wire.events.map(toEvent),
  };
}

/** Every write route below is ADR-033's, and none of them exists. */
function blocked<T>(capability: MessageKey): Promise<T> {
  return Promise.reject(new EndpointNotImplementedError('ADR-033', capability));
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

  listSlots(): Promise<readonly BookableSlot[]> {
    return blocked('capability.slots');
  },

  book(): Promise<Appointment> {
    return blocked('capability.booking');
  },

  cancel(): Promise<Appointment> {
    return blocked('capability.cancel');
  },

  requestReschedule(): Promise<Appointment> {
    return blocked('capability.reschedule');
  },

  acceptProposal(): Promise<Appointment> {
    return blocked('capability.acceptProposal');
  },
};
