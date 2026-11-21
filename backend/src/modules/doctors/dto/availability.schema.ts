/**
 * Request validation for availability and time off (API §3.8–3.9).
 *
 * Everything structural is here; everything relational — overlapping
 * ranges, a break outside its day's working window — is in the service,
 * because a Zod refinement cannot see the other rows it has to compare
 * against and a half-checked rule in two places is worse than one rule
 * in one place.
 */

import { z } from 'zod';

/** `Mon` … `Sun`, matching the `Weekday` enum's wire values. */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type WeekdayWire = (typeof WEEKDAYS)[number];

/**
 * The fixed set API §3.8 names. A free integer would let a clinic book
 * 7-minute slots, and every downstream conflict check assumes the grid
 * divides evenly.
 */
export const SLOT_DURATIONS = [15, 20, 30, 45, 60] as const;

/** `HH:MM`, 24-hour. The column is `time(0)`, so seconds are not accepted. */
const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour');

const timeRange = z
  .object({ start: timeOfDay, end: timeOfDay })
  .refine((range) => range.start < range.end, {
    message: 'The end time must be after the start time',
    path: ['end'],
  });

/**
 * One day of the grid.
 *
 * A closed day with windows is rejected rather than silently emptied:
 * the two states mean different things to whoever saved them, and
 * quietly discarding the windows would lose an edit the user believes
 * they made.
 */
const availabilityDay = z
  .object({
    weekday: z.enum(WEEKDAYS),
    open: z.boolean(),
    windows: z.array(timeRange).max(6, 'At most six windows a day'),
    breaks: z.array(timeRange).max(6, 'At most six breaks a day'),
  })
  .refine((day) => day.open || (day.windows.length === 0 && day.breaks.length === 0), {
    message: 'A closed day cannot carry working hours',
    path: ['windows'],
  })
  .refine((day) => !day.open || day.windows.length > 0, {
    message: 'An open day needs at least one working window',
    path: ['windows'],
  });

/**
 * `PUT /me/availability`.
 *
 * All seven days are required, for the same reason the permission grid
 * requires all five roles: a partial week would have to be merged with
 * the stored one, and "the days you did not mention keep what they had"
 * silently preserves a day the doctor believes they cleared.
 */
export const availabilityUpdateSchema = z.object({
  week: z
    .array(availabilityDay)
    .length(7, 'Send all seven days')
    .refine(
      (week) => new Set(week.map((day) => day.weekday)).size === 7,
      'Each weekday exactly once',
    ),
  defaultDurationMin: z
    .number()
    .int()
    .refine(
      (value) => (SLOT_DURATIONS as readonly number[]).includes(value),
      `Choose one of ${SLOT_DURATIONS.join(', ')} minutes`,
    ),
  bufferMin: z.number().int().min(0).max(60),
});

export type AvailabilityUpdateInput = z.infer<typeof availabilityUpdateSchema>;

/**
 * `POST /me/time-off` — API §3.9.
 *
 * `mode` is the contract's name for `doctor_time_off.auto_behavior`. It
 * is a **pre-selection for the resolution screen**, not an instruction:
 * ADR-005 RA-005.2 is explicit that `reschedule-existing` never moves an
 * appointment on its own, and this endpoint moves none.
 */
export const timeOffSchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    kind: z.enum(['vacation', 'emergency-block']).default('vacation'),
    mode: z.enum(['block-new', 'reschedule-existing']).default('block-new'),
  })
  .refine((body) => new Date(body.from) < new Date(body.to), {
    message: 'The end must be after the start',
    path: ['to'],
  });

export type TimeOffInput = z.infer<typeof timeOffSchema>;
