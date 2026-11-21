import { describe, expect, it } from 'vitest';

import type { ActionQueueItemView, ActionQueueUrgency } from '../dto/action-queue.dto';

import { ageHoursBetween, compareQueueItems, orderQueue } from './action-queue.ordering';

/**
 * "Sorted by urgency then age" (RM M15.4 — UX §2.1).
 *
 * The one rule in the widget, tested where it lives rather than only
 * through HTTP. An e2e that seeds four sources and checks the first row
 * proves the sort on *one* arrangement; these cases state the properties
 * the sort has to hold for every arrangement — which is what stops a
 * later edit satisfying the e2e while reordering everything below the
 * top row.
 *
 * The direction is the part worth pinning. Every other list in this
 * application is newest-first; this one is **oldest**-first, because a
 * queue ranks by how overdue a thing is. That inversion is exactly the
 * kind of detail a refactor "tidies" in the wrong direction.
 */
function item(
  overrides: Partial<ActionQueueItemView> & { id: string },
): ActionQueueItemView {
  return {
    kind: 'unsigned-note',
    urgency: 'normal',
    label: 'A row',
    patient: { id: 'PT-1', name: 'Layla Morsi' },
    waitingSince: '2026-09-10T09:00:00.000Z',
    ageHours: 0,
    ...overrides,
  };
}

describe('urgency wins, whatever the ages are', () => {
  it('puts a critical row above an older normal one', () => {
    // The case that matters clinically: an unreviewed critical result
    // does not fall below a week-old appointment request.
    const critical = item({
      id: 'LAB-2',
      urgency: 'critical',
      waitingSince: '2026-09-15T09:00:00.000Z',
    });
    const oldNormal = item({
      id: 'MR-1',
      urgency: 'normal',
      waitingSince: '2026-09-01T09:00:00.000Z',
    });

    expect(orderQueue([oldNormal, critical]).map((row) => row.id)).toEqual(['LAB-2', 'MR-1']);
  });

  it('orders the three bands critical, high, normal', () => {
    const rows = (['normal', 'critical', 'high'] as ActionQueueUrgency[]).map((urgency) =>
      item({ id: urgency, urgency }),
    );

    expect(orderQueue(rows).map((row) => row.urgency)).toEqual(['critical', 'high', 'normal']);
  });

  it('puts a high row above a normal one that has waited longer', () => {
    const stale = item({
      id: 'CONV-1',
      urgency: 'high',
      waitingSince: '2026-09-14T09:00:00.000Z',
    });
    const note = item({
      id: 'MR-9',
      urgency: 'normal',
      waitingSince: '2026-08-01T09:00:00.000Z',
    });

    expect(orderQueue([note, stale]).map((row) => row.id)).toEqual(['CONV-1', 'MR-9']);
  });
});

describe('within a band, the oldest is first', () => {
  it('sorts ascending by waitingSince', () => {
    // Oldest-first, not newest-first. The queue ranks by how overdue a
    // row is, which is the opposite of every other list here.
    const rows = [
      item({ id: 'c', waitingSince: '2026-09-12T09:00:00.000Z' }),
      item({ id: 'a', waitingSince: '2026-09-01T09:00:00.000Z' }),
      item({ id: 'b', waitingSince: '2026-09-08T09:00:00.000Z' }),
    ];

    expect(orderQueue(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not let age leak across bands', () => {
    // Stated separately from the tests above because it is the property,
    // not an example: sorting by age *first* and urgency second would
    // pass several of them by accident.
    const rows = [
      item({ id: 'old-normal', urgency: 'normal', waitingSince: '2026-01-01T00:00:00.000Z' }),
      item({ id: 'new-high', urgency: 'high', waitingSince: '2026-09-15T00:00:00.000Z' }),
      item({ id: 'old-high', urgency: 'high', waitingSince: '2026-02-01T00:00:00.000Z' }),
      item({ id: 'new-critical', urgency: 'critical', waitingSince: '2026-09-16T00:00:00.000Z' }),
    ];

    expect(orderQueue(rows).map((row) => row.id)).toEqual([
      'new-critical',
      'old-high',
      'new-high',
      'old-normal',
    ]);
  });
});

describe('the order is stable across identical requests', () => {
  it('breaks a same-instant tie on the handle', () => {
    // The widget polls. Two rows created in the same millisecond that
    // swapped places between two responses would reshuffle under a
    // doctor's cursor — and the input order here is four concatenated
    // queries, so a stable sort alone would only preserve an order that
    // is itself arbitrary.
    const at = '2026-09-10T09:00:00.000Z';
    const rows = [item({ id: 'LAB-3', waitingSince: at }), item({ id: 'LAB-1', waitingSince: at })];

    expect(orderQueue(rows).map((row) => row.id)).toEqual(['LAB-1', 'LAB-3']);
    // The same input in the other order produces the same output, which
    // is the property "stable" has to mean here.
    expect(orderQueue([...rows].reverse()).map((row) => row.id)).toEqual(['LAB-1', 'LAB-3']);
  });

  it('is a total order — comparing a row with itself is zero', () => {
    const row = item({ id: 'APT-1' });

    expect(compareQueueItems(row, row)).toBe(0);
  });

  it('is antisymmetric for every pair', () => {
    const rows = [
      item({ id: 'a', urgency: 'critical', waitingSince: '2026-09-01T00:00:00.000Z' }),
      item({ id: 'b', urgency: 'high', waitingSince: '2026-09-02T00:00:00.000Z' }),
      item({ id: 'c', urgency: 'normal', waitingSince: '2026-09-03T00:00:00.000Z' }),
      item({ id: 'd', urgency: 'normal', waitingSince: '2026-09-03T00:00:00.000Z' }),
    ];

    for (const left of rows) {
      for (const right of rows) {
        // `+ 0` normalises the negative zero `-Math.sign(0)` produces:
        // `toBe` is `Object.is`, under which `-0` and `0` differ.
        expect(Math.sign(compareQueueItems(left, right)) + 0).toBe(
          -Math.sign(compareQueueItems(right, left)) + 0,
        );
      }
    }
  });

  it('does not reorder the caller’s array underneath it', () => {
    const rows = [item({ id: 'z', urgency: 'normal' }), item({ id: 'a', urgency: 'critical' })];
    const before = rows.map((row) => row.id);

    orderQueue(rows);

    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe('age in whole hours', () => {
  const now = new Date('2026-09-16T12:00:00.000Z');

  it('floors rather than rounds', () => {
    // 3h59m is "3 hours". Rounding up would have the server say 4 while
    // a client rendering the same instant says 3.
    expect(ageHoursBetween(new Date('2026-09-16T08:01:00.000Z'), now)).toBe(3);
    expect(ageHoursBetween(new Date('2026-09-16T09:00:00.000Z'), now)).toBe(3);
  });

  it('is zero for something that has only just arrived', () => {
    expect(ageHoursBetween(new Date('2026-09-16T11:59:59.000Z'), now)).toBe(0);
  });

  it('never goes negative', () => {
    // A row timestamped a moment in the future — a clock skew, not a
    // real state — has not waited a negative length of time.
    expect(ageHoursBetween(new Date('2026-09-16T18:00:00.000Z'), now)).toBe(0);
  });

  it('counts days as hours, because the card renders one unit', () => {
    expect(ageHoursBetween(new Date('2026-09-14T12:00:00.000Z'), now)).toBe(48);
  });
});
