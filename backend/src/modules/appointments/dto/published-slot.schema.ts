import { z } from 'zod';

/**
 * Published slots and patient booking — `API_CONTRACT_CHANGES.md` §6
 * (DR-10, DR-11, OD-08, OD-09, OD-14).
 *
 * Field names are the contract's: `durationMin` (the wire name every
 * appointment payload already uses) and `slotId`. Every object is
 * `.strict()`: a client that sends `hospitalId`, `doctorId` or a time on a
 * booking is told so with a 422, rather than having the value silently
 * ignored — those are derived from the slot and the session, never taken
 * from the body (contract §0 rule 2).
 */

/**
 * The same bounds `POST /appointments` puts on `durationMin` (API §5.3),
 * so a published slot can never describe an appointment the doctor's own
 * booking route would refuse.
 */
const durationMin = z.coerce.number().int().min(5).max(480);

const publishedSlotInput = z
  .object({
    startsAt: z.coerce.date(),
    durationMin,
  })
  .strict();

/**
 * Most slots one request may publish. A bound, not a policy: one clinic
 * day of 5-minute slots is 96; this leaves room for that and stops a
 * request from holding the doctor's schedule lock for an unbounded batch.
 */
export const MAX_SLOTS_PER_REQUEST = 100;

/**
 * `POST /me/published-slots` — the contract's array, or a single object
 * for convenience. Both normalise to an array; the batch is all-or-nothing.
 */
export const publishSlotsSchema = z
  .union([publishedSlotInput, z.array(publishedSlotInput).min(1).max(MAX_SLOTS_PER_REQUEST)])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export type PublishSlotsInput = z.infer<typeof publishSlotsSchema>;

const window = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

const fromNotAfterTo = <T extends { from?: Date | undefined; to?: Date | undefined }>(
  query: T,
): boolean => query.from === undefined || query.to === undefined || query.from <= query.to;

/** `GET /me/published-slots?from&to&page&pageSize` — the doctor's own slots. */
export const publishedSlotListSchema = z
  .object({
    ...window,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(fromNotAfterTo, { message: '`from` must not be after `to`', path: ['from'] });

export type PublishedSlotListQuery = z.infer<typeof publishedSlotListSchema>;

