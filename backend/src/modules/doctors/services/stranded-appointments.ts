/**
 * Which booked appointments a weekly grid no longer covers (BR-DEC-005,
 * DEC-005 — API §3.8).
 *
 * ## Why this is computed here and not only in the client
 *
 * The client already warns before a save, but it reads appointment times
 * in the **device's** timezone, because until now no doctor-reachable
 * endpoint served the clinic's. A doctor travelling, or a laptop set to
 * the wrong zone, sees the wrong list; and a save made through the API
 * directly saw none at all. The grid is a clinic-local wall clock
 * (`09:00` means nine in the clinic), so the only exact answer is the one
 * computed in `platform_settings.localization.timezone`.
 *
 * ## The rule
 *
 * An appointment is **covered** when, read in the clinic's timezone, it
 * starts and ends on the same day, lies wholly inside one working window
 * of that weekday, and overlaps none of that day's breaks. Anything else
 * is **stranded**: a closed day, a shortened window, a new break across
 * it, or a visit running past midnight. Partial coverage is stranded —
 * the second half of a visit outside the doctor's hours is still a visit
 * outside the doctor's hours.
 *
 * Pure, with the clock and the zone as arguments, so the DST and
 * day-boundary cases are unit tests rather than hopes.
 */

import type { WeekdayWire } from '../dto/availability.schema';

export interface GridDay {
  readonly weekday: WeekdayWire;
  readonly windows: readonly { readonly start: string; readonly end: string }[];
  readonly breaks: readonly { readonly start: string; readonly end: string }[];
}

export interface BookedAppointment {
  readonly startsAt: Date;
  readonly durationMin: number;
}

interface LocalTime {
  readonly date: string;
  readonly weekday: string;
  readonly minutes: number;
}

/** `true` when `timeZone` is an IANA zone this runtime can format in. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The appointments in `booked` the grid `week` does not cover, in `timeZone`. */
export function strandedBy<T extends BookedAppointment>(
  week: readonly GridDay[],
  booked: readonly T[],
  timeZone: string,
): T[] {
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const local = (instant: Date): LocalTime => {
    const parts = Object.fromEntries(
      format.formatToParts(instant).map((part) => [part.type, part.value]),
    );

    return {
      date: `${parts['year']}-${parts['month']}-${parts['day']}`,
      weekday: parts['weekday'] ?? '',
      minutes: Number(parts['hour']) * 60 + Number(parts['minute']),
    };
  };

  return booked.filter((appointment) => {
    const start = local(appointment.startsAt);
    const end = local(new Date(appointment.startsAt.getTime() + appointment.durationMin * 60_000));

    // A visit that crosses midnight cannot fit in a window, which never
    // does — except one ending exactly at midnight, read as 24:00.
    const endMinutes =
      end.date === start.date ? end.minutes : end.minutes === 0 ? 24 * 60 : Number.NaN;
    if (Number.isNaN(endMinutes)) return true;

    const day = week.find((entry) => entry.weekday === start.weekday);
    if (day === undefined) return true;

    const inWindow = day.windows.some(
      (window) => clock(window.start) <= start.minutes && endMinutes <= clock(window.end),
    );
    const onBreak = day.breaks.some(
      (pause) => clock(pause.start) < endMinutes && start.minutes < clock(pause.end),
    );

    return !inWindow || onBreak;
  });
}

/** `HH:MM` → minutes past midnight. */
function clock(value: string): number {
  const [hours, minutes] = value.split(':');

  return Number(hours) * 60 + Number(minutes);
}
