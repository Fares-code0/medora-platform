/**
 * Analyte trends (API §8.8).
 *
 * > "Time series per analyte (max 3), reference band included"
 *
 * The shape is `AnalyteTrend` and `TrendPoint` from
 * `features/doctor/labs/model/trends.ts`, which is what
 * `AnalyteTrendChart` already plots — so `at`, `value`, `flag` and
 * `labId` are spelled exactly as that module spells them, and the
 * reference bounds arrive as `referenceLow`/`referenceHigh`/
 * `referenceText` rather than as the nested `referenceRange` a result
 * carries. Two shapes, because a chart series has one range for the
 * whole series and a result has the range it was judged against.
 *
 * ## What is served and what is left to the client
 *
 * `tone` is **not** served. It is a palette choice — `chart1…chart3`
 * ladder by luminance and carry no clinical meaning, which that module
 * says in as many words — and a server that assigned colours would be
 * deciding how a chart looks. The client calls `toneForSeries(index)`
 * on the order it asked for.
 *
 * The **band** is not served either, for a sharper reason: `trendBand`
 * returns null unless every selected series shares one unit and one
 * range, because "a band drawn under three units would be a band for
 * whichever series happened to be first". That rule is about what is
 * being *drawn*, and it is already coded, tested and rank-1. Serving a
 * second implementation of it would be two answers to one question. The
 * server serves each series' own bounds — which is what "reference band
 * included" asks for — and the drawing rule stays where it is.
 */

export interface TrendPointView {
  /** `LAB-…` — the order this point came from, so a point links out. */
  readonly labId: string;
  /** The instant the value was released. */
  readonly at: string;
  readonly value: number;
  readonly flag: string;
}

export interface AnalyteTrendView {
  readonly analyte: string;
  readonly unit: string;
  readonly referenceLow: number | null;
  readonly referenceHigh: number | null;
  readonly referenceText: string;
  /** Oldest first — a time series read left to right. */
  readonly points: readonly TrendPointView[];
}

export interface LabTrendsView {
  /** `PT-…`, echoed so a cached response cannot be read against another. */
  readonly patientId: string;
  /**
   * One entry per requested analyte **that has points**. An analyte with
   * no numeric result for this patient is absent rather than present and
   * empty: an empty series renders as a flat line at zero in most chart
   * libraries, which is a clinical claim nobody made.
   */
  readonly series: readonly AnalyteTrendView[];
  /**
   * Requested analytes with nothing to plot, named rather than dropped.
   * A client that asked for three series and received two must be able
   * to say which one is missing.
   */
  readonly empty: readonly string[];
}
