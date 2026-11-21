/**
 * Civil time in the clinic's timezone (ADR-001, ADR-005 §4).
 *
 * Two rules in this module are stated against the clinic's wall clock
 * rather than against UTC, and both are wrong by up to a day if that
 * distinction is dropped:
 *
 *  - ADR-001: `completed` and `no-show` are legal only once the slot
 *    date has passed **in the clinic's configured timezone**. A UTC
 *    comparison lets a doctor in UTC+10 mark an appointment complete
 *    the evening before it happens.
 *  - ADR-005 §4 rules 1–2: a `doctor_availability` row is a weekday
 *    plus a `time(0)`, which is civil time. Matching a UTC instant
 *    against it puts a 09:00 clinic slot outside a 09:00–17:00 window
 *    whenever the offset is non-zero.
 *
 * `Intl.DateTimeFormat` is the whole implementation. It ships with Node
 * 20's full-icu build, knows the IANA database including historical DST
 * rules, and is the only correct way to answer "what day was it there"
 * without a timezone dependency. `formatToParts` rather than a formatted
 * string because a locale's ordering is a presentation decision and
 * these values are compared, not shown.
 *
 * An unknown zone throws `RangeError` from the `Intl` constructor. Every
 * entry point here falls back to UTC instead: the zone comes from an
 * operator-editable settings row, and a typo in it must not take the
 * appointment book down. `PlatformClinicTimezone` already makes the same
 * choice for the same reason.
 */

import type { Weekday } from '../../../generated/prisma/enums';

/** Prisma's `Weekday`, indexed the way `Intl`'s `weekday: 'short'` reads. */
const WEEKDAY_BY_SHORT_NAME: Readonly<Record<string, Weekday>> = {
  Mon: 'MON',
  Tue: 'TUE',
  Wed: 'WED',
  Thu: 'THU',
  Fri: 'FRI',
  Sat: 'SAT',
  Sun: 'SUN',
};

const UTC = 'UTC';

/**
 * One formatter per zone, built once.
 *
 * `Intl.DateTimeFormat` construction is the expensive part — it resolves
 * the zone against ICU — and the conflict check calls this several times
 * per candidate slot. The cache is keyed by zone and is unbounded only
 * in the sense that the set of zones a clinic configures is one.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    // An operator typo in the localization slice, not a programming
    // error. UTC is what every timestamp on the wire already is.
    //
    // Guarded against recursion rather than trusting that `UTC` cannot
    // throw: a fallback that can loop is worse than the typo it handles.
    if (timeZone === UTC) throw new Error('The UTC timezone is unavailable in this runtime');
    formatter = formatterFor(UTC);
  }

  formatters.set(timeZone, formatter);

  return formatter;
}

/** The civil fields of one instant, as the clinic's clock shows them. */
export interface CivilMoment {
  /** `YYYY-MM-DD`. Lexicographically ordered, so `<=` compares dates. */
  readonly date: string;
  /** `HH:MM`, 24-hour. Same ordering property. */
  readonly time: string;
  readonly weekday: Weekday;
}

export function civilMoment(instant: Date, timeZone: string): CivilMoment {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  // `hour12: false` still renders midnight as `24` in some ICU versions
  // — a documented quirk of the `en-US` hour cycle. Normalising it here
  // keeps `00:30` from sorting after `23:30` on the same civil day.
  const hour = read('hour') === '24' ? '00' : read('hour');

  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${hour}:${read('minute')}`,
    weekday: WEEKDAY_BY_SHORT_NAME[read('weekday')] ?? 'MON',
  };
}

/** `YYYY-MM-DD` for an instant in the clinic's zone. */
export function civilDate(instant: Date, timeZone: string): string {
  return civilMoment(instant, timeZone).date;
}

/**
 * Whether the slot's civil date is today or earlier — ADR-001's gate on
 * `completed` and `no-show`.
 *
 * The comparison is by **date**, not by instant: the contract says "slot
 * date ≤ today", and `availableActions()` on the frontend derives the
 * same buttons from `dayDiffFromToday`. Comparing instants instead would
 * refuse to complete a visit that has already happened this morning.
 */
export function slotDateHasArrived(slotStart: Date, timeZone: string, now: Date): boolean {
  return civilDate(slotStart, timeZone) <= civilDate(now, timeZone);
}

/**
 * `HH:MM` for a `time(0)` column value.
 *
 * Prisma round-trips `time(0)` as a `Date` on the Unix epoch in UTC, so
 * the civil time is read with the UTC accessors and never with the
 * local-time ones — the same reasoning `AvailabilityService.toRow`
 * gives when it builds these values.
 */
export function timeOfDay(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');

  return `${hours}:${minutes}`;
}

/**
 * Civil `HH:MM` of a slot's end, given its start and duration.
 *
 * Computed from the end **instant** rather than by adding minutes to the
 * start's civil time, so a slot that crosses a DST boundary is measured
 * the way a clock on the wall measures it. An appointment that starts at
 * 01:30 and runs 60 minutes through a spring-forward ends at 03:30 civil
 * time, and the working window it must fit inside is civil time too.
 */
export function slotEndTime(start: Date, durationMin: number, timeZone: string): string {
  return civilMoment(new Date(start.getTime() + durationMin * 60_000), timeZone).time;
}

/**
 * Whether the slot stays within one civil day.
 *
 * Rules 1 and 2 of ADR-005 §4 compare against a single weekday's rows,
 * which is only meaningful if the slot does not cross midnight. One that
 * does is refused rather than silently checked against its start day —
 * a 23:00 slot running 120 minutes is not inside a 09:00–17:00 Monday
 * window however the arithmetic is arranged.
 */
export function staysWithinOneDay(start: Date, durationMin: number, timeZone: string): boolean {
  const end = new Date(start.getTime() + durationMin * 60_000);
  // An appointment ending exactly at midnight ends *on* the boundary and
  // is still a same-day slot; only one that runs past it is not.
  const endsAtMidnight = civilMoment(end, timeZone).time === '00:00';

  return endsAtMidnight || civilDate(start, timeZone) === civilDate(end, timeZone);
}
