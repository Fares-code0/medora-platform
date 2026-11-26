/**
 * Query validation for authenticated patient discovery
 * (`API_CONTRACT_CHANGES.md` §5; DR-09, OD-10).
 *
 * `near` is `lat,lng`. Ranges are validated, not clamped: a latitude of 91
 * is a client bug and must not silently produce a plausible distance.
 */

import { z } from 'zod';

const searchTerm = z.string().trim().min(1).max(120);

/** `lat,lng` → `{ latitude, longitude }`, with range checks. */
const near = z
  .string()
  .trim()
  .regex(
    /^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/,
    'Must be "latitude,longitude", for example 24.7136,46.6753',
  )
  .transform((value) => {
    const [lat, lng] = value.split(',').map((part) => Number(part.trim())) as [number, number];
    return { latitude: lat, longitude: lng };
  })
  .superRefine((value, ctx) => {
    if (value.latitude < -90 || value.latitude > 90) {
      ctx.addIssue({ code: 'custom', message: 'Latitude must be between -90 and 90' });
    }
    if (value.longitude < -180 || value.longitude > 180) {
      ctx.addIssue({ code: 'custom', message: 'Longitude must be between -180 and 180' });
    }
  });

const paging = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const discoverySearchSchema = z
  .object({
    q: searchTerm.optional(),
    specialtyId: z.string().uuid().optional(),
    departmentId: z.string().uuid().optional(),
    hospitalId: z.string().uuid().optional(),
    clinicId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    near: near.optional(),
    // `rating` is deliberately absent: DSC-03 (ratings) waits on the owner's
    // moderation policy, so there is nothing honest to order by.
    sort: z.enum(['distance', 'nextAvailable', 'name']).optional(),
    ...paging,
  })
  .refine((query) => query.sort !== 'distance' || query.near !== undefined, {
    path: ['near'],
    message: 'near is required when sort=distance',
  });

export type DiscoverySearchQuery = z.infer<typeof discoverySearchSchema>;

export const hospitalListSchema = z
  .object({
    q: searchTerm.optional(),
    specialtyId: z.string().uuid().optional(),
    near: near.optional(),
    sort: z.enum(['name', 'distance', 'nextAvailable']).optional(),
    ...paging,
  })
  .refine((query) => query.sort !== 'distance' || query.near !== undefined, {
    path: ['near'],
    message: 'near is required when sort=distance',
  });

export type HospitalListQuery = z.infer<typeof hospitalListSchema>;
