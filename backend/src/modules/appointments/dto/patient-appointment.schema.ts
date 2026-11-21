/**
 * Query validation for the patient appointment reads.
 *
 * Bounds are API §0.2's `ListParams` — page 1-based, `pageSize` default
 * 20 and capped at 100, `sort` whitelisted per endpoint — so one rule
 * governs every paginated route rather than a number chosen here.
 */

import { z } from 'zod';

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
