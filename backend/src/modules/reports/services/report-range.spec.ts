import { describe, expect, it } from 'vitest';

import { deltaPercent, resolveRange } from './report-range';

/**
 * Range resolution — RM M21.1.
 *
 * The properties worth pinning:
 *
 * · **Half-open windows.** `[from, to)`. A closed interval double-counts
 *   the boundary instant, so a row landing exactly on midnight would
 *   appear in both this period and the comparison one and inflate both
 *   sides of a delta.
 * · **The comparison period is the same length, immediately before.**
 *   Anything else makes a percentage meaningless — comparing a
 *   part-month against a whole one shows every KPI collapsing on the
 *   first of the month.
 * · **Growth from zero is 100%, not Infinity.** A chip rendering
 *   `Infinity` is a defect.
 */
const at = (iso: string) => new Date(iso);

describe('window boundaries', () => {
  it('makes today midnight to midnight, exclusive at the end', () => {
    const { current } = resolveRange('today', at('2026-09-18T14:32:07Z'));

    expect(current.from.toISOString()).toBe('2026-09-18T00:00:00.000Z');
    expect(current.to.toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });

  it('starts the week on Monday', () => {
    // 2026-09-18 is a Friday.
    const { current } = resolveRange('week', at('2026-09-18T14:00:00Z'));

    expect(current.from.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(current.to.toISOString()).toBe('2026-09-21T00:00:00.000Z');
  });

  it('treats Sunday as the last day of its week, not the first', () => {
    // 2026-09-20 is a Sunday; it belongs to the week beginning the 14th.
    const { current } = resolveRange('week', at('2026-09-20T23:00:00Z'));

    expect(current.from.toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('spans the calendar month', () => {
    const { current } = resolveRange('month', at('2026-09-18T14:00:00Z'));

    expect(current.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(current.to.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('spans the calendar quarter', () => {
    const { current } = resolveRange('quarter', at('2026-09-18T14:00:00Z'));

    expect(current.from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(current.to.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('spans the calendar year', () => {
    const { current } = resolveRange('year', at('2026-09-18T14:00:00Z'));

    expect(current.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(current.to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  /**
   * The picker emits a day, and "to 18 September" means through the end
   * of the 18th — so the exclusive bound is the next midnight. Taking
   * the date literally would silently drop the last day of every custom
   * report.
   */
  it('includes the whole of a custom range’s last day', () => {
    const { current } = resolveRange('custom', at('2026-09-18T14:00:00Z'), {
      from: at('2026-09-01T00:00:00Z'),
      to: at('2026-09-18T00:00:00Z'),
    });

    expect(current.from.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(current.to.toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });

  it('throws rather than defaulting when a custom range has no bounds', () => {
    // Unreachable through the API — the schema refuses it — and thrown
    // so a future caller cannot silently get "this month" instead.
    expect(() => resolveRange('custom', at('2026-09-18T14:00:00Z'))).toThrow();
  });
});

describe('the comparison window', () => {
  it('is the same length, immediately before, and does not overlap', () => {
    const { current, previous } = resolveRange('month', at('2026-09-18T14:00:00Z'));

    expect(previous.to.getTime()).toBe(current.from.getTime());
    expect(current.to.getTime() - current.from.getTime()).toBe(
      previous.to.getTime() - previous.from.getTime(),
    );
  });

  it('is the previous day for today', () => {
    const { previous } = resolveRange('today', at('2026-09-18T14:00:00Z'));

    expect(previous.from.toISOString()).toBe('2026-09-17T00:00:00.000Z');
    expect(previous.to.toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });

  it('matches a custom range’s own length', () => {
    const { current, previous } = resolveRange('custom', at('2026-09-18T14:00:00Z'), {
      from: at('2026-09-15T00:00:00Z'),
      to: at('2026-09-18T00:00:00Z'),
    });

    // Four days inclusive → four days before it.
    expect(current.to.getTime() - current.from.getTime()).toBe(4 * 86_400_000);
    expect(previous.from.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });
});

describe('deltaPercent', () => {
  it('reports a rise and a fall', () => {
    expect(deltaPercent(120, 100)).toBe(20);
    expect(deltaPercent(80, 100)).toBe(-20);
  });

  it('is zero when nothing changed', () => {
    expect(deltaPercent(100, 100)).toBe(0);
    expect(deltaPercent(0, 0)).toBe(0);
  });

  /** Growth from nothing is not "infinite percent". */
  it('answers 100 rather than Infinity when the previous period was empty', () => {
    expect(deltaPercent(7, 0)).toBe(100);
    expect(Number.isFinite(deltaPercent(7, 0))).toBe(true);
  });

  it('rounds to one decimal so a chip does not render a float', () => {
    expect(deltaPercent(1, 3)).toBe(-66.7);
  });
});
