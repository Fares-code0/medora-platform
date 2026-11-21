import { hashString } from '@/features/shared-domain/patient-identity';

import type { Appointment } from './types';

/**
 * Pure calendar math for the Day/Week/Month views and the reschedule
 * slot picker. Date keys are local-timezone `YYYY-MM-DD` strings — the
 * clinical day boundary is the clinic's local day. No date library
 * until one is warranted.
 */

export type DateKey = string;

export function toDateKey(date: Date): DateKey {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${String(date.getFullYear())}-${month}-${day}`;
}

export function todayKey(): DateKey {
  return toDateKey(new Date());
}

export function parseDateKey(key: DateKey): Date {
  const [year = 1970, month = 1, day = 1] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(parseDateKey(value).getTime());
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function addMonths(key: DateKey, months: number): DateKey {
  const date = parseDateKey(key);
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  return toDateKey(date);
}

/** Monday-first week. */
export function startOfWeek(key: DateKey): DateKey {
  const date = parseDateKey(key);
  const shift = (date.getDay() + 6) % 7;
  return addDays(key, -shift);
}

export function weekDays(key: DateKey): readonly DateKey[] {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export interface MonthCell {
  readonly key: DateKey;
  readonly inMonth: boolean;
}

/** Full month grid: complete Monday-first weeks covering the month. */
export function monthGrid(key: DateKey): ReadonlyArray<readonly MonthCell[]> {
  const anchor = parseDateKey(key);
  const month = anchor.getMonth();
  const firstKey = toDateKey(new Date(anchor.getFullYear(), month, 1));
  let cursor = startOfWeek(firstKey);

  const weeks: MonthCell[][] = [];
  do {
    const week = Array.from({ length: 7 }, (_, index) => {
      const cellKey = addDays(cursor, index);
      return { key: cellKey, inMonth: parseDateKey(cellKey).getMonth() === month };
    });
    weeks.push(week);
    cursor = addDays(cursor, 7);
  } while (parseDateKey(cursor).getMonth() === month);

  return weeks;
}

export function appointmentDateKey(appointment: Appointment): DateKey {
  return toDateKey(new Date(appointment.dateTime));
}

/** Group (already filtered) appointments per day, sorted by start time. */
export function groupByDate(
  appointments: readonly Appointment[],
): ReadonlyMap<DateKey, readonly Appointment[]> {
  const map = new Map<DateKey, Appointment[]>();
  for (const appointment of appointments) {
    const key = appointmentDateKey(appointment);
    const bucket = map.get(key);
    if (bucket) bucket.push(appointment);
    else map.set(key, [appointment]);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  }
  return map;
}

/* ── Reschedule slot picker (mock availability) ─────────────────── */

/** Half-hour clinic slots 09:00–16:30. */
export const RESCHEDULE_SLOTS: readonly string[] = Array.from({ length: 16 }, (_, index) => {
  const hour = 9 + Math.floor(index / 2);
  return `${String(hour).padStart(2, '0')}:${index % 2 === 0 ? '00' : '30'}`;
});

export interface SlotAvailability {
  readonly time: string;
  readonly available: boolean;
  /** True when an existing appointment occupies the slot (mock conflict). */
  readonly conflict: boolean;
}

/**
 * Slot availability: real appointments on that day block their slots
 * (conflict detection). With `simulateBusy` — the mock only — a
 * deterministic pseudo-busy pattern seeded from the date is added so
 * different days look organically different; over HTTP it is off, because
 * a slot marked busy by a seed would be invented unavailability, and the
 * server alone decides what its working hours allow.
 */
export function slotAvailabilityFor(
  dateKey: DateKey,
  dayAppointments: readonly Appointment[],
  simulateBusy = true,
): readonly SlotAvailability[] {
  const booked = new Set(
    dayAppointments
      .filter((a) => a.status !== 'cancelled' && a.status !== 'no-show')
      .map((a) => {
        const date = new Date(a.dateTime);
        return `${String(date.getHours()).padStart(2, '0')}:${date.getMinutes() < 30 ? '00' : '30'}`;
      }),
  );
  const seed = hashString(dateKey);
  return RESCHEDULE_SLOTS.map((time, index) => {
    const conflict = booked.has(time);
    const pseudoBusy = simulateBusy && (seed >> (index % 28)) % 5 === 0;
    return { time, conflict, available: !conflict && !pseudoBusy };
  });
}
