import { describe, expect, it } from 'vitest';

import {
  assertValidSchedule,
  cronPatternFor,
  dailyAtUtc,
  describeSchedule,
  everyHours,
  everyMinutes,
  nextRunAfter,
} from './job-schedule';

/**
 * The schedule arithmetic (RM M30.2).
 *
 * > ✅ Verify: each schedule registered and visible; license warning
 * > fires in a clock-controlled test.
 *
 * The clock is a parameter everywhere below — no test here reads the
 * system date, which is the property that makes the assertions about
 * "daily at 03:10" true in every timezone a contributor works in.
 */
describe('nextRunAfter', () => {
  it('anchors an interval at the epoch rather than at the call', () => {
    // 10:07:30 on a 15-minute grid lands on 10:15, not 10:22:30. Two
    // replicas asking at different seconds inside the window therefore
    // get the same instant, which is what stops a schedule drifting
    // apart across a cluster.
    const at = new Date('2026-09-21T10:07:30.000Z');

    expect(nextRunAfter(everyMinutes(15), at).toISOString()).toBe('2026-09-21T10:15:00.000Z');
  });

  it('moves past an instant that is exactly on the grid', () => {
    // Strictly after: an equal answer would fire twice for one instant
    // every time a tick landed on the boundary.
    const onTheGrid = new Date('2026-09-21T10:15:00.000Z');

    expect(nextRunAfter(everyMinutes(15), onTheGrid).toISOString()).toBe(
      '2026-09-21T10:30:00.000Z',
    );
  });

  it('gives today’s slot when the daily time is still ahead', () => {
    const at = new Date('2026-09-21T01:00:00.000Z');

    expect(nextRunAfter(dailyAtUtc(3, 10), at).toISOString()).toBe('2026-09-21T03:10:00.000Z');
  });

  it('rolls to tomorrow once the daily time has passed', () => {
    const at = new Date('2026-09-21T03:10:00.001Z');

    expect(nextRunAfter(dailyAtUtc(3, 10), at).toISOString()).toBe('2026-09-22T03:10:00.000Z');
  });

  it('rolls across a month boundary', () => {
    const at = new Date('2026-09-30T23:59:00.000Z');

    expect(nextRunAfter(dailyAtUtc(1, 0), at).toISOString()).toBe('2026-10-01T01:00:00.000Z');
  });

  it('does not shift for local time', () => {
    // The reason `dailyAtUtc` is UTC: a clinic-local schedule runs twice
    // on one day a year and not at all on another. Asserted by fixing
    // the instant either side of a DST change in a populated zone and
    // checking the answer does not move.
    const beforeDst = new Date('2026-03-28T23:00:00.000Z');
    const afterDst = new Date('2026-03-29T23:00:00.000Z');

    expect(nextRunAfter(dailyAtUtc(2, 0), beforeDst).toISOString()).toBe(
      '2026-03-29T02:00:00.000Z',
    );
    expect(nextRunAfter(dailyAtUtc(2, 0), afterDst).toISOString()).toBe(
      '2026-03-30T02:00:00.000Z',
    );
  });
});

describe('cronPatternFor', () => {
  it('generates the pattern BullMQ takes, zero-padding nothing', () => {
    // Generated rather than parsed — the whole reason there is no cron
    // dependency. Cron itself does not want padding.
    expect(cronPatternFor({ kind: 'dailyAtUtc', hour: 3, minute: 10 })).toBe('10 3 * * *');
    expect(cronPatternFor({ kind: 'dailyAtUtc', hour: 0, minute: 0 })).toBe('0 0 * * *');
  });
});

describe('describeSchedule', () => {
  it('reads as a line an operator can check against the roadmap', () => {
    expect(describeSchedule(everyMinutes(1))).toBe('every 1 min');
    expect(describeSchedule(everyMinutes(15))).toBe('every 15 min');
    expect(describeSchedule(everyHours(6))).toBe('every 6 h');
    expect(describeSchedule(dailyAtUtc(3, 10))).toBe('daily at 03:10 UTC');
    expect(describeSchedule(dailyAtUtc(1, 0))).toBe('daily at 01:00 UTC');
  });
});

describe('assertValidSchedule', () => {
  it('refuses an interval below a minute', () => {
    // Zero is the dangerous typo: it is a hot spin in the driver and a
    // hot loop in the broker.
    expect(() => {
      assertValidSchedule('x', { kind: 'every', ms: 0 });
    }).toThrow(/minimum is one minute/);
  });

  it('refuses a daily time that can never match', () => {
    expect(() => {
      assertValidSchedule('x', { kind: 'dailyAtUtc', hour: 24, minute: 0 });
    }).toThrow(/invalid daily time/);
    expect(() => {
      assertValidSchedule('x', { kind: 'dailyAtUtc', hour: 3, minute: 60 });
    }).toThrow(/invalid daily time/);
  });

  it('accepts every schedule the registry actually declares', () => {
    for (const schedule of [
      everyMinutes(1),
      everyMinutes(15),
      everyHours(6),
      dailyAtUtc(1, 0),
      dailyAtUtc(2, 0),
      dailyAtUtc(3, 10),
      dailyAtUtc(3, 40),
      dailyAtUtc(6, 0),
      dailyAtUtc(18, 0),
    ]) {
      expect(() => {
        assertValidSchedule('x', schedule);
      }).not.toThrow();
    }
  });
});
