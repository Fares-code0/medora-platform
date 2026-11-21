import { z } from 'zod';

import { envelopeSchema, paginatedSchema, parseResponse } from '@/schemas/envelope';
import { APPOINTMENT_PRIORITIES, APPOINTMENT_STATUSES } from '@/types/vocabularies';

import { apiClient } from '../client';

/**
 * The HTTP appointment adapter — READS ONLY.
 *
 * ── Two routes exist; four do not ────────────────────────────────────
 *
 * Transcribed from `patient-appointment.controller.ts` and specified in
 * `PATIENT_MOBILE_API_CONTRACT.md` §4:
 *
 *   GET /me/appointments           P4.1  ✅ LIVE
 *   GET /me/appointments/{id}      P4.2  ✅ LIVE
 *
 * `POST /me/appointments`, `/{id}/cancel`, `/{id}/confirm` and
 * `GET /patient/doctors/{id}/slots` are P4.3–P4.6 and are **blocked on
 * ADR-033**, which is proposed and awaiting a product/clinical owner.
 * They are not unbuilt-because-unprioritised: ADR-001's transition table
 * says which statuses may follow which and **not who may make a
 * transition**, and that gap is the blocker. There is therefore no path
 * string for any of them in this file.
 *
 * ── `availableActions` is absent, and that is the contract ───────────
 *
 * Contract §4 states it deliberately: shipping `availableActions: []`
 * would assert "no action is available", which is a claim nobody has the
 * authority to make yet, and the app would show a patient no cancel
 * button on the strength of it. An omitted field is a visible gap; a
 * wrong one is a silent defect. So neither this schema nor the mapper
 * invents the field — `model/types.ts` makes it optional for exactly
 * this reason.
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
  events: z.array(eventSchema),
});

const listResponseSchema = envelopeSchema(
  paginatedSchema(summarySchema).extend({ clinicTimezone: z.string().min(1) }),
);
const detailResponseSchema = envelopeSchema(detailSchema);

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
};
