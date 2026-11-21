import { describe, expect, it } from 'vitest';

import {
  WEEKDAYS,
  errorsFromFieldErrors,
  hasErrors,
  rowsFromReport,
  sameAvailability,
  strandedAppointments,
  uncoveredReason,
  validateWeek,
  zoneOrDevice,
  type AvailabilityDay,
  type WeeklyAvailability,
} from './availability';
import { MOCK_APPOINTMENTS } from './mock-data';
import type { Appointment, AppointmentStatus } from './types';

/**
 * The editor's two checks (DEC-005). `validateWeek` restates the server's
 * schema and `assertConsistent`, so each case here is one of the server's
 * rules; `strandedAppointments` restates booking rules 1 and 2.
 */

const OPEN: AvailabilityDay = {
  weekday: 'Mon',
  open: true,
  windows: [{ start: '09:00', end: '17:00' }],
  breaks: [{ start: '12:00', end: '13:00' }],
};

function weekWith(monday: Partial<AvailabilityDay>): WeeklyAvailability {
  return {
    week: WEEKDAYS.map((weekday) =>
      weekday === 'Mon'
        ? { ...OPEN, ...monday, weekday }
        : weekday === 'Sat' || weekday === 'Sun'
          ? { weekday, open: false, windows: [], breaks: [] }
          : { ...OPEN, weekday },
    ),
    defaultDurationMin: 30,
    bufferMin: 0,
    clinicTimezone: null,
  };
}

const mondayErrors = (week: WeeklyAvailability) => validateWeek(week).days.Mon ?? [];

describe('validateWeek — the server’s rules', () => {
  it('accepts a consistent week', () => {
    expect(hasErrors(validateWeek(weekWith({})))).toBe(false);
  });

  it('refuses a closed day that carries hours', () => {
    expect(mondayErrors(weekWith({ open: false }))).toContain(
      'A closed day cannot carry working hours',
    );
  });

  it('refuses an open day with no working window', () => {
    expect(mondayErrors(weekWith({ windows: [], breaks: [] }))).toContain(
      'An open day needs at least one working window',
    );
  });

  it('refuses a malformed time and an end before its start', () => {
    expect(mondayErrors(weekWith({ windows: [{ start: '9:00', end: '17:00' }] }))).toContain(
      'Window 1: use HH:MM, 24-hour',
    );
    expect(mondayErrors(weekWith({ windows: [{ start: '17:00', end: '09:00' }] }))).toContain(
      'Window 1: the end time must be after the start time',
    );
  });

  it('refuses more than six windows or breaks a day', () => {
    const seven = Array.from({ length: 7 }, (_, hour) => ({
      start: `0${String(hour)}:00`,
      end: `0${String(hour)}:30`,
    }));
    expect(mondayErrors(weekWith({ windows: seven, breaks: [] }))).toContain(
      'At most six windows a day',
    );
  });

  it('refuses overlapping windows, but not windows that only touch', () => {
    expect(
      mondayErrors(
        weekWith({
          windows: [
            { start: '09:00', end: '13:00' },
            { start: '12:00', end: '17:00' },
          ],
          breaks: [],
        }),
      ),
    ).toContain('Working windows on one day cannot overlap');
    expect(
      mondayErrors(
        weekWith({
          windows: [
            { start: '09:00', end: '12:00' },
            { start: '12:00', end: '17:00' },
          ],
          breaks: [],
        }),
      ),
    ).toEqual([]);
  });

  it('refuses overlapping breaks and a break outside every window', () => {
    expect(
      mondayErrors(
        weekWith({
          breaks: [
            { start: '12:00', end: '13:00' },
            { start: '12:30', end: '14:00' },
          ],
        }),
      ),
    ).toContain('Breaks cannot overlap');
    expect(mondayErrors(weekWith({ breaks: [{ start: '18:00', end: '18:30' }] }))).toContain(
      'Break 1: a break must fall inside a working window',
    );
  });

  it('refuses a length outside the fixed set and a buffer outside 0–60', () => {
    const errors = validateWeek({ ...weekWith({}), defaultDurationMin: 25, bufferMin: 61 });
    expect(errors.defaultDurationMin).toBe('Choose one of 15, 20, 30, 45, 60 minutes');
    expect(errors.bufferMin).toBe('Use a whole number from 0 to 60 minutes');
    expect(validateWeek({ ...weekWith({}), bufferMin: Number.NaN }).bufferMin).toBeDefined();
  });
});

describe('errorsFromFieldErrors', () => {
  it('puts each server field path on its day, and keeps the rest', () => {
    const { week } = weekWith({});
    const mapped = errorsFromFieldErrors(week, {
      'week[0].windows': ['Working windows on one day cannot overlap'],
      'week[2].breaks[0]': ['A break must fall inside a working window'],
      bufferMin: ['Too long'],
      week: ['Each weekday exactly once'],
    });
    expect(mapped.days.Mon).toEqual(['Working windows on one day cannot overlap']);
    expect(mapped.days.Wed).toEqual(['A break must fall inside a working window']);
    expect(mapped.bufferMin).toBe('Too long');
    expect(mapped.general).toEqual(['Each weekday exactly once']);
  });
});

/** A local wall-clock instant on Monday 7 January 2030. */
function mondayAt(hour: number, minute = 0): string {
  return new Date(2030, 0, 7, hour, minute).toISOString();
}

function appointment(
  dateTime: string,
  overrides: { durationMin?: number; status?: AppointmentStatus; id?: string } = {},
): Appointment {
  const base = MOCK_APPOINTMENTS[0];
  if (base === undefined) throw new Error('no mock appointment');
  return {
    ...base,
    id: overrides.id ?? `APT-${dateTime}`,
    dateTime,
    durationMin: overrides.durationMin ?? 30,
    status: overrides.status ?? 'confirmed',
  };
}

describe('uncoveredReason — booking rules 1 and 2', () => {
  const { week } = weekWith({});

  it('covers an appointment inside a window, including one ending exactly at its end', () => {
    expect(uncoveredReason(appointment(mondayAt(9)), week)).toBeNull();
    expect(uncoveredReason(appointment(mondayAt(16, 30)), week)).toBeNull();
  });

  it('names a closed day, time outside the window and a break', () => {
    const sunday = new Date(2030, 0, 6, 10).toISOString();
    expect(uncoveredReason(appointment(sunday), week)).toBe('closed-day');
    expect(uncoveredReason(appointment(mondayAt(16, 45)), week)).toBe('outside-hours');
    expect(uncoveredReason(appointment(mondayAt(8, 45)), week)).toBe('outside-hours');
    expect(uncoveredReason(appointment(mondayAt(11, 45)), week)).toBe('inside-break');
  });

  it('treats an appointment running past midnight as outside the hours', () => {
    const late = weekWith({ windows: [{ start: '20:00', end: '23:59' }], breaks: [] }).week;
    expect(uncoveredReason(appointment(mondayAt(23, 45)), late)).toBe('outside-hours');
  });
});

describe('strandedAppointments', () => {
  const current = weekWith({}).week;
  const now = new Date(2030, 0, 1);

  it('lists live upcoming appointments the proposed week drops, soonest first', () => {
    const proposed = weekWith({ windows: [{ start: '09:00', end: '12:00' }], breaks: [] }).week;
    const result = strandedAppointments(
      [appointment(mondayAt(15), { id: 'late' }), appointment(mondayAt(14), { id: 'early' })],
      current,
      proposed,
      now,
    );
    expect(result.map((entry) => entry.appointment.id)).toEqual(['early', 'late']);
    expect(result.every((entry) => entry.reason === 'outside-hours')).toBe(true);
    expect(result.every((entry) => !entry.alreadyOutside)).toBe(true);
  });

  it('ignores past, cancelled, completed and no-show appointments', () => {
    const proposed = weekWith({ open: false, windows: [], breaks: [] }).week;
    const past = new Date(2029, 11, 31, 10).toISOString();
    const result = strandedAppointments(
      [
        appointment(past),
        appointment(mondayAt(10), { status: 'cancelled', id: 'c' }),
        appointment(mondayAt(10), { status: 'completed', id: 'd' }),
        appointment(mondayAt(10), { status: 'no-show', id: 'n' }),
        appointment(mondayAt(10), { status: 'pending', id: 'p' }),
      ],
      current,
      proposed,
      now,
    );
    expect(result.map((entry) => entry.appointment.id)).toEqual(['p']);
    expect(result[0]?.reason).toBe('closed-day');
  });

  it('marks an appointment the current week did not cover either', () => {
    const result = strandedAppointments(
      [appointment(mondayAt(18))],
      current,
      weekWith({}).week,
      now,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.alreadyOutside).toBe(true);
  });
});

describe('the clinic’s time zone — BR-DEC-005', () => {
  const { week } = weekWith({});
  // Monday 7 January 2030, 07:30 UTC: 09:30 on Monday in Cairo (UTC+2), and
  // 23:30 on Sunday in Los Angeles (UTC−8). The device's zone plays no part.
  const instant = appointment('2030-01-07T07:30:00.000Z');

  it('reads the appointment in the zone given, not the device’s', () => {
    expect(uncoveredReason(instant, week, 'Africa/Cairo')).toBeNull();
    expect(uncoveredReason(instant, week, 'America/Los_Angeles')).toBe('closed-day');
    expect(uncoveredReason(appointment('2030-01-07T10:15:00.000Z'), week, 'Africa/Cairo')).toBe(
      'inside-break',
    );
  });

  it('counts a visit ending exactly at midnight in the zone as ending at 24:00', () => {
    const late = weekWith({ windows: [{ start: '20:00', end: '23:59' }], breaks: [] }).week;
    // 23:30–00:00 Monday in Cairo.
    const lastSlot = appointment('2030-01-07T21:30:00.000Z');
    expect(uncoveredReason(lastSlot, late, 'Africa/Cairo')).toBe('outside-hours');
  });

  it('ranks stranded appointments by the zone, too', () => {
    const result = strandedAppointments(
      [instant],
      week,
      weekWith({ open: false, windows: [], breaks: [] }).week,
      new Date('2030-01-01T00:00:00.000Z'),
      'Africa/Cairo',
    );
    expect(result.map((entry) => [entry.reason, entry.alreadyOutside])).toEqual([
      ['closed-day', false],
    ]);
  });

  it('falls back to the device’s zone for an absent or unusable zone', () => {
    expect(zoneOrDevice('Africa/Cairo')).toBe('Africa/Cairo');
    expect(zoneOrDevice(null)).toBeNull();
    expect(zoneOrDevice('')).toBeNull();
    expect(zoneOrDevice('Mars/Olympus_Mons')).toBeNull();
  });
});

describe('rowsFromReport — the server’s list, labelled by the client', () => {
  const previous = weekWith({}).week;
  const saved = weekWith({ windows: [{ start: '09:00', end: '12:00' }], breaks: [] }).week;

  it('keeps every reported appointment, soonest first, naming patients the book knows', () => {
    const known = {
      ...appointment('2030-01-07T13:00:00.000Z', { id: 'APT-known' }),
      patient: { ...appointment('2030-01-07T13:00:00.000Z').patient, name: 'Khaled Nassar' },
    };
    const rows = rowsFromReport(
      [
        {
          id: 'APT-unknown',
          dateTime: '2030-01-07T14:00:00.000Z',
          durationMin: 30,
          status: 'confirmed',
          patientId: 'PT-1009',
        },
        {
          id: 'APT-known',
          dateTime: '2030-01-07T13:00:00.000Z',
          durationMin: 30,
          status: 'confirmed',
          patientId: 'PT-1001',
        },
      ],
      [known],
      previous,
      saved,
      'Africa/Cairo',
    );

    expect(rows.map((row) => [row.id, row.patientLabel, row.reason, row.alreadyOutside])).toEqual([
      ['APT-known', 'Khaled Nassar', 'outside-hours', false],
      ['APT-unknown', 'Patient PT-1009', 'outside-hours', false],
    ]);
  });

  it('shows a reported appointment even when the client’s reading finds it covered', () => {
    const rows = rowsFromReport(
      [
        {
          id: 'APT-1',
          dateTime: '2030-01-07T08:00:00.000Z',
          durationMin: 30,
          status: 'confirmed',
          patientId: 'PT-1001',
        },
      ],
      [],
      previous,
      saved,
      'Africa/Cairo',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBeNull();
  });
});

describe('sameAvailability', () => {
  it('compares by value, not by identity', () => {
    expect(sameAvailability(weekWith({}), weekWith({}))).toBe(true);
    expect(sameAvailability(weekWith({}), { ...weekWith({}), bufferMin: 5 })).toBe(false);
  });
});
