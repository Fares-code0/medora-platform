/**
 * Query validation for the patient appointment reads.
 *
 * Bounds are API §0.2's `ListParams` — page 1-based, `pageSize` default
 * 20 and capped at 100, `sort` whitelisted per endpoint — so one rule
 * governs every paginated route rather than a number chosen here.
 */

import { z } from 'zod';

import { CANCEL_REASON_CODES, RESCHEDULE_REQUEST_STATUSES } from '../services/patient-appointment.policy';

import { APPOINTMENT_STATUS_VALUES } from './appointment-enums';

/**
 * `?status=` accepts one value or several.
 *
 * Express parses a repeated query key into an array and a single one into
 * a string, so a schema that expects only one shape rejects half the
 * legitimate requests. Both are normalized to an array here.
 */
const statusFilter = z
  .union([z.enum(APPOINTMENT_STATUS_VALUES), z.array(z.enum(APPOINTMENT_STATUS_VALUES))])
  .transform((value) => (Array.isArray(value) ? value : [value]))
  .optional();

export const patientAppointmentQuerySchema = z
  .object({
    status: statusFilter,
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    // `upcoming=true` is shorthand for `from=now`, which the client would
    // otherwise compute from its own clock — and a device clock is not
    // the clinic's. Server-side is the only correct place for "now".
    upcoming: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    sort: z.enum(['startsAt:asc', 'startsAt:desc']).default('startsAt:desc'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export type PatientAppointmentQuery = z.infer<typeof patientAppointmentQuerySchema>;

/** ADR-049 — the patient write routes and the slot read. */

const UUID_SHAPE = z.string().uuid();

/** The longest window one slot query may span (contract §3). */
export const MAX_SLOT_WINDOW_DAYS = 31;

export const patientSlotQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  })
  .refine(
    (query) =>
      query.from === undefined ||
      query.to === undefined ||
      query.to.getTime() - query.from.getTime() <= MAX_SLOT_WINDOW_DAYS * 86_400_000,
    { message: `The window may span at most ${MAX_SLOT_WINDOW_DAYS} days`, path: ['to'] },
  );

export type PatientSlotQuery = z.infer<typeof patientSlotQuerySchema>;

export const patientBookSchema = z
  .object({
    slotId: UUID_SHAPE,
    reason: z.string().trim().min(3).max(300),
    visitTypeId: UUID_SHAPE.optional(),
    notes: z.string().trim().max(1000).optional(),
  });

export type PatientBookInput = z.infer<typeof patientBookSchema>;

export const patientCancelSchema = z
  .object({
    reasonCode: z.enum(CANCEL_REASON_CODES),
    note: z.string().trim().max(200).optional(),
  });

export type PatientCancelInput = z.infer<typeof patientCancelSchema>;

export const patientRescheduleRequestSchema = z
  .object({
    slotId: UUID_SHAPE,
    note: z.string().trim().max(300).optional(),
  });

export type PatientRescheduleRequestInput = z.infer<typeof patientRescheduleRequestSchema>;

/** Staff: `GET /appointments/reschedule-requests?status=`. */
export const rescheduleRequestListSchema = z.object({
  status: z.enum(RESCHEDULE_REQUEST_STATUSES).default('pending'),
});

export type RescheduleRequestListQuery = z.infer<typeof rescheduleRequestListSchema>;

/** Staff: `POST /appointments/reschedule-requests/:id/reject`. */
export const rejectRescheduleRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(300) });

export type RejectRescheduleRequestInput = z.infer<typeof rejectRescheduleRequestSchema>;
