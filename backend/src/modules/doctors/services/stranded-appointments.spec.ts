import { describe, expect, it } from 'vitest';

import type { WeekdayWire } from '../dto/availability.schema';

import { isKnownTimeZone, strandedBy, type GridDay } from './stranded-appointments';

/**
 * BR-DEC-005 — the coverage rule, with the zone and the instants fixed.
 *
 * 2026-10-26 is a Monday. Cairo is still on summer time that day (EEST,
 * UTC+3, until 29 October); New York switches from EDT (UTC−4) to EST
 * (UTC−5) on 2026-11-01.
 */
const MON_TO_FRI: GridDay[] = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as WeekdayWire[]).map(
  (weekday) => ({
    weekday,
    windows: [{ start: '09:00', end: '17:00' }],
    breaks: [{ start: '13:00', end: '14:00' }],
  }),
);

const at = (iso: string, durationMin = 30) => ({ id: iso, startsAt: new Date(iso), durationMin });

describe('strandedBy', () => {
  it('keeps an appointment wholly inside a window', () => {
    expect(strandedBy(MON_TO_FRI, [at('2026-10-26T09:00:00Z')], 'UTC')).toEqual([]);
  });

  it('strands one on a day the grid closes', () => {
    const saturday = at('2026-10-31T10:00:00Z');

    expect(strandedBy(MON_TO_FRI, [saturday], 'UTC')).toEqual([saturday]);
  });

  it('strands one that runs past the end of the window', () => {
    const late = at('2026-10-26T16:45:00Z', 30);

    expect(strandedBy(MON_TO_FRI, [late], 'UTC')).toEqual([late]);
  });

  it('keeps one that ends exactly when the window does', () => {
    expect(strandedBy(MON_TO_FRI, [at('2026-10-26T16:30:00Z', 30)], 'UTC')).toEqual([]);
  });

  it('strands one that overlaps a break, and keeps one that touches it', () => {
    const across = at('2026-10-26T12:45:00Z', 30);
    const before = at('2026-10-26T12:30:00Z', 30);
    const after = at('2026-10-26T14:00:00Z', 30);

    expect(strandedBy(MON_TO_FRI, [across, before, after], 'UTC')).toEqual([across]);
  });

  it('reads the grid as clinic-local time, not UTC', () => {
    // 07:30Z is 10:30 in Cairo — inside the window there, before it in UTC.
    const morning = at('2026-10-26T07:30:00Z');

    expect(strandedBy(MON_TO_FRI, [morning], 'Africa/Cairo')).toEqual([]);
    expect(strandedBy(MON_TO_FRI, [morning], 'UTC')).toEqual([morning]);
  });

  it('takes the weekday from the clinic’s date, not the UTC one', () => {
    // 02:00Z on Saturday 31 October is 16:00 on Friday 30 October in
    // Honolulu (UTC−10): covered there by Friday's window, stranded in UTC
    // by the closed Saturday.
    const fridayInHonolulu = at('2026-10-31T02:00:00Z');

    expect(strandedBy(MON_TO_FRI, [fridayInHonolulu], 'Pacific/Honolulu')).toEqual([]);
    expect(strandedBy(MON_TO_FRI, [fridayInHonolulu], 'UTC')).toEqual([fridayInHonolulu]);
  });

  it('follows a DST change: 09:00 local is a different UTC instant either side', () => {
    const beforeChange = at('2026-10-30T13:00:00Z'); // 09:00 EDT, Friday
    const afterChange = at('2026-11-02T14:00:00Z'); // 09:00 EST, Monday
    const naive = at('2026-11-02T13:00:00Z'); // 08:00 EST — before the window

    expect(
      strandedBy(MON_TO_FRI, [beforeChange, afterChange, naive], 'America/New_York'),
    ).toEqual([naive]);
  });

  it('strands a visit that crosses midnight', () => {
    const allDay: GridDay[] = [
      { weekday: 'Mon', windows: [{ start: '00:00', end: '23:59' }], breaks: [] },
      { weekday: 'Tue', windows: [{ start: '00:00', end: '23:59' }], breaks: [] },
    ];
    const overnight = at('2026-10-26T23:45:00Z', 30);

    expect(strandedBy(allDay, [overnight], 'UTC')).toEqual([overnight]);
  });
});

describe('isKnownTimeZone', () => {
  it('accepts IANA zones and refuses anything else', () => {
    expect(isKnownTimeZone('Africa/Cairo')).toBe(true);
    expect(isKnownTimeZone('UTC')).toBe(true);
    expect(isKnownTimeZone('Mars/Olympus_Mons')).toBe(false);
  });
});
