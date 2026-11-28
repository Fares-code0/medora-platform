import { z } from 'zod';

import { envelopeSchema, paginatedSchema, parseResponse } from '@/schemas/envelope';
import { APPOINTMENT_PRIORITIES, APPOINTMENT_STATUSES } from '@/types/vocabularies';

import { apiClient } from '../client';

/**
 * The HTTP appointment adapter — reads, booking, cancellation and the
 * reschedule REQUEST workflow.
 *
 * ── The routes (patient-app end-to-end contract §2, §3) ──────────────
 *
 *   GET  /me/appointments                          list
 *   GET  /me/appointments/{id}                     detail
 *   GET  /patient/doctors/{doctorId}/slots         published, unbooked, future slots
 *   GET  /patient/visit-types                      the booking form's optional select
 *   POST /me/appointments                          book (Idempotency-Key)
 *   POST /me/appointments/{id}/cancel              cancel with a closed-list reason code
 *   POST /me/appointments/{id}/reschedule-requests request a new time (Idempotency-Key)
 *   GET  /me/appointments/{id}/reschedule-requests history, newest first
 *   POST /me/reschedule-requests/{id}/withdraw     withdraw a pending request
 *
 * ── Rescheduling is a request, not a move (ADR-033 Q2 = R-B) ─────────
 *
 * The original appointment stays booked until the hospital approves, and
 * the requested slot is NOT held. Nothing in this file moves an
 * appointment; `reschedule-requests` creates a row staff then approve or
 * reject.
 *
 * ── `availableActions` is the server's, and required ─────────────────
 *
 * Every appointment payload carries `availableActions`, computed by the
 * same rule the write routes enforce. It is required here: a payload
 * without it fails at the seam instead of rendering no buttons on the
 * strength of an absence. Policy is never derived from `status` in the
 * client.
 *
 * ── Timezones ────────────────────────────────────────────────────────
 *
 * Every timestamp is ISO-8601 UTC and `clinicTimezone` is the clinic's
 * IANA zone. **Format with it; never compute.** "Today" is a question
 * about the clinic's zone, not the device's — a travelling patient
 * changes their device zone, not their appointment (audit R-12).
 */

const doctorSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  title: z.string().nullable(),
  specialty: z.string(),
  photoUrl: z.string().nullable(),
});

/**
 * `status` and `priority` are validated against this client's own
 * vocabularies rather than accepted as strings. A backend that added a
 * ninth status would fail loudly at the seam instead of rendering an
 * unknown badge, and `parity.test.ts` already binds those vocabularies to
 * the Prisma enums — so the two checks together mean a new status is
 * caught whether it reaches this client through the wire or through a
 * schema edit.
 */
/** The hospital an appointment or slot belongs to. Absent hospital → null, never invented. */
const hospitalRefSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });

export const APPOINTMENT_ACTIONS = ['cancel', 'reschedule'] as const;
export const CANCEL_REASON_CODES = [
  'schedule_conflict',
  'feeling_better',
  'booked_elsewhere',
  'transport',
  'cost',
  'other',
] as const;
export const RESCHEDULE_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'superseded',
] as const;

const requestedSlotSchema = z.object({
  id: z.string().min(1),
  startsAt: z.string().min(1),
  durationMin: z.number(),
});

const rescheduleRequestSchema = z.object({
  id: z.string().min(1),
  appointmentId: z.string().min(1),
  status: z.enum(RESCHEDULE_REQUEST_STATUSES),
  requestedSlot: requestedSlotSchema,
  note: z.string().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.string().min(1),
  decidedAt: z.string().nullable(),
});

const summarySchema = z.object({
  id: z.string().min(1),
  startsAt: z.string().min(1),
  durationMin: z.number(),
  status: z.enum(APPOINTMENT_STATUSES),
  priority: z.enum(APPOINTMENT_PRIORITIES),
  reason: z.string(),
  isNewPatient: z.boolean(),
  isFollowUp: z.boolean(),
  visitType: z.string(),
  departmentName: z.string().nullable(),
  doctor: doctorSchema,
  hospital: hospitalRefSchema.nullish(),
  availableActions: z.array(z.enum(APPOINTMENT_ACTIONS)),
});

/**
 * `actor` is a coarse category and never a staff member's name, id or
 * email — the database stores `actor_name` and it is deliberately not
 * projected. An appointment history is not a route into the clinic's
 * staff directory, so this client declares the three values it may see
 * and would fail rather than render a fourth.
 */
const eventSchema = z.object({
  action: z.string(),
  fromStatus: z.enum(APPOINTMENT_STATUSES).nullable(),
  toStatus: z.enum(APPOINTMENT_STATUSES).nullable(),
  occurredAt: z.string().min(1),
  actor: z.enum(['patient', 'clinic', 'system']),
  reason: z.string().nullable(),
});

const detailSchema = summarySchema.extend({
  notes: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  clinicTimezone: z.string().min(1),
  pendingRescheduleRequest: rescheduleRequestSchema.nullish(),
  events: z.array(eventSchema),
});

const listResponseSchema = envelopeSchema(
  paginatedSchema(summarySchema).extend({ clinicTimezone: z.string().min(1) }),
);
const detailResponseSchema = envelopeSchema(detailSchema);

const slotSchema = z.object({
  id: z.string().min(1),
  startsAt: z.string().min(1),
  durationMin: z.number(),
  hospital: hospitalRefSchema,
});
const slotsResponseSchema = envelopeSchema(z.array(slotSchema));

const visitTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  durationMin: z.number().nullable(),
});
const visitTypesResponseSchema = envelopeSchema(z.array(visitTypeSchema));

const rescheduleRequestResponseSchema = envelopeSchema(rescheduleRequestSchema);
const rescheduleRequestsResponseSchema = envelopeSchema(z.array(rescheduleRequestSchema));

export type WireSlot = z.infer<typeof slotSchema>;
export type WireVisitType = z.infer<typeof visitTypeSchema>;
export type WireRescheduleRequest = z.infer<typeof rescheduleRequestSchema>;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export interface BookBody {
  readonly slotId: string;
  readonly reason: string;
  readonly visitTypeId?: string | undefined;
  readonly notes?: string | undefined;
}

export interface CancelBody {
  readonly reasonCode: CancelReasonCode;
  readonly note?: string | undefined;
}

export interface RescheduleRequestBody {
  readonly slotId: string;
  readonly note?: string | undefined;
}

export type WireAppointmentSummary = z.infer<typeof summarySchema>;
export type WireAppointmentDetail = z.infer<typeof detailSchema>;
export type WireAppointmentEvent = z.infer<typeof eventSchema>;

/**
 * The query, bounded by `patientAppointmentQuerySchema` on the server.
 *
 * `upcoming` is a server-side shorthand for `from=now` and is the only
 * correct way to ask for future appointments: it resolves against the
 * clinic's clock, so a device with a wrong one cannot shift the
 * boundary.
 */
export interface AppointmentListQuery {
  readonly upcoming?: boolean | undefined;
  readonly to?: string | undefined;
  readonly sort?: 'startsAt:asc' | 'startsAt:desc' | undefined;
  readonly page?: number | undefined;
}

export const appointmentEndpoints = {
  async list(query: AppointmentListQuery) {
    const raw = await apiClient.get<unknown>('me/appointments', {
      params: {
        upcoming: query.upcoming === true ? 'true' : undefined,
        to: query.to,
        sort: query.sort,
        page: query.page,
      },
    });
    return parseResponse('GET /me/appointments', listResponseSchema, raw);
  },

  /**
   * An unknown id, another patient's appointment and an unlinked account
   * all answer the same **404**. Never 403 — a 403 would confirm the
   * appointment exists and would let a client walk `APT-…` ids to learn
   * the clinic's booking volume.
   */
  async byId(appointmentId: string) {
    const raw = await apiClient.get<unknown>(
      `me/appointments/${encodeURIComponent(appointmentId)}`,
    );
    return parseResponse('GET /me/appointments/{id}', detailResponseSchema, raw);
  },

  /**
   * Published, unbooked, future slots for one doctor. The window is at
   * most 31 days (the server rejects a wider one with 422).
   */
  async slots(doctorId: string, from: string, to: string, signal?: AbortSignal) {
    const raw = await apiClient.get<unknown>(
      `patient/doctors/${encodeURIComponent(doctorId)}/slots`,
      { params: { from, to }, ...(signal ? { signal } : {}) },
    );
    return parseResponse('GET /patient/doctors/{id}/slots', slotsResponseSchema, raw);
  },

  async visitTypes(signal?: AbortSignal) {
    const raw = await apiClient.get<unknown>('patient/visit-types', signal ? { signal } : {});
    return parseResponse('GET /patient/visit-types', visitTypesResponseSchema, raw);
  },

  /**
   * `Idempotency-Key` is required by the server: the caller owns the key
   * and reuses it for a retry of the same attempt, so a lost response
   * cannot become two appointments.
   */
  async book(body: BookBody, idempotencyKey: string) {
    const raw = await apiClient.post<unknown>('me/appointments', body, { idempotencyKey });
    return parseResponse('POST /me/appointments', detailResponseSchema, raw);
  },

  async cancel(appointmentId: string, body: CancelBody) {
    const raw = await apiClient.post<unknown>(
      `me/appointments/${encodeURIComponent(appointmentId)}/cancel`,
      body,
    );
    return parseResponse('POST /me/appointments/{id}/cancel', detailResponseSchema, raw);
  },

  async requestReschedule(
    appointmentId: string,
    body: RescheduleRequestBody,
    idempotencyKey: string,
  ) {
    const raw = await apiClient.post<unknown>(
      `me/appointments/${encodeURIComponent(appointmentId)}/reschedule-requests`,
      body,
      { idempotencyKey },
    );
    return parseResponse(
      'POST /me/appointments/{id}/reschedule-requests',
      rescheduleRequestResponseSchema,
      raw,
    );
  },

  async rescheduleRequests(appointmentId: string) {
    const raw = await apiClient.get<unknown>(
      `me/appointments/${encodeURIComponent(appointmentId)}/reschedule-requests`,
    );
    return parseResponse(
      'GET /me/appointments/{id}/reschedule-requests',
      rescheduleRequestsResponseSchema,
      raw,
    );
  },

  async withdrawRescheduleRequest(requestId: string) {
    const raw = await apiClient.post<unknown>(
      `me/reschedule-requests/${encodeURIComponent(requestId)}/withdraw`,
    );
    return parseResponse(
      'POST /me/reschedule-requests/{id}/withdraw',
      rescheduleRequestResponseSchema,
      raw,
    );
  },
};
