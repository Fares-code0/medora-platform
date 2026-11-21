import { isUsableTimeZone, wallClockIn } from '@/i18n';

import type { Appointment, AppointmentStatus } from './types';

/**
 * The doctor's weekly availability (DEC-005, API §3.8 — `GET`/`PUT
 * /me/availability`), and the two pure checks the editor runs before a save.
 *
 * ## The rules are the server's, restated
 *
 * `validateWeek` mirrors `availabilityUpdateSchema` and `assertConsistent`
 * in `backend/src/modules/doctors` rule for rule, with the server's own
 * wording, so the editor points at a row before the request is sent. It is
 * a convenience: the server checks the same rules on every `PUT` and its 422
 * is mapped back onto the same rows (`errorsFromFieldErrors`).
 *
 * ## The stranded-appointment check: a preview, then the server's report
 *
 * `strandedAppointments` lists live upcoming appointments that the proposed
 * week no longer covers, by the server's booking rules 1 and 2 (ADR-005 §4:
 * inside a working window, clear of every break, within one civil day).
 * It runs **before** the save, so the doctor sees the list before choosing.
 *
 * The grid is a clinic-local wall clock, so the comparison is made in the
 * **clinic's timezone**, which `GET /me/availability` now serves as
 * `clinicTimezone` (BR-DEC-005). Where a server does not send one the check
 * falls back to the device's zone and the editor says so (DEC-005 rule 7).
 *
 * The server runs the same rule on every save and answers with `stranded`,
 * the appointments the saved week leaves uncovered (BR-DEC-005). That report
 * is exact and is what the editor shows after the save; the preview is the
 * warning before it. Neither moves, cancels or notifies anyone.
 */

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};

/** The fixed set API §3.8 accepts for the default appointment length. */
export const SLOT_DURATIONS = [15, 20, 30, 45, 60] as const;

export const BUFFER_MIN = 0;
export const BUFFER_MAX = 60;

/** At most six working windows and six breaks a day. */
export const MAX_RANGES_PER_DAY = 6;

export interface TimeRange {
  /** `HH:MM`, 24-hour, clinic-local civil time. */
  readonly start: string;
  readonly end: string;
}

export interface AvailabilityDay {
  readonly weekday: Weekday;
  /** False when the doctor does not work that day at all. */
  readonly open: boolean;
  readonly windows: readonly TimeRange[];
  readonly breaks: readonly TimeRange[];
}

export interface WeeklyAvailability {
  /** Always seven days, Monday first. */
  readonly week: readonly AvailabilityDay[];
  readonly defaultDurationMin: number;
  readonly bufferMin: number;
  /**
   * The IANA zone the grid is read in — the clinic's (BR-DEC-005). `null`
   * when the source does not say, and the device's zone is used instead,
   * with the editor saying so. Read-only: never sent on a save.
   */
  readonly clinicTimezone: string | null;
}

/**
 * One appointment the server reports the saved week no longer covers
 * (`PUT /me/availability` → `stranded[]`, BR-DEC-005). The server names the
 * patient by handle, never by name.
 */
export interface ReportedStrandedAppointment {
  readonly id: string;
  /** ISO 8601 instant. */
  readonly dateTime: string;
  readonly durationMin: number;
  readonly status: string;
  readonly patientId: string;
}

export interface AvailabilitySaveResult {
  /** The grid as the server stored it. */
  readonly saved: WeeklyAvailability;
  /**
   * The server's report of live appointments the saved week leaves
   * uncovered, or `null` when the source makes no report (a server from
   * before BR-DEC-005, or the demo) — never `[]` standing in for "unknown".
   */
  readonly stranded: readonly ReportedStrandedAppointment[] | null;
}

export interface AvailabilityService {
  get(): Promise<WeeklyAvailability>;
  /** Replaces the whole week, and says what the saved week strands. */
  replace(next: WeeklyAvailability): Promise<AvailabilitySaveResult>;
}

/* ── Validation ─────────────────────────────────────────────────── */

/** Problems keyed by day, plus the two week-wide fields. */
export interface WeekErrors {
  readonly days: Readonly<Partial<Record<Weekday, readonly string[]>>>;
  readonly defaultDurationMin?: string;
  readonly bufferMin?: string;
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

export function hasErrors(errors: WeekErrors): boolean {
  return (
    Object.values(errors.days).some((list) => list.length > 0) ||
    errors.defaultDurationMin !== undefined ||
    errors.bufferMin !== undefined
  );
}

/** Whether any two ranges share a minute. Touching endpoints do not. */
function overlaps(ranges: readonly TimeRange[]): boolean {
  const sorted = [...ranges].sort((left, right) => left.start.localeCompare(right.start));
  return sorted.some((range, index) => index > 0 && range.start < (sorted[index - 1]?.end ?? ''));
}

function rangeProblems(ranges: readonly TimeRange[], noun: string): string[] {
  const problems: string[] = [];
  for (const [index, range] of ranges.entries()) {
    const label = `${noun} ${String(index + 1)}`;
    if (!TIME_OF_DAY.test(range.start) || !TIME_OF_DAY.test(range.end)) {
      problems.push(`${label}: use HH:MM, 24-hour`);
    } else if (range.start >= range.end) {
      problems.push(`${label}: the end time must be after the start time`);
    }
  }
  return problems;
}

function dayProblems(day: AvailabilityDay): string[] {
  if (!day.open) {
    // The server refuses a closed day carrying hours; the editor clears them
    // when a day is closed, so this is reached only by a malformed grid.
    return day.windows.length > 0 || day.breaks.length > 0
      ? ['A closed day cannot carry working hours']
      : [];
  }

  const problems: string[] = [];
  if (day.windows.length === 0) problems.push('An open day needs at least one working window');
  if (day.windows.length > MAX_RANGES_PER_DAY) problems.push('At most six windows a day');
  if (day.breaks.length > MAX_RANGES_PER_DAY) problems.push('At most six breaks a day');

  const shape = [...rangeProblems(day.windows, 'Window'), ...rangeProblems(day.breaks, 'Break')];
  problems.push(...shape);
  // The relational rules compare valid ranges only, as the server's do
  // (its schema refuses a malformed range before they run).
  if (shape.length > 0) return problems;

  if (overlaps(day.windows)) problems.push('Working windows on one day cannot overlap');
  if (overlaps(day.breaks)) problems.push('Breaks cannot overlap');
  for (const [index, pause] of day.breaks.entries()) {
    const inside = day.windows.some(
      (window) => pause.start >= window.start && pause.end <= window.end,
    );
    if (!inside)
      problems.push(`Break ${String(index + 1)}: a break must fall inside a working window`);
  }
  return problems;
}

export function validateWeek(availability: WeeklyAvailability): WeekErrors {
  const days: Partial<Record<Weekday, readonly string[]>> = {};
  for (const day of availability.week) {
    const problems = dayProblems(day);
    if (problems.length > 0) days[day.weekday] = problems;
  }
  return {
    days,
    ...((SLOT_DURATIONS as readonly number[]).includes(availability.defaultDurationMin)
      ? {}
      : { defaultDurationMin: `Choose one of ${SLOT_DURATIONS.join(', ')} minutes` }),
    ...(Number.isInteger(availability.bufferMin) &&
    availability.bufferMin >= BUFFER_MIN &&
    availability.bufferMin <= BUFFER_MAX
      ? {}
      : {
          bufferMin: `Use a whole number from ${String(BUFFER_MIN)} to ${String(BUFFER_MAX)} minutes`,
        }),
  };
}

/**
 * The server's 422 `fieldErrors` (`week[2].breaks[0]`, `bufferMin`, …)
 * mapped onto the same shape, so a refusal the client did not predict still
 * lands on the right day. A key naming no day is kept under `general`.
 */
export function errorsFromFieldErrors(
  week: readonly AvailabilityDay[],
  fieldErrors: Readonly<Record<string, readonly string[]>>,
): WeekErrors & { readonly general: readonly string[] } {
  const days: Partial<Record<Weekday, string[]>> = {};
  const general: string[] = [];
  let defaultDurationMin: string | undefined;
  let bufferMin: string | undefined;

  for (const [key, messages] of Object.entries(fieldErrors)) {
    const dayIndex = /^week\[(\d+)\]/.exec(key)?.[1];
    const weekday = dayIndex === undefined ? undefined : week[Number(dayIndex)]?.weekday;
    if (weekday !== undefined) {
      (days[weekday] ??= []).push(...messages);
    } else if (key === 'defaultDurationMin') {
      defaultDurationMin = messages.join(' ');
    } else if (key === 'bufferMin') {
      bufferMin = messages.join(' ');
    } else {
      general.push(...messages);
    }
  }
  return {
    days,
    general,
    ...(defaultDurationMin === undefined ? {} : { defaultDurationMin }),
    ...(bufferMin === undefined ? {} : { bufferMin }),
  };
}

/* ── Stranded appointments ─────────────────────────────────────── */

/**
 * The statuses that occupy the book — the server's `LIVE_STATUSES`. A
 * cancelled, completed or no-show appointment is not stranded by anything.
 */
export const LIVE_STATUSES: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  'scheduled',
  'confirmed',
  'pending',
  'rescheduled',
  'awaiting-patient',
]);

export type StrandReason = 'closed-day' | 'outside-hours' | 'inside-break';

export interface StrandedAppointment {
  readonly appointment: Appointment;
  readonly reason: StrandReason;
  /** True when the current, saved week does not cover it either. */
  readonly alreadyOutside: boolean;
}

export const STRAND_REASON_LABELS: Readonly<Record<StrandReason, string>> = {
  'closed-day': 'The day is closed',
  'outside-hours': 'Outside the working hours',
  'inside-break': 'Overlaps a break',
};

/** `zone` when this runtime can read times in it, else `null` (the device's zone). */
export function zoneOrDevice(zone: string | null): string | null {
  return zone !== null && zone !== '' && isUsableTimeZone(zone) ? zone : null;
}

function minutesOf(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/**
 * Why `week` does not cover an appointment, or `null` when it does — rules
 * 1 and 2 of the server's check, read in `timeZone` (the clinic's; `null`
 * for the device's).
 */
export function uncoveredReason(
  appointment: Pick<Appointment, 'dateTime' | 'durationMin'>,
  week: readonly AvailabilityDay[],
  timeZone: string | null = null,
): StrandReason | null {
  const startsAt = new Date(appointment.dateTime);
  const start = wallClockIn(startsAt, timeZone);
  const end = wallClockIn(
    new Date(startsAt.getTime() + appointment.durationMin * 60_000),
    timeZone,
  );
  const day = week.find((candidate) => candidate.weekday === start.weekday);
  if (day === undefined || !day.open) return 'closed-day';

  // An appointment may not run past midnight (`staysWithinOneDay`); one that
  // ends exactly at midnight ends at 24:00, which a window ending 23:59 does
  // not reach and the server reads the same way.
  const endMinutes =
    end.date === start.date ? end.minutes : end.minutes === 0 ? 24 * 60 : Number.NaN;
  if (Number.isNaN(endMinutes)) return 'outside-hours';

  const inside = day.windows.some(
    (window) => minutesOf(window.start) <= start.minutes && endMinutes <= minutesOf(window.end),
  );
  if (!inside) return 'outside-hours';
  const inBreak = day.breaks.some(
    (pause) => start.minutes < minutesOf(pause.end) && minutesOf(pause.start) < endMinutes,
  );
  return inBreak ? 'inside-break' : null;
}

/**
 * Live appointments starting after `now` that `proposed` would leave
 * uncovered, soonest first, read in `timeZone`. Nothing here moves or
 * cancels anything.
 */
export function strandedAppointments(
  appointments: readonly Appointment[],
  current: readonly AvailabilityDay[],
  proposed: readonly AvailabilityDay[],
  now: Date,
  timeZone: string | null = null,
): readonly StrandedAppointment[] {
  return appointments
    .filter(
      (appointment) =>
        LIVE_STATUSES.has(appointment.status) && new Date(appointment.dateTime) > now,
    )
    .flatMap((appointment) => {
      const reason = uncoveredReason(appointment, proposed, timeZone);
      return reason === null
        ? []
        : [
            {
              appointment,
              reason,
              alreadyOutside: uncoveredReason(appointment, current, timeZone) !== null,
            },
          ];
    })
    .sort((left, right) => left.appointment.dateTime.localeCompare(right.appointment.dateTime));
}

/** One line of a stranded-appointment list, from either the preview or the server's report. */
export interface StrandedRow {
  readonly id: string;
  readonly dateTime: string;
  /** The patient's name where the client knows it, else the server's handle. */
  readonly patientLabel: string;
  /** `null` when the client's reading of the rule finds the appointment covered. */
  readonly reason: StrandReason | null;
  readonly alreadyOutside: boolean;
}

export function rowsFromPreview(stranded: readonly StrandedAppointment[]): readonly StrandedRow[] {
  return stranded.map(({ appointment, reason, alreadyOutside }) => ({
    id: appointment.id,
    dateTime: appointment.dateTime,
    patientLabel: appointment.patient.name,
    reason,
    alreadyOutside,
  }));
}

/**
 * The server's report as rows: names joined from the book the preview read
 * (by appointment id), the reason and "already outside" restated by the same
 * rule. The server's list decides *which* appointments are shown; the client
 * only labels them.
 */
export function rowsFromReport(
  report: readonly ReportedStrandedAppointment[],
  book: readonly Appointment[],
  previous: readonly AvailabilityDay[],
  saved: readonly AvailabilityDay[],
  timeZone: string | null,
): readonly StrandedRow[] {
  const byId = new Map(book.map((appointment) => [appointment.id, appointment]));
  return [...report]
    .sort((left, right) => left.dateTime.localeCompare(right.dateTime))
    .map((entry) => ({
      id: entry.id,
      dateTime: entry.dateTime,
      patientLabel: byId.get(entry.id)?.patient.name ?? `Patient ${entry.patientId}`,
      reason: uncoveredReason(entry, saved, timeZone),
      alreadyOutside: uncoveredReason(entry, previous, timeZone) !== null,
    }));
}

/** The week the editor treats as unchanged, for the dirty check. */
export function sameAvailability(left: WeeklyAvailability, right: WeeklyAvailability): boolean {
  const sameRanges = (a: readonly TimeRange[], b: readonly TimeRange[]) =>
    a.length === b.length &&
    a.every((range, index) => range.start === b[index]?.start && range.end === b[index]?.end);
  return (
    left.defaultDurationMin === right.defaultDurationMin &&
    left.bufferMin === right.bufferMin &&
    left.week.length === right.week.length &&
    left.week.every((day, index) => {
      const other = right.week[index];
      return (
        other !== undefined &&
        day.weekday === other.weekday &&
        day.open === other.open &&
        sameRanges(day.windows, other.windows) &&
        sameRanges(day.breaks, other.breaks)
      );
    })
  );
}
