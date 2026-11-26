/**
 * ADR-005 §4 — the five-rule conflict check, as pure logic.
 *
 * A candidate slot `[start, start + durationMin)` is bookable only if
 * **all five** hold:
 *
 *  1. it falls inside a working window on that weekday;
 *  2. it does not overlap a break;
 *  3. it does not overlap time off;
 *  4. it does not overlap another live appointment for that doctor,
 *     **extended by `bufferMin` on both sides**;
 *  5. its duration is positive.
 *
 * Kept separate from the service so the rules can be tested without a
 * database and without a Nest application: the boundary cases ADR-005
 * names as "the whole risk" — a slot ending exactly at `end_time` is
 * valid, one ending a minute later is not — are arithmetic, and
 * arithmetic deserves a test that runs in a millisecond.
 *
 * Rules 1 and 2 are civil-time comparisons in the clinic's zone; rules 3
 * and 4 are instant comparisons, because time off and existing bookings
 * are absolute intervals. Mixing the two is the mistake this file exists
 * to avoid making twice.
 */

import type { Weekday } from '../../../generated/prisma/enums';

import { civilMoment, slotEndTime, staysWithinOneDay, timeOfDay } from './clinic-calendar';

/** One `doctor_availability` row, as the rules need it. */
export interface AvailabilityWindow {
  readonly weekday: Weekday;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly isBreak: boolean;
}

/** One `doctor_time_off` interval. */
export interface TimeOffInterval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/** One existing appointment, reduced to the interval it occupies. */
export interface BookedSlot {
  /** `appointments.public_id`, for the 409 `detail`. */
  readonly publicId: string;
  readonly startsAt: Date;
  readonly durationMin: number;
}

export interface SlotCandidate {
  readonly startsAt: Date;
  readonly durationMin: number;
}

export interface ConflictInputs {
  readonly candidate: SlotCandidate;
  readonly timeZone: string;
  readonly bufferMin: number;
  readonly windows: readonly AvailabilityWindow[];
  readonly timeOff: readonly TimeOffInterval[];
  readonly booked: readonly BookedSlot[];
}

/** Which rule refused, so the 409 can say. */
export type ConflictRule =
  | 'duration'
  | 'outside-working-hours'
  | 'inside-break'
  | 'inside-time-off'
  | 'overlapping-appointment';

export interface SlotConflict {
  readonly rule: ConflictRule;
  /** Human sentence for the 409 `detail`. Carries no PHI — never a name. */
  readonly detail: string;
}

/**
 * The first rule that refuses, or `null` when the slot is bookable.
 *
 * First rather than all: the contract asks for a `detail` naming which
 * rule failed, and a doctor moving an appointment fixes one thing at a
 * time. Evaluated in the order ADR-005 lists them, so the most
 * structural failure is the one reported — "outside working hours" is a
 * more useful answer than "overlaps an appointment" for a slot that is
 * both.
 */
export function findSlotConflict(inputs: ConflictInputs): SlotConflict | null {
  const { candidate, timeZone } = inputs;

  // Rule 5, checked first because the other four are meaningless for a
  // zero-length slot: it occupies no time and so overlaps nothing,
  // which would let it be booked on top of anything.
  if (!Number.isInteger(candidate.durationMin) || candidate.durationMin <= 0) {
    return { rule: 'duration', detail: 'An appointment must be at least one minute long' };
  }

  if (!staysWithinOneDay(candidate.startsAt, candidate.durationMin, timeZone)) {
    return {
      rule: 'outside-working-hours',
      detail: 'An appointment cannot run past midnight in the clinic timezone',
    };
  }

  const moment = civilMoment(candidate.startsAt, timeZone);
  const endTime = slotEndTime(candidate.startsAt, candidate.durationMin, timeZone);
  const sameDay = inputs.windows.filter((window) => window.weekday === moment.weekday);

  // Rule 1. A slot ending exactly at `end_time` is inside the window;
  // one ending a minute later is not — the `<=` is the rule.
  const insideWorking = sameDay.some(
    (window) =>
      !window.isBreak &&
      timeOfDay(window.startTime) <= moment.time &&
      endTime <= timeOfDay(window.endTime),
  );

  if (!insideWorking) {
    return {
      rule: 'outside-working-hours',
      detail: 'The slot falls outside the doctor’s working hours',
    };
  }

  // Rule 2. Touching endpoints are not an overlap: a slot ending at
  // 12:00 and a break starting at 12:00 share no minute.
  const insideBreak = sameDay.some(
    (window) =>
      window.isBreak &&
      moment.time < timeOfDay(window.endTime) &&
      timeOfDay(window.startTime) < endTime,
  );

  if (insideBreak) {
    return { rule: 'inside-break', detail: 'The slot overlaps a scheduled break' };
  }

  return occupancyConflict(candidate, inputs.bufferMin, inputs.timeOff, inputs.booked);
}

/** The inputs of `findOccupancyConflict`: rules 3–5 without the weekly grid. */
export type OccupancyInputs = Omit<ConflictInputs, 'windows'>;

/**
 * Rules 3, 4 and 5 only — time off, other live appointments (buffer
 * included) and a positive duration — **without** the weekly grid.
 *
 * For a doctor-published slot (DR-10). The doctor's working hours are
 * internal planning data and never patient inventory; a published slot is
 * the doctor's explicit offer of a time, so whether it falls inside the
 * grid is not a rule any source states. What still holds is that the
 * slot must not sit on time off or on another live appointment, and must
 * not run past the clinic's midnight — the same limit a booking has.
 */
export function findOccupancyConflict(inputs: OccupancyInputs): SlotConflict | null {
  const { candidate, timeZone } = inputs;

  if (!Number.isInteger(candidate.durationMin) || candidate.durationMin <= 0) {
    return { rule: 'duration', detail: 'An appointment must be at least one minute long' };
  }

  if (!staysWithinOneDay(candidate.startsAt, candidate.durationMin, timeZone)) {
    return {
      rule: 'outside-working-hours',
      detail: 'An appointment cannot run past midnight in the clinic timezone',
    };
  }

  return occupancyConflict(candidate, inputs.bufferMin, inputs.timeOff, inputs.booked);
}

/** Rules 3 and 4, shared by both entry points. */
function occupancyConflict(
  candidate: SlotCandidate,
  bufferMin: number,
  timeOff: readonly TimeOffInterval[],
  booked: readonly BookedSlot[],
): SlotConflict | null {
  const start = candidate.startsAt.getTime();
  const end = start + candidate.durationMin * 60_000;

  // Rule 3.
  const blocked = timeOff.some(
    (block) => start < block.endsAt.getTime() && block.startsAt.getTime() < end,
  );

  if (blocked) {
    return { rule: 'inside-time-off', detail: 'The doctor is unavailable at that time' };
  }

  // Rule 4. The buffer widens the **existing** booking rather than the
  // candidate, which is the same test read from the other side, and is
  // the reading that makes a zero buffer a plain overlap check.
  const bufferMs = Math.max(0, bufferMin) * 60_000;
  const clash = booked.find((slot) => {
    const bookedStart = slot.startsAt.getTime() - bufferMs;
    const bookedEnd = slot.startsAt.getTime() + slot.durationMin * 60_000 + bufferMs;

    return start < bookedEnd && bookedStart < end;
  });

  if (clash !== undefined) {
    return {
      rule: 'overlapping-appointment',
      // The reference, never the patient on it: a 409 that named who
      // else is in the slot would disclose an appointment to whoever
      // guessed at the time (MG §11.6).
      detail: `The slot overlaps appointment ${clash.publicId}`,
    };
  }

  return null;
}
