import { describe, expect, it } from 'vitest';

import { findSlotConflict, type ConflictInputs } from './slot-conflict';

/**
 * ADR-005 §4's five rules, at the boundaries.
 *
 * The ADR names these cases as "the whole risk": a slot ending exactly
 * at `end_time` is valid, one ending a minute later is not; buffer
 * overlap at both edges; a slot spanning a break; DST transitions in the
 * clinic timezone. All of it is arithmetic, so all of it is tested here
 * rather than through an HTTP round trip that would prove the same
 * comparison four seconds more slowly.
 */

/** `HH:MM` on the epoch — the shape Prisma round-trips `time(0)` as. */
const at = (time: string): Date => new Date(`1970-01-01T${time}:00.000Z`);

const MONDAY_NINE_TO_FIVE = {
  weekday: 'MON' as const,
  startTime: at('09:00'),
  endTime: at('17:00'),
  isBreak: false,
};

const LUNCH = {
  weekday: 'MON' as const,
  startTime: at('12:00'),
  endTime: at('13:00'),
  isBreak: true,
};

/** 2026-09-14 is a Monday. */
const monday = (time: string, zone = 'Z'): Date => new Date(`2026-09-14T${time}:00.000${zone}`);

function inputs(overrides: Partial<ConflictInputs> = {}): ConflictInputs {
  return {
    candidate: { startsAt: monday('10:00'), durationMin: 30 },
    timeZone: 'UTC',
    bufferMin: 0,
    windows: [MONDAY_NINE_TO_FIVE, LUNCH],
    timeOff: [],
    booked: [],
    ...overrides,
  };
}

describe('rule 5 — duration', () => {
  it('refuses a zero-length slot', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('10:00'), durationMin: 0 } }),
    );

    expect(conflict?.rule).toBe('duration');
  });

  it('refuses a negative duration', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('10:00'), durationMin: -30 } }),
    );

    expect(conflict?.rule).toBe('duration');
  });
});

describe('rule 1 — inside a working window', () => {
  it('accepts a slot wholly inside the window', () => {
    expect(findSlotConflict(inputs())).toBeNull();
  });

  it('accepts a slot ending exactly at the window close', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('16:30'), durationMin: 30 } }),
    );

    expect(conflict).toBeNull();
  });

  it('refuses a slot ending one minute after the window close', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('16:30'), durationMin: 31 } }),
    );

    expect(conflict?.rule).toBe('outside-working-hours');
  });

  it('accepts a slot starting exactly at the window open', () => {
    expect(
      findSlotConflict(inputs({ candidate: { startsAt: monday('09:00'), durationMin: 30 } })),
    ).toBeNull();
  });

  it('refuses a slot starting one minute before the window opens', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('08:59'), durationMin: 30 } }),
    );

    expect(conflict?.rule).toBe('outside-working-hours');
  });

  it('refuses a slot on a weekday with no rows at all', () => {
    // 2026-09-15 is a Tuesday, and the grid has only Monday rows.
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: new Date('2026-09-15T10:00:00.000Z'), durationMin: 30 } }),
    );

    expect(conflict?.rule).toBe('outside-working-hours');
  });

  it('refuses a slot that would run past midnight', () => {
    const conflict = findSlotConflict(
      inputs({
        candidate: { startsAt: monday('23:30'), durationMin: 60 },
        windows: [
          { weekday: 'MON', startTime: at('00:00'), endTime: at('23:59'), isBreak: false },
        ],
      }),
    );

    expect(conflict?.rule).toBe('outside-working-hours');
    expect(conflict?.detail).toContain('midnight');
  });
});

describe('rule 2 — breaks', () => {
  it('refuses a slot wholly inside the break', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('12:15'), durationMin: 30 } }),
    );

    expect(conflict?.rule).toBe('inside-break');
  });

  it('refuses a slot that straddles the start of the break', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('11:45'), durationMin: 30 } }),
    );

    expect(conflict?.rule).toBe('inside-break');
  });

  it('accepts a slot ending exactly when the break begins', () => {
    expect(
      findSlotConflict(inputs({ candidate: { startsAt: monday('11:30'), durationMin: 30 } })),
    ).toBeNull();
  });

  it('accepts a slot starting exactly when the break ends', () => {
    expect(
      findSlotConflict(inputs({ candidate: { startsAt: monday('13:00'), durationMin: 30 } })),
    ).toBeNull();
  });
});

describe('rule 3 — time off', () => {
  it('refuses a slot overlapping a block', () => {
    const conflict = findSlotConflict(
      inputs({ timeOff: [{ startsAt: monday('09:30'), endsAt: monday('11:00') }] }),
    );

    expect(conflict?.rule).toBe('inside-time-off');
  });

  it('accepts a slot that ends exactly when the block starts', () => {
    expect(
      findSlotConflict(
        inputs({ timeOff: [{ startsAt: monday('10:30'), endsAt: monday('11:00') }] }),
      ),
    ).toBeNull();
  });
});

describe('rule 4 — overlapping bookings', () => {
  const booked = [{ publicId: 'APT-3001', startsAt: monday('11:00'), durationMin: 30 }];

  it('refuses a slot that overlaps an existing booking', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('11:15'), durationMin: 30 }, booked }),
    );

    expect(conflict?.rule).toBe('overlapping-appointment');
  });

  it('names the appointment it clashes with, and no patient', () => {
    const conflict = findSlotConflict(
      inputs({ candidate: { startsAt: monday('11:15'), durationMin: 30 }, booked }),
    );

    expect(conflict?.detail).toBe('The slot overlaps appointment APT-3001');
  });

  it('accepts a back-to-back slot when the buffer is zero', () => {
    expect(
      findSlotConflict(inputs({ candidate: { startsAt: monday('10:30'), durationMin: 30 }, booked })),
    ).toBeNull();
  });

  it('refuses the same back-to-back slot once a buffer is configured', () => {
    const conflict = findSlotConflict(
      inputs({
        candidate: { startsAt: monday('10:30'), durationMin: 30 },
        booked,
        bufferMin: 10,
      }),
    );

    expect(conflict?.rule).toBe('overlapping-appointment');
  });

  it('applies the buffer on the trailing edge too', () => {
    const conflict = findSlotConflict(
      inputs({
        candidate: { startsAt: monday('11:30'), durationMin: 30 },
        booked,
        bufferMin: 10,
      }),
    );

    expect(conflict?.rule).toBe('overlapping-appointment');
  });
});

describe('ordering — the most structural failure is the one reported', () => {
  it('reports the working-hours failure for a slot that is also double-booked', () => {
    const conflict = findSlotConflict(
      inputs({
        candidate: { startsAt: monday('18:00'), durationMin: 30 },
        booked: [{ publicId: 'APT-3001', startsAt: monday('18:00'), durationMin: 30 }],
      }),
    );

    expect(conflict?.rule).toBe('outside-working-hours');
  });
});

describe('civil time — the clinic timezone, not UTC', () => {
  /**
   * The regression this file exists for. 08:00 UTC on a Monday is 10:00
   * in Cairo (UTC+2) and inside a 09:00–17:00 grid; read as UTC it is
   * an hour before the clinic opens and would be refused.
   */
  it('measures the slot against the clinic wall clock', () => {
    const candidate = { startsAt: new Date('2026-09-14T08:00:00.000Z'), durationMin: 30 };

    expect(findSlotConflict(inputs({ candidate, timeZone: 'Africa/Cairo' }))).toBeNull();
    expect(findSlotConflict(inputs({ candidate, timeZone: 'UTC' }))?.rule).toBe(
      'outside-working-hours',
    );
  });

  it('resolves the weekday in the clinic zone, not in UTC', () => {
    // 19:00 Sunday UTC is 09:00 **Monday** on Kiritimati (UTC+14). The
    // grid has Monday rows and no Sunday ones, so the two readings of
    // the same instant disagree about which day it is — which is the
    // whole point of resolving the weekday in the clinic's zone.
    const candidate = { startsAt: new Date('2026-09-13T19:00:00.000Z'), durationMin: 30 };

    expect(findSlotConflict(inputs({ candidate, timeZone: 'Pacific/Kiritimati' }))).toBeNull();
    expect(findSlotConflict(inputs({ candidate, timeZone: 'UTC' }))?.rule).toBe(
      'outside-working-hours',
    );
  });
});
