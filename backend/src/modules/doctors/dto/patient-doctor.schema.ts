/**
 * Query validation for the patient-facing doctor routes.
 *
 * Bounds come from `BACKEND_API_CONTRACT.md` §0.2's `ListParams` — page
 * 1-based defaulting to 1, `pageSize` defaulting to 20 and capped at 100
 * — rather than from a number chosen here, so one rule governs every
 * paginated route in the platform.
 *
 * The cap is not politeness. There is no rate limiting anywhere in this
 * backend yet (audit BE-17/R-9), so an uncapped `pageSize` would let one
 * request pull the clinic's entire practitioner roster in a single round
 * trip. `.max(100)` is the only thing standing between a mobile client
 * and that today.
 */

import { z } from 'zod';

/** `?q=` — bounded so a pathological string cannot reach the database. */
const searchTerm = z.string().trim().min(1).max(120);

export const doctorSearchSchema = z.object({
  q: searchTerm.optional(),
  specialtyId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  // Whitelisted rather than free-form (`ListParams`: "whitelisted per
  // endpoint"). An open `sort` is an invitation to order by a column the
  // projection deliberately does not return.
  sort: z.enum(['name:asc', 'name:desc', 'rating:desc']).default('name:asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type DoctorSearchQuery = z.infer<typeof doctorSearchSchema>;
