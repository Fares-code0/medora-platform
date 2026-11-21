import { describe, expect, it } from 'vitest';

import { WEEKDAYS, type AvailabilityDay, type WeeklyAvailability } from './availability';
import {
  bookingFailureFrom,
  clinicToday,
  dateState,
  daySchedule,
  firstIncompleteStep,
  formatBookingTime,
  hasWorkingHours,
  instantForWallClock,
  stepIssues,
  weekdayOf,
  type BookingDraft,
} from './booking';
import type { Appointment } from './types';

/**
 * The booking model is where the original "outside working hours" bug lived:
 * the retired dialog read the doctor's wall-clock pick in the *device's* zone
 * while the server compares it in the *clinic's*. These cases pin the clinic
 * reading, with zones chosen so the device's zone (whatever the test machine
 * runs in) cannot make them pass by accident.
 */

const OPEN: Omit<AvailabilityDay, 'weekday'> = {
  open: true,
  windows: [{ start: '09:00', end: '17:00' }],
  breaks: [{ start: '12:00', end: '13:00' }],
};

function week(overrides: Partial<WeeklyAvailability> = {}): WeeklyAvailability {
  return {
    week: WEEKDAYS.map((weekday) =>
      weekday === 'Sun' ? { weekday, open: false, windows: [], breaks: [] } : { weekday, ...OPEN },
    ),
    defaultDurationMin: 30,
    bufferMin: 0,
    clinicTimezone: 'Asia/Tokyo',
    ...overrides,
  };
}

function appointment(
  dateTime: string,
  durationMin = 30,
  status: Appointment['status'] = 'scheduled',
): Appointment {
  return {
    id: `apt-${dateTime}`,
    patient: { id: 'PT-1', name: 'A', mrn: '1', phone: '', age: 40, gender: 'male' },
    dateTime,
    durationMin,
    visitType: 'Consultation',
    department: 'General Medicine',
    doctor: 'Dr',
    status,
    priority: 'normal',
    isNewPatient: false,
    isFollowUp: false,
    reason: 'x',
    notes: null,
  };
}

/** 2026-11-16 is a Monday. Long before "now" in these tests, so nothing is past. */
const MONDAY = '2026-11-16';
const BEFORE = new Date('2026-11-01T00:00:00Z');

describe('instantForWallClock — the clinic wall clock as an instant', () => {
  it('reads the time in the clinic zone, not the device zone', () => {
    // Tokyo is UTC+9 with no DST: 09:00 there is 00:00 UTC the same day.
    expect(instantForWallClock(MONDAY, '09:00', 'Asia/Tokyo')?.toISOString()).toBe(
      '2026-11-16T00:00:00.000Z',
    );
    // Kiritimati is UTC+14: 00:02 there is 10:02 UTC the *previous* day.
    expect(instantForWallClock(MONDAY, '00:02', 'Pacific/Kiritimati')?.toISOString()).toBe(
      '2026-11-15T10:02:00.000Z',
    );
    // Honolulu is UTC-10: 23:30 there is 09:30 UTC the *next* day.
    expect(instantForWallClock(MONDAY, '23:30', 'Pacific/Honolulu')?.toISOString()).toBe(
      '2026-11-17T09:30:00.000Z',
    );
  });

  it('follows daylight saving on either side of a change', () => {
    // New York: EDT (UTC-4) until 2026-11-01 02:00, EST (UTC-5) after.
    expect(instantForWallClock('2026-10-30', '09:00', 'America/New_York')?.toISOString()).toBe(
      '2026-10-30T13:00:00.000Z',
    );
    expect(instantForWallClock('2026-11-02', '09:00', 'America/New_York')?.toISOString()).toBe(
      '2026-11-02T14:00:00.000Z',
    );
  });

  it('refuses a wall time the zone skips', () => {
    // 2026-03-08 02:30 does not exist in New York — clocks jump 02:00 → 03:00.
    expect(instantForWallClock('2026-03-08', '02:30', 'America/New_York')).toBeNull();
  });

  it('rejects malformed input rather than guessing', () => {
    expect(instantForWallClock(MONDAY, '9am', 'Asia/Tokyo')).toBeNull();
    expect(instantForWallClock('not-a-date', '09:00', 'Asia/Tokyo')).toBeNull();
  });
});

describe('civil dates', () => {
  it('names the weekday of a date without any zone', () => {
    expect(weekdayOf('2026-11-16')).toBe('Mon');
    expect(weekdayOf('2026-11-22')).toBe('Sun');
    expect(weekdayOf('2024-02-29')).toBe('Thu');
  });

  it("takes today from the clinic's zone", () => {
    // 20:00 UTC on the 15th is already the 16th in Tokyo and still the 15th in Honolulu.
    const instant = new Date('2026-11-15T20:00:00Z');
    expect(clinicToday(instant, 'Asia/Tokyo')).toBe('2026-11-16');
    expect(clinicToday(instant, 'Pacific/Honolulu')).toBe('2026-11-15');
  });

  it('offers only open weekdays from today on', () => {
    const availability = week();
    expect(dateState('2026-11-15', availability, MONDAY)).toBe('past');
    expect(dateState(MONDAY, availability, MONDAY)).toBe('open');
    expect(dateState('2026-11-22', availability, MONDAY)).toBe('closed');
  });

  it('knows when a doctor has no working hours at all', () => {
    const closed = week({
      week: WEEKDAYS.map((weekday) => ({ weekday, open: false, windows: [], breaks: [] })),
    });
    expect(hasWorkingHours(closed)).toBe(false);
    expect(hasWorkingHours(week())).toBe(true);
  });
});

describe('daySchedule — the five rules, restated', () => {
  const base = {
    date: MONDAY,
    durationMin: 30,
    availability: week(),
    timeOff: [],
    appointments: [],
    now: BEFORE,
    timeZone: 'Asia/Tokyo',
  };

  it('offers starts inside the window that let the whole visit fit (rule 1)', () => {
    const { slots, hours } = daySchedule(base);
    expect(hours?.weekday).toBe('Mon');
    expect(slots[0]?.time).toBe('09:00');
    // A visit ending exactly at 17:00 fits; one starting at 17:00 would not.
    expect(slots.at(-1)).toEqual({ time: '16:30', endTime: '17:00', state: 'available' });
    expect(slots.find((slot) => slot.time === '17:00')).toBeUndefined();
  });

  it('shortens the day for a longer visit', () => {
    const { slots } = daySchedule({ ...base, durationMin: 60 });
    expect(slots.at(-1)?.time).toBe('16:00');
  });

  it('marks a slot overlapping a break, but not one touching it (rule 2)', () => {
    const { slots } = daySchedule(base);
    expect(slots.find((slot) => slot.time === '11:30')?.state).toBe('available');
    expect(slots.find((slot) => slot.time === '12:00')?.state).toBe('break');
    expect(slots.find((slot) => slot.time === '13:00')?.state).toBe('available');
    // A 60-minute visit at 11:30 runs into the break.
    expect(
      daySchedule({ ...base, durationMin: 60 }).slots.find((slot) => slot.time === '11:30')?.state,
    ).toBe('break');
  });

  it('marks a slot inside time off (rule 3)', () => {
    const { slots } = daySchedule({
      ...base,
      // 10:00–11:00 Tokyo = 01:00–02:00 UTC.
      timeOff: [
        {
          id: 'b1',
          startsAt: '2026-11-16T01:00:00Z',
          endsAt: '2026-11-16T02:00:00Z',
          kind: 'vacation',
        },
      ],
    });
    expect(slots.find((slot) => slot.time === '09:30')?.state).toBe('available');
    expect(slots.find((slot) => slot.time === '10:00')?.state).toBe('time-off');
    expect(slots.find((slot) => slot.time === '10:30')?.state).toBe('time-off');
    expect(slots.find((slot) => slot.time === '11:00')?.state).toBe('available');
  });

  it('marks a slot overlapping a live appointment, widened by the buffer (rule 4)', () => {
    // 10:00–10:30 Tokyo.
    const booked = [appointment('2026-11-16T01:00:00Z')];
    const plain = daySchedule({ ...base, appointments: booked }).slots;
    expect(plain.find((slot) => slot.time === '09:30')?.state).toBe('available');
    expect(plain.find((slot) => slot.time === '10:00')?.state).toBe('booked');
    expect(plain.find((slot) => slot.time === '10:30')?.state).toBe('available');

    const buffered = daySchedule({
      ...base,
      availability: week({ bufferMin: 15 }),
      appointments: booked,
    }).slots;
    expect(buffered.find((slot) => slot.time === '09:30')?.state).toBe('booked');
    expect(buffered.find((slot) => slot.time === '10:30')?.state).toBe('booked');
  });

  it('ignores cancelled and completed appointments, as the server does', () => {
    const { slots } = daySchedule({
      ...base,
      appointments: [
        appointment('2026-11-16T01:00:00Z', 30, 'cancelled'),
        appointment('2026-11-16T01:00:00Z', 30, 'completed'),
      ],
    });
    expect(slots.find((slot) => slot.time === '10:00')?.state).toBe('available');
  });

  it('marks starts already past as past', () => {
    // 10:15 Tokyo on the day.
    const { slots } = daySchedule({ ...base, now: new Date('2026-11-16T01:15:00Z') });
    expect(slots.find((slot) => slot.time === '10:00')?.state).toBe('past');
    expect(slots.find((slot) => slot.time === '10:30')?.state).toBe('available');
  });

  it('offers nothing on a closed day', () => {
    const { slots, hours } = daySchedule({ ...base, date: '2026-11-22' });
    expect(hours).toBeNull();
    expect(slots).toEqual([]);
  });

  it('still offers slots by working hours when the book could not be read', () => {
    const { slots } = daySchedule({ ...base, appointments: null, timeOff: null });
    expect(slots.find((slot) => slot.time === '10:00')?.state).toBe('available');
  });

  it("steps by the doctor's own slot length", () => {
    const { slots } = daySchedule({ ...base, availability: week({ defaultDurationMin: 20 }) });
    expect(slots.slice(0, 4).map((slot) => slot.time)).toEqual([
      '09:00',
      '09:20',
      '09:40',
      '10:00',
    ]);
  });

  it('formats the visit as the clinic wall clock', () => {
    expect(formatBookingTime('16:30', 30)).toContain('16:30–17:00');
  });
});

describe('step validation', () => {
  const empty: BookingDraft = {
    patient: null,
    department: '',
    date: null,
    time: null,
    durationMin: 30,
    visitType: '',
    priority: 'normal',
    reason: '   ',
  };

  it('names every missing required field on its own step', () => {
    expect(stepIssues(empty, 'patient')).toEqual({
      patient: 'Choose the patient this appointment is for.',
      department: 'Choose a department.',
    });
    expect(stepIssues(empty, 'schedule')).toEqual({
      date: 'Choose a date.',
      time: 'Choose an available time.',
    });
    expect(stepIssues(empty, 'details')).toEqual({
      visitType: 'Choose a visit type.',
      reason: 'Give a reason for the visit.',
    });
    expect(firstIncompleteStep(empty)).toBe('patient');
  });

  it('refuses a duration the flow does not offer', () => {
    expect(stepIssues({ ...empty, durationMin: 25 }, 'schedule').duration).toBe(
      'Choose a duration.',
    );
  });
});

describe('bookingFailureFrom — what a refusal means for the form', () => {
  it('turns the working-hours 409 into the inline slot message, keeping the server text', () => {
    const failure = bookingFailureFrom(
      {
        kind: 'conflict',
        code: 'slot_conflict',
        detail: 'The slot falls outside the doctor’s working hours',
      },
      '00:02',
    );
    expect(failure).toEqual({
      kind: 'slot',
      title: 'Time slot unavailable',
      message:
        "The selected appointment time is outside this doctor's working hours. Please choose an available time slot.",
      serverDetail: 'The slot falls outside the doctor’s working hours',
      refusedTime: '00:02',
    });
  });

  it.each([
    ['The slot overlaps a scheduled break', /break/],
    ['The doctor is unavailable at that time', /time off/],
    ['The slot overlaps appointment APT-0042', /another appointment/],
    ['An appointment cannot run past midnight in the clinic timezone', /working hours/],
  ])('explains "%s"', (detail, expected) => {
    const failure = bookingFailureFrom(
      { kind: 'conflict', code: 'slot_conflict', detail },
      '10:00',
    );
    expect(failure.kind).toBe('slot');
    expect(failure.kind === 'slot' && failure.message).toMatch(expected);
  });

  it('places 422 field errors on their fields', () => {
    const failure = bookingFailureFrom(
      {
        kind: 'validation',
        code: 'validation_failed',
        fieldErrors: { reason: ['Too long'], visitType: ['Unknown visit type'], other: ['Odd'] },
      },
      '10:00',
    );
    expect(failure).toEqual({
      kind: 'fields',
      fields: { reason: 'Too long', visitType: 'Unknown visit type' },
      message: 'Odd',
    });
  });

  it('says a lost connection may have booked, and that retrying is safe', () => {
    const failure = bookingFailureFrom({ kind: 'network' }, '10:00');
    expect(failure.kind).toBe('general');
    expect(failure.kind === 'general' && failure.message).toMatch(/will not create a second/);
  });

  it('does not treat an in-flight duplicate as a slot problem', () => {
    const failure = bookingFailureFrom(
      { kind: 'conflict', code: 'idempotency_request_in_progress', detail: 'In progress' },
      '10:00',
    );
    expect(failure.kind).toBe('general');
  });

  it('maps a patient outside the care relationship onto the patient field', () => {
    const failure = bookingFailureFrom({ kind: 'not_found' }, null);
    expect(failure.kind === 'fields' && failure.fields.patient).toMatch(/not in your care/);
  });
});
