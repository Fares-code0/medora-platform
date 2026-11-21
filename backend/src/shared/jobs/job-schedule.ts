/**
 * Schedule arithmetic (RM M30.2).
 *
 * Pure functions over a clock that is always a parameter. That is what
 * makes M30.2's verify step — "license warning fires in a
 * clock-controlled test" — a test of the schedule rather than of the
 * machine's date, and it is the same rule every sweep in this repository
 * already follows.
 *
 * ## `every` counts from the epoch, not from boot
 *
 * A 15-minute schedule computed as "boot time plus fifteen minutes"
 * drifts apart across replicas: three instances started a minute apart
 * run the same sweep three times a quarter-hour instead of once. Anchor
 * the grid at the Unix epoch and every instance computes the *same*
 * instant for the same schedule, which is what makes the leader election
 * a safety net rather than the only thing preventing duplicates.
 */

import type { JobSchedule } from './job.types';

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** Every N minutes, anchored to the epoch. */
export function everyMinutes(minutes: number): JobSchedule {
  return { kind: 'every', ms: minutes * MINUTE_MS };
}

export function everyHours(hours: number): JobSchedule {
  return { kind: 'every', ms: hours * HOUR_MS };
}

/** Once a day at `HH:MM` UTC — see `JobSchedule` for why not local. */
export function dailyAtUtc(hour: number, minute: number): JobSchedule {
  return { kind: 'dailyAtUtc', hour, minute };
}

/**
 * The first firing strictly after `after`.
 *
 * Strictly: a schedule whose next run equalled `after` would fire twice
 * for one instant every time a tick landed exactly on the boundary,
 * which on a five-minute grid is often.
 */
export function nextRunAfter(schedule: JobSchedule, after: Date): Date {
  const from = after.getTime();

  if (schedule.kind === 'every') {
    // `floor + 1` rather than `from + ms`: the result is a point on the
    // shared grid, so two replicas asking at different moments inside
    // the same window get the same answer.
    const slot = Math.floor(from / schedule.ms) + 1;

    return new Date(slot * schedule.ms);
  }

  const candidate = Date.UTC(
    new Date(from).getUTCFullYear(),
    new Date(from).getUTCMonth(),
    new Date(from).getUTCDate(),
    schedule.hour,
    schedule.minute,
    0,
    0,
  );

  return new Date(candidate > from ? candidate : candidate + DAY_MS);
}

/**
 * The cron pattern BullMQ's repeatable jobs take for a daily schedule.
 *
 * Generated rather than parsed: `dailyAtUtc` carries exactly the two
 * fields a `M H * * *` pattern needs, so there is nothing to interpret
 * and no second date implementation to disagree with `nextRunAfter`.
 */
export function cronPatternFor(schedule: Extract<JobSchedule, { kind: 'dailyAtUtc' }>): string {
  return `${String(schedule.minute)} ${String(schedule.hour)} * * *`;
}

/** One line for the operator's screen and for the boot log. */
export function describeSchedule(schedule: JobSchedule): string {
  if (schedule.kind === 'dailyAtUtc') {
    const hour = String(schedule.hour).padStart(2, '0');
    const minute = String(schedule.minute).padStart(2, '0');

    return `daily at ${hour}:${minute} UTC`;
  }

  if (schedule.ms % HOUR_MS === 0) return `every ${String(schedule.ms / HOUR_MS)} h`;
  if (schedule.ms % MINUTE_MS === 0) return `every ${String(schedule.ms / MINUTE_MS)} min`;

  return `every ${String(schedule.ms)} ms`;
}

/**
 * Rejects a schedule that cannot be honoured, at registration rather
 * than at the first tick.
 *
 * A zero or negative interval is an infinite loop in the scheduler and a
 * hot spin in BullMQ; an out-of-range hour produces a `dailyAtUtc` that
 * silently never matches. Both are typos, and both are cheap to catch
 * here and expensive to diagnose in production.
 */
export function assertValidSchedule(name: string, schedule: JobSchedule): void {
  if (schedule.kind === 'every') {
    if (!Number.isFinite(schedule.ms) || schedule.ms < MINUTE_MS) {
      throw new Error(
        `Job \`${name}\` has an interval of ${String(schedule.ms)} ms; the minimum is one minute.`,
      );
    }

    return;
  }

  const { hour, minute } = schedule;
  const valid =
    Number.isInteger(hour) && hour >= 0 && hour <= 23 && Number.isInteger(minute) && minute >= 0 && minute <= 59;

  if (!valid) {
    throw new Error(
      `Job \`${name}\` has an invalid daily time ${String(hour)}:${String(minute)} (expected 00:00–23:59 UTC).`,
    );
  }
}
