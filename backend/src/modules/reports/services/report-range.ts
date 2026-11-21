/**
 * Resolving `range` into a window, and its comparison window (M21.1).
 *
 * ## The comparison period is the same length, immediately before
 *
 * API §12.1 offers `compare=true` and the KPIs carry `deltaPercent`, so
 * a delta needs a second window. "The period before this one, of the
 * same length" is the only reading that makes a percentage meaningful:
 * comparing a part-month against a whole one would show every KPI
 * collapsing on the first of the month.
 *
 * ## Windows are half-open, and that is load-bearing
 *
 * `[from, to)` — inclusive start, exclusive end. A closed interval
 * double-counts the boundary instant between this period and the
 * comparison one, so a row landing exactly on midnight would appear in
 * both and inflate both sides of the delta.
 *
 * ## Everything is computed in UTC
 *
 * The clinic's timezone is a platform setting M24 owns, and a report
 * that silently used the *server's* offset would move its own week
 * boundary when the server moved. Using UTC consistently is wrong by at
 * most a few hours at the edges and is wrong the *same way* everywhere,
 * which a later timezone-aware version can correct in one place.
 */

export type ReportRange = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export interface Window {
  readonly from: Date;
  /** Exclusive. */
  readonly to: Date;
}

export interface ResolvedRange {
  readonly current: Window;
  /** The same length, immediately before `current`. */
  readonly previous: Window;
}

function startOfDay(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** Monday-based, matching the weekday axis the charts render. */
function startOfWeek(at: Date): Date {
  const day = startOfDay(at);
  // `getUTCDay()` is 0 for Sunday; shift so Monday is 0 and Sunday is 6.
  const offset = (day.getUTCDay() + 6) % 7;

  return new Date(day.getTime() - offset * 86_400_000);
}

export function resolveRange(
  range: ReportRange,
  now: Date,
  custom?: { readonly from: Date; readonly to: Date },
): ResolvedRange {
  const current = currentWindow(range, now, custom);
  const span = current.to.getTime() - current.from.getTime();

  return {
    current,
    previous: { from: new Date(current.from.getTime() - span), to: current.from },
  };
}

function currentWindow(
  range: ReportRange,
  now: Date,
  custom?: { readonly from: Date; readonly to: Date },
): Window {
  switch (range) {
    case 'today': {
      const from = startOfDay(now);

      return { from, to: new Date(from.getTime() + 86_400_000) };
    }
    case 'week': {
      const from = startOfWeek(now);

      return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
    }
    case 'month': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      return { from, to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) };
    }
    case 'quarter': {
      const firstMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      const from = new Date(Date.UTC(now.getUTCFullYear(), firstMonth, 1));

      return { from, to: new Date(Date.UTC(now.getUTCFullYear(), firstMonth + 3, 1)) };
    }
    case 'year': {
      const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));

      return { from, to: new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1)) };
    }
    case 'custom': {
      if (custom === undefined) {
        // Unreachable through the API — the schema refuses `custom`
        // without both bounds — and thrown rather than defaulted so a
        // future caller cannot get a silent "this month" instead.
        throw new Error('A custom range requires `from` and `to`');
      }

      // `to` arrives as a date the user picked and means "through the
      // end of that day", so the exclusive bound is the next midnight.
      return { from: startOfDay(custom.from), to: new Date(startOfDay(custom.to).getTime() + 86_400_000) };
    }
  }
}

/**
 * The percentage change between two counts, as `KpiDatum.deltaPercent`.
 *
 * Zero previous is the case worth stating: growth from nothing is not
 * "infinite percent", and rendering `Infinity` in a chip is a defect. It
 * answers 0 when both are zero (nothing changed) and 100 when something
 * appeared where there was nothing — which reads as "all of it is new".
 */
export function deltaPercent(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;

  return Math.round(((current - previous) / previous) * 1000) / 10;
}
