import type { Patient } from '@/features/shared-domain/patient-identity';
import { formatDateWith, isolateLtr, wallClockIn } from '@/i18n';
import { isApiError } from '@/types/api';

import {
  LIVE_STATUSES,
  WEEKDAYS,
  type AvailabilityDay,
  type WeeklyAvailability,
  type Weekday,
} from './availability';
import type { DateKey } from './calendar';
import type { TimeOffBlock } from './time-off-service';
import type { Appointment, AppointmentPatientSnapshot, AppointmentPriority } from './types';

/**
 * The New Appointment flow (`/doctor/appointments/new`) as pure logic.
 *
 * ## The server decides; this restates its rules so the grid is honest
 *
 * `POST /appointments` runs ADR-005 §4's five-rule check
 * (`backend/src/modules/appointments/services/slot-conflict.ts`) and answers
 * 409 `slot_conflict` naming the first rule that refused. The slot grid here
 * is built from the same inputs the server reads — the doctor's weekly hours
 * (`GET /me/availability`), their time off (`GET /me/time-off`) and their book
 * (`GET /appointments`) — and marks a slot unavailable only for one of those
 * rules. It never invents availability: a slot the client cannot rule out is
 * offered, and the server's 409 remains the final word.
 *
 * ## Clinic time, not device time
 *
 * Working hours are a wall clock **in the clinic's timezone**
 * (`clinicTimezone`, BR-DEC-005); the server compares a slot's civil time in
 * that zone. The retired dialog built the instant with
 * `new Date(`${date}T${time}`)`, which reads the wall clock in the *device's*
 * zone — so from a device in another zone, a 09:00 pick became a different
 * clinic hour and the server answered "outside working hours" for a slot
 * that looked valid. Every date and time in this flow is a clinic-zone wall
 * clock, and `instantForWallClock` is the one place it becomes an instant.
 */

/* ── Steps ─────────────────────────────────────────────────────── */

export type BookingStepId = 'patient' | 'schedule' | 'details';

export interface BookingStepMeta {
  readonly id: BookingStepId;
  readonly label: string;
  readonly caption: string;
}

export const BOOKING_STEPS: readonly BookingStepMeta[] = [
  { id: 'patient', label: 'Patient & doctor', caption: 'Who the visit is for, and with whom.' },
  {
    id: 'schedule',
    label: 'Date & time',
    caption: 'A day and an open slot in your working hours.',
  },
  {
    id: 'details',
    label: 'Visit details',
    caption: 'Visit type, priority and reason — then confirm.',
  },
];

const STEP_IDS: readonly BookingStepId[] = BOOKING_STEPS.map((step) => step.id);

export function bookingStepIndex(step: BookingStepId): number {
  return STEP_IDS.indexOf(step);
}

export function previousBookingStep(step: BookingStepId): BookingStepId | null {
  return STEP_IDS[bookingStepIndex(step) - 1] ?? null;
}

export function nextBookingStep(step: BookingStepId): BookingStepId | null {
  return STEP_IDS[bookingStepIndex(step) + 1] ?? null;
}

/* ── The draft ─────────────────────────────────────────────────── */

/** The lengths the retired dialog offered — unchanged. The API accepts 5–480. */
export const BOOKING_DURATIONS: readonly number[] = [15, 30, 45, 60];

/** The API's limit on `reason` (1–300 characters). */
export const REASON_MAX_LENGTH = 300;

export interface BookingDraft {
  readonly patient: AppointmentPatientSnapshot | null;
  readonly department: string;
  /** Clinic-zone civil date, `YYYY-MM-DD`. */
  readonly date: DateKey | null;
  /** Clinic-zone civil time, `HH:MM`. */
  readonly time: string | null;
  readonly durationMin: number;
  readonly visitType: string;
  readonly priority: AppointmentPriority;
  readonly reason: string;
}

export type BookingField =
  'patient' | 'department' | 'date' | 'time' | 'duration' | 'visitType' | 'reason';

export type BookingIssues = Readonly<Partial<Record<BookingField, string>>>;

/** Which step owns each field — where a refusal sends the doctor back to. */
export const FIELD_STEP: Readonly<Record<BookingField, BookingStepId>> = {
  patient: 'patient',
  department: 'patient',
  date: 'schedule',
  time: 'schedule',
  duration: 'schedule',
  visitType: 'details',
  reason: 'details',
};

/** The problems that keep `step` from being complete, keyed by field. */
export function stepIssues(draft: BookingDraft, step: BookingStepId): BookingIssues {
  const issues: Partial<Record<BookingField, string>> = {};
  if (step === 'patient') {
    if (draft.patient === null) issues.patient = 'Choose the patient this appointment is for.';
    if (draft.department.trim() === '') issues.department = 'Choose a department.';
  } else if (step === 'schedule') {
    if (draft.date === null) issues.date = 'Choose a date.';
    if (draft.time === null) issues.time = 'Choose an available time.';
    if (!BOOKING_DURATIONS.includes(draft.durationMin)) issues.duration = 'Choose a duration.';
  } else {
    if (draft.visitType.trim() === '') issues.visitType = 'Choose a visit type.';
    const reason = draft.reason.trim();
    if (reason === '') issues.reason = 'Give a reason for the visit.';
    else if (reason.length > REASON_MAX_LENGTH)
      issues.reason = `Keep the reason to ${String(REASON_MAX_LENGTH)} characters.`;
  }
  return issues;
}

export function hasIssues(issues: BookingIssues): boolean {
  return Object.keys(issues).length > 0;
}

/** The first step with a problem, or `null` when the draft is complete. */
export function firstIncompleteStep(draft: BookingDraft): BookingStepId | null {
  return STEP_IDS.find((step) => hasIssues(stepIssues(draft, step))) ?? null;
}

/* ── Clinic-time arithmetic ────────────────────────────────────── */

const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function minutesOf(time: string): number {
  const match = TIME_OF_DAY.exec(time);
  return match === null ? Number.NaN : Number(match[1]) * 60 + Number(match[2]);
}

/** `HH:MM` for minutes past midnight; `24:00` for exactly midnight at the end of a day. */
export function timeOf(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function dateParts(date: DateKey): [number, number, number] {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = date.split('-').map(Number);
  return [year, month, day];
}

/**
 * The weekday of a civil date. Zone-free on purpose: `2026-11-16` is a Monday
 * everywhere, and reading it through a local `Date` would let the device's
 * zone shift it across midnight.
 */
export function weekdayOf(date: DateKey): Weekday {
  const [year, month, day] = dateParts(date);
  const sundayFirst = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAYS[(sundayFirst + 6) % 7] ?? 'Mon';
}

/** A civil date as a UTC-noon instant — for *formatting* a date key with `timeZone: 'UTC'`. */
export function dateKeyAsUtcNoon(date: DateKey): Date {
  const [year, month, day] = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Today's civil date in `timeZone` (`null` = the device's). */
export function clinicToday(now: Date, timeZone: string | null): DateKey {
  return wallClockIn(now, timeZone).date;
}

/**
 * The instant at which the wall clock in `timeZone` reads `date time` —
 * the inverse of `wallClockIn`. `null` for a wall time the zone skips (the
 * hour a daylight-saving change jumps over), which no one can be booked into.
 *
 * Solved by correction rather than by an offset table: guess the instant as
 * if the zone were UTC, read the guess back in the zone, and move by the
 * difference. Two rounds settle any fixed or DST offset; the loop allows four.
 */
export function instantForWallClock(
  date: DateKey,
  time: string,
  timeZone: string | null,
): Date | null {
  const [year, month, day] = dateParts(date);
  const minutes = minutesOf(time);
  if ([year, month, day, minutes].some(Number.isNaN)) return null;

  const target = Date.UTC(year, month - 1, day, 0, minutes);
  let guess = target;
  for (let round = 0; round < 4; round += 1) {
    const read = wallClockIn(new Date(guess), timeZone);
    const [readYear, readMonth, readDay] = dateParts(read.date);
    const drift = Date.UTC(readYear, readMonth - 1, readDay, 0, read.minutes) - target;
    if (drift === 0) return new Date(guess);
    guess -= drift;
  }
  return null;
}

/* ── The day's slots ───────────────────────────────────────────── */

/** Why a slot cannot be booked — each one a server rule, plus "already past". */
export type SlotState = 'available' | 'booked' | 'break' | 'time-off' | 'past';

export const SLOT_STATE_LABELS: Readonly<Record<SlotState, string>> = {
  available: 'Available',
  booked: 'Booked',
  break: 'Break',
  'time-off': 'Time off',
  past: 'Past',
};

export interface BookingSlot {
  /** Clinic-zone `HH:MM`. */
  readonly time: string;
  /** Clinic-zone `HH:MM` the visit would end at. */
  readonly endTime: string;
  readonly state: SlotState;
}

export interface DaySchedule {
  readonly weekday: Weekday;
  /** The doctor's hours that weekday; `null` when the day is closed. */
  readonly hours: AvailabilityDay | null;
  readonly slots: readonly BookingSlot[];
}

export interface DayScheduleInputs {
  readonly date: DateKey;
  readonly durationMin: number;
  readonly availability: WeeklyAvailability;
  /** `null` when the time off could not be read — rule 3 is then left to the server. */
  readonly timeOff: readonly TimeOffBlock[] | null;
  /** `null` when the book could not be read — rule 4 is then left to the server. */
  readonly appointments: readonly Appointment[] | null;
  readonly now: Date;
  /** The clinic's zone, or `null` for the device's. */
  readonly timeZone: string | null;
}

/**
 * The bookable starts on `date` for a visit of `durationMin`, each with the
 * reason it is unavailable, if any.
 *
 * Starts step by the doctor's own slot length (`defaultDurationMin`, API
 * §3.8) from the start of each working window, and stop where the visit
 * would run past the window's end — rule 1, with the server's `<=`: a visit
 * ending exactly at the window's end fits. Then, in the server's order:
 * rule 2 (overlaps a break), rule 3 (overlaps time off), rule 4 (overlaps a
 * live appointment widened by the buffer on both sides). A start already in
 * the past is offered as `past`: the server would accept it — creation
 * deliberately has no "in the future" rule, for back-entry — but a slot grid
 * for a *new* booking should not invite one.
 */
export function daySchedule(inputs: DayScheduleInputs): DaySchedule {
  const { date, durationMin, availability, timeZone } = inputs;
  const weekday = weekdayOf(date);
  const day = availability.week.find((candidate) => candidate.weekday === weekday);
  if (day === undefined || !day.open || day.windows.length === 0) {
    return { weekday, hours: null, slots: [] };
  }

  const step = availability.defaultDurationMin > 0 ? availability.defaultDurationMin : 15;
  const starts = new Set<number>();
  for (const window of day.windows) {
    const windowEnd = minutesOf(window.end);
    for (let start = minutesOf(window.start); start + durationMin <= windowEnd; start += step) {
      starts.add(start);
    }
  }

  const bufferMs = Math.max(0, availability.bufferMin) * 60_000;
  const live = (inputs.appointments ?? []).filter((appointment) =>
    LIVE_STATUSES.has(appointment.status),
  );

  const slots = [...starts]
    .sort((left, right) => left - right)
    .flatMap((start): BookingSlot[] => {
      const end = start + durationMin;
      const instant = instantForWallClock(date, timeOf(start), timeZone);
      if (instant === null) return [];
      const from = instant.getTime();
      const to = from + durationMin * 60_000;

      const inBreak = day.breaks.some(
        (pause) => start < minutesOf(pause.end) && minutesOf(pause.start) < end,
      );
      const inTimeOff = (inputs.timeOff ?? []).some(
        (block) =>
          from < new Date(block.endsAt).getTime() && new Date(block.startsAt).getTime() < to,
      );
      const clashes = live.some((appointment) => {
        const bookedFrom = new Date(appointment.dateTime).getTime() - bufferMs;
        const bookedTo =
          new Date(appointment.dateTime).getTime() + appointment.durationMin * 60_000 + bufferMs;
        return from < bookedTo && bookedFrom < to;
      });

      const state: SlotState =
        from <= inputs.now.getTime()
          ? 'past'
          : inBreak
            ? 'break'
            : inTimeOff
              ? 'time-off'
              : clashes
                ? 'booked'
                : 'available';
      return [{ time: timeOf(start), endTime: timeOf(end), state }];
    });

  return { weekday, hours: day, slots };
}

/* ── Display ───────────────────────────────────────────────────── */

/** "Monday, November 16, 2026" — the date key itself, read as UTC so no zone can shift it. */
export function formatBookingDate(date: DateKey): string {
  return formatDateWith(dateKeyAsUtcNoon(date), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "09:30–10:00" — the clinic wall clock the doctor picked, never re-read through a zone. */
export function formatBookingTime(time: string, durationMin: number): string {
  return isolateLtr(`${time}–${timeOf(minutesOf(time) + durationMin)}`);
}

export function toAppointmentPatient(patient: Patient): AppointmentPatientSnapshot {
  return {
    id: patient.id,
    name: patient.name,
    mrn: patient.mrn,
    phone: patient.phone,
    age: patient.age,
    gender: patient.gender,
  };
}

/** Whether any day of the week is open — a doctor with none can be booked by no one. */
export function hasWorkingHours(availability: WeeklyAvailability): boolean {
  return availability.week.some((day) => day.open && day.windows.length > 0);
}

export type DateState = 'past' | 'closed' | 'open';

/** How the calendar offers a date: before the clinic's today, a closed weekday, or open. */
export function dateState(
  date: DateKey,
  availability: WeeklyAvailability,
  today: DateKey,
): DateState {
  if (date < today) return 'past';
  const day = availability.week.find((candidate) => candidate.weekday === weekdayOf(date));
  return day !== undefined && day.open && day.windows.length > 0 ? 'open' : 'closed';
}

/* ── The server's refusals ─────────────────────────────────────── */

export type BookingFailure =
  | {
      /** A 409 `slot_conflict`: the server refused the time. Shown on the schedule step. */
      readonly kind: 'slot';
      readonly title: string;
      readonly message: string;
      /**
       * The server's own sentence — it names a rule, never a patient. `null`
       * when the refusal is the client's pre-check and no request was sent.
       */
      readonly serverDetail: string | null;
      /** The clinic-zone time the server refused. */
      readonly refusedTime: string | null;
    }
  | {
      /** A 422 or a 404 that names fields. Shown beside those fields. */
      readonly kind: 'fields';
      readonly fields: BookingIssues;
      readonly message: string;
    }
  | {
      /** Anything else. Shown on the review step. */
      readonly kind: 'general';
      readonly title: string;
      readonly message: string;
    };

const SLOT_TITLE = 'Time slot unavailable';

function slotMessage(detail: string): string {
  if (/working hours|midnight/i.test(detail)) {
    return "The selected appointment time is outside this doctor's working hours. Please choose an available time slot.";
  }
  if (/break/i.test(detail)) {
    return 'The selected time overlaps a scheduled break. Please choose an available time slot.';
  }
  if (/unavailable/i.test(detail)) {
    return 'The doctor has time off at the selected time. Please choose an available time slot.';
  }
  if (/overlaps appointment/i.test(detail)) {
    return 'The selected time overlaps another appointment. Please choose an available time slot.';
  }
  return 'The server could not book the selected time. Please choose an available time slot.';
}

/** Where a server field path lands on the form. */
const SERVER_FIELD: Readonly<Record<string, BookingField>> = {
  patientId: 'patient',
  department: 'department',
  dateTime: 'time',
  durationMin: 'duration',
  visitType: 'visitType',
  reason: 'reason',
};

/**
 * What a failed `POST /appointments` means for the form. Every branch keeps
 * the draft: the caller shows the failure and changes nothing else.
 */
export function bookingFailureFrom(error: unknown, refusedTime: string | null): BookingFailure {
  if (!isApiError(error)) {
    return {
      kind: 'general',
      title: 'The appointment was not booked',
      message: 'Something went wrong on this screen. Your entries are unchanged — try again.',
    };
  }

  switch (error.kind) {
    case 'conflict':
      if (error.code === 'idempotency_request_in_progress') {
        return {
          kind: 'general',
          title: 'This booking is still being processed',
          message:
            'The server is already handling this exact booking. Wait a moment, then check your appointments before trying again.',
        };
      }
      return {
        kind: 'slot',
        title: SLOT_TITLE,
        message: slotMessage(error.detail),
        serverDetail: error.detail,
        refusedTime,
      };
    case 'validation': {
      const fields: Partial<Record<BookingField, string>> = {};
      const unplaced: string[] = [];
      for (const [path, messages] of Object.entries(error.fieldErrors)) {
        const field = SERVER_FIELD[path];
        if (field === undefined) unplaced.push(...messages);
        else fields[field] = messages.join(' ');
      }
      return {
        kind: 'fields',
        fields,
        message:
          unplaced.length > 0
            ? unplaced.join(' ')
            : 'The server could not accept some of the details. They are marked below.',
      };
    }
    case 'not_found':
      // `assertCanReach` answers 404 for a patient outside the doctor's care.
      return {
        kind: 'fields',
        fields: { patient: 'This patient is not in your care, or no longer exists.' },
        message: 'The server could not find the selected patient.',
      };
    case 'forbidden':
      return {
        kind: 'general',
        title: 'You cannot book appointments',
        message: 'Your account does not have permission to book appointments.',
      };
    case 'rate_limited':
      return {
        kind: 'general',
        title: 'Too many requests',
        message: `Wait ${String(error.retryAfterSeconds)} seconds, then try again. Your entries are unchanged.`,
      };
    case 'network':
      return {
        kind: 'general',
        title: 'The connection was lost',
        message:
          'We could not confirm whether the appointment was booked. Your entries are unchanged — trying this exact booking again will not create a second appointment.',
      };
    default:
      return {
        kind: 'general',
        title: 'The appointment was not booked',
        message:
          'The server could not complete the booking. Your entries are unchanged — try again.',
      };
  }
}
