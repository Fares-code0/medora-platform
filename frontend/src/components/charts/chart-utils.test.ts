import { describe, expect, it } from 'vitest';

import { axisTicks, niceCeil, xLabelIndexes } from './chart-utils';

/**
 * X-axis tick thinning.
 *
 * Charts labelled every point, which is fine for the seven-day series they
 * were built against and unreadable at thirty: the admin overview's activity
 * chart drew thirty "Aug N" labels into 580 viewBox units and they ran into
 * one another. The property that matters is not "how many" but "no two
 * labels can touch", so that is what is asserted — plus the two ends, which
 * a reader needs more than any interior tick.
 */

const WIDTH = 580;
/** Same figure `xLabelIndexes` reserves per label. */
const LABEL_WIDTH = 44;

function gaps(count: number, width = WIDTH): number[] {
  const kept = xLabelIndexes(count, width);
  const xAt = (i: number) => (count <= 1 ? width / 2 : (i / (count - 1)) * width);
  return kept.slice(1).map((index, position) => xAt(index) - xAt(kept[position] ?? 0));
}

describe('xLabelIndexes', () => {
  it('keeps every label while they still fit', () => {
    expect(xLabelIndexes(7, WIDTH)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('always keeps the first and last', () => {
    for (const count of [2, 5, 14, 30, 31, 90, 365]) {
      const kept = xLabelIndexes(count, WIDTH);
      expect(kept[0], `count=${String(count)}`).toBe(0);
      expect(kept[kept.length - 1], `count=${String(count)}`).toBe(count - 1);
    }
  });

  it('never lets two labels come closer than one label width', () => {
    for (const count of [8, 12, 30, 31, 60, 90, 365]) {
      for (const gap of gaps(count)) {
        expect(gap, `count=${String(count)}`).toBeGreaterThanOrEqual(LABEL_WIDTH);
      }
    }
  });

  it('leaves no label jammed against the last one', () => {
    // The last index is appended rather than stepped onto, so the final gap is
    // the one that can come out short — a 31-point month over a 30-day stride
    // is the shape that produced it.
    for (const count of [30, 31, 32, 33, 45, 61]) {
      const all = gaps(count);
      const final = all[all.length - 1] ?? Infinity;
      expect(final, `count=${String(count)}`).toBeGreaterThanOrEqual(LABEL_WIDTH);
    }
  });

  it('handles the degenerate series', () => {
    expect(xLabelIndexes(0, WIDTH)).toEqual([]);
    expect(xLabelIndexes(1, WIDTH)).toEqual([0]);
    expect(xLabelIndexes(2, WIDTH)).toEqual([0, 1]);
  });
});

/**
 * Y-axis ticks.
 *
 * The charts key their gridlines on the tick value, so a repeated tick is both
 * a duplicated axis label and a duplicate React key. It only happens on a
 * *small* axis, which is why it survived until a report charted "one new
 * doctor this month" — every chart in the app until then had a max in the
 * dozens or the hundreds.
 */
describe('axisTicks', () => {
  it('never repeats a tick, however small the axis', () => {
    // Every bound `niceCeil` can produce below the default tick count, plus a
    // couple above it for good measure.
    for (const max of [1, 2, 5, 10, 20, 50, 100, 200]) {
      const ticks = axisTicks(max);
      expect(new Set(ticks).size, `max=${String(max)}`).toBe(ticks.length);
      expect(ticks[0], `max=${String(max)}`).toBe(0);
      expect(ticks[ticks.length - 1], `max=${String(max)}`).toBe(max);
    }
  });

  it('leaves an axis that was already evenly divisible exactly as it was', () => {
    expect(axisTicks(200)).toEqual([0, 50, 100, 150, 200]);
    expect(axisTicks(20)).toEqual([0, 5, 10, 15, 20]);
  });

  it('collapses a one-unit axis to its two ends', () => {
    expect(axisTicks(1)).toEqual([0, 1]);
    expect(axisTicks(2)).toEqual([0, 1, 2]);
  });

  it('agrees with every bound niceCeil produces', () => {
    for (const value of [0, 0.4, 1, 1.5, 3, 7, 42, 194, 1001]) {
      const ticks = axisTicks(niceCeil(value));
      expect(new Set(ticks).size, `value=${String(value)}`).toBe(ticks.length);
    }
  });
});
