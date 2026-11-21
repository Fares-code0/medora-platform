import type { AnalyticsTone } from '@/components/charts';

import { LAB_RESULT_FLAG_META, type LabResultFlag, type LabTest } from './types';

/**
 * Analyte trends (D-13, UX §2.6) — "from any analyte, View trend opens a line
 * chart of that analyte over time for that patient (reference range as a
 * shaded band, results as points, hoverable, view-as-table toggle). Multiple
 * analytes can be overlaid (max 3) with distinct series colors."
 *
 * Everything here is pure and unit-tested; the drawer renders what it is
 * given. Two rules are enforced in the model rather than left to the view:
 *
 * 1. **A trend needs a patient, not a test.** The points come from every
 *    completed order this patient has for that analyte, which is the only
 *    reading of "over time" that means anything clinically.
 * 2. **The band is shown only when it is unambiguous.** Overlaying three
 *    analytes with three different units gives three different reference
 *    ranges and one y-axis; a band drawn under that would be a band for
 *    whichever series happened to be first. `trendBand` returns null unless
 *    every selected series shares one unit and one range, and the drawer says
 *    so on screen rather than drawing something almost right.
 */

export const MAX_TREND_SERIES = 3;

export interface TrendPoint {
  readonly labId: string;
  /** ISO instant the result was released (falls back to collection/order). */
  readonly at: string;
  readonly value: number;
  readonly flag: LabResultFlag;
}

export interface AnalyteTrend {
  readonly analyte: string;
  readonly unit: string;
  readonly tone: AnalyticsTone;
  readonly referenceLow: number | null;
  readonly referenceHigh: number | null;
  readonly referenceText: string;
  readonly points: readonly TrendPoint[];
}

export interface TrendableAnalyte {
  readonly analyte: string;
  readonly unit: string;
  /** How many numeric results this patient has for it. */
  readonly pointCount: number;
}

/** The instant a result should be plotted at. */
function resultedAt(test: LabTest): string {
  return test.completedDate ?? test.collectedDate ?? test.requestedDate;
}

/**
 * Distinct series colours. `chart1…chart3` ladder by luminance and live
 * outside the alarm hues, which is what the chart palette asks for whenever
 * the colour carries no clinical meaning — and a series colour does not: the
 * clinical meaning is in the point's own flag, drawn on the marker.
 */
const SERIES_TONES: readonly AnalyticsTone[] = ['chart1', 'chart2', 'chart3'];

/**
 * Released means the order is completed — the rule API §8.8 serves trends by
 * (`order.status: 'COMPLETED'`). An order still in the lab can already carry
 * results, and a value nobody has released is not a point in anyone's history.
 */
function releasedFor(test: LabTest, patientId: string): boolean {
  return test.patient.id === patientId && test.status === 'completed';
}

/** Every numeric analyte this patient has at least one released result for. */
export function trendableAnalytes(
  tests: readonly LabTest[],
  patientId: string,
): readonly TrendableAnalyte[] {
  const byAnalyte = new Map<string, { unit: string; pointCount: number }>();

  for (const test of tests) {
    if (!releasedFor(test, patientId)) continue;
    for (const result of test.results) {
      if (result.numericValue === null) continue;
      const existing = byAnalyte.get(result.analyte);
      byAnalyte.set(result.analyte, {
        unit: existing?.unit ?? result.unit,
        pointCount: (existing?.pointCount ?? 0) + 1,
      });
    }
  }

  return Array.from(byAnalyte.entries())
    .map(([analyte, meta]) => ({ analyte, unit: meta.unit, pointCount: meta.pointCount }))
    .sort((a, b) => b.pointCount - a.pointCount || a.analyte.localeCompare(b.analyte));
}

/** One analyte's history for one patient, oldest first. */
export function buildAnalyteTrend(
  tests: readonly LabTest[],
  patientId: string,
  analyte: string,
  tone: AnalyticsTone,
): AnalyteTrend | null {
  const points: TrendPoint[] = [];
  let unit = '';
  let referenceLow: number | null = null;
  let referenceHigh: number | null = null;
  let referenceText = '';

  for (const test of tests) {
    if (!releasedFor(test, patientId)) continue;
    for (const result of test.results) {
      if (result.analyte !== analyte || result.numericValue === null) continue;
      points.push({
        labId: test.id,
        at: resultedAt(test),
        value: result.numericValue,
        flag: result.flag,
      });
      // The most recent result's range wins: a reference interval can be
      // revised, and the current one is the one a reader is comparing against.
      unit = result.unit;
      referenceLow = result.referenceRange.low;
      referenceHigh = result.referenceRange.high;
      referenceText = result.referenceRange.text;
    }
  }

  if (points.length === 0) return null;
  points.sort((a, b) => a.at.localeCompare(b.at));

  return { analyte, unit, tone, referenceLow, referenceHigh, referenceText, points };
}

/** A series as the port serves it: everything but the colour (see `toneForSeries`). */
export type ServedTrend = Omit<AnalyteTrend, 'tone'>;

/** One patient's trends for the analytes asked for — API §8.8's `LabTrendsView`. */
export interface PatientLabTrends {
  /** In the order requested; only analytes that have points. */
  readonly series: readonly ServedTrend[];
  /** Requested analytes with nothing to plot, named rather than dropped. */
  readonly empty: readonly string[];
}

/** The same answer from a set of loaded tests — the mock adapter's twin of §8.8. */
export function trendsFromTests(
  tests: readonly LabTest[],
  patientId: string,
  analytes: readonly string[],
): PatientLabTrends {
  const series: ServedTrend[] = [];
  const empty: string[] = [];
  for (const analyte of analytes) {
    const trend = buildAnalyteTrend(tests, patientId, analyte, 'chart1');
    if (trend === null) {
      empty.push(analyte);
      continue;
    }
    series.push({
      analyte: trend.analyte,
      unit: trend.unit,
      referenceLow: trend.referenceLow,
      referenceHigh: trend.referenceHigh,
      referenceText: trend.referenceText,
      points: trend.points,
    });
  }
  return { series, empty };
}

export interface TrendBand {
  readonly low: number;
  readonly high: number;
  readonly unit: string;
  readonly text: string;
}

/**
 * The shaded reference band, or null when the selection makes one
 * meaningless. See the note at the top of this file: silence beats a band
 * that belongs to only one of three overlaid series.
 */
export function trendBand(trends: readonly AnalyteTrend[]): TrendBand | null {
  const first = trends[0];
  if (first === undefined) return null;
  if (first.referenceLow === null || first.referenceHigh === null) return null;

  const sameEverywhere = trends.every(
    (trend) =>
      trend.unit === first.unit &&
      trend.referenceLow === first.referenceLow &&
      trend.referenceHigh === first.referenceHigh,
  );
  if (!sameEverywhere) return null;

  return {
    low: first.referenceLow,
    high: first.referenceHigh,
    unit: first.unit,
    text: first.referenceText,
  };
}

export interface TrendDomain {
  readonly min: number;
  readonly max: number;
}

/**
 * The y-window. Deliberately NOT anchored at zero: a potassium series whose
 * reference range is 3.5–5.1 is unreadable on an axis that starts at 0, and
 * the shared `LineAreaChart` — which does anchor at zero, correctly, for
 * counts — is therefore the wrong instrument here rather than a component to
 * bend. The window always contains the band, so "inside/outside the range" is
 * legible even when every point sits well inside it.
 */
export function trendDomain(
  trends: readonly AnalyteTrend[],
  band: TrendBand | null,
): TrendDomain {
  const values = trends.flatMap((trend) => trend.points.map((point) => point.value));
  if (band !== null) values.push(band.low, band.high);
  if (values.length === 0) return { min: 0, max: 1 };

  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const spread = rawMax - rawMin;
  // A flat series (every value identical) still needs a window to draw in.
  const padding = spread === 0 ? Math.max(Math.abs(rawMax) * 0.1, 0.5) : spread * 0.15;

  return { min: rawMin - padding, max: rawMax + padding };
}

/** Rows for the view-as-table toggle (P6): one row per instant, one column per series. */
export interface TrendTableRow {
  readonly at: string;
  readonly labId: string;
  readonly cells: ReadonlyArray<{
    readonly analyte: string;
    readonly value: number | null;
    readonly flagLabel: string | null;
  }>;
}

export function trendTableRows(trends: readonly AnalyteTrend[]): readonly TrendTableRow[] {
  const instants = new Map<string, string>();
  for (const trend of trends) {
    for (const point of trend.points) instants.set(point.at, point.labId);
  }

  return Array.from(instants.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([at, labId]) => ({
      at,
      labId,
      cells: trends.map((trend) => {
        const point = trend.points.find((candidate) => candidate.at === at);
        return {
          analyte: trend.analyte,
          value: point?.value ?? null,
          flagLabel: point ? LAB_RESULT_FLAG_META[point.flag].label : null,
        };
      }),
    }));
}

/** Assigns the distinct series colours, in selection order, capped at three. */
export function toneForSeries(index: number): AnalyticsTone {
  return SERIES_TONES[index % SERIES_TONES.length] ?? 'chart1';
}
