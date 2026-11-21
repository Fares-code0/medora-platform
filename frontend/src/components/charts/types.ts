/**
 * Chart data contracts — shared by every token-styled chart. Tones map to
 * design-system color tokens through palette.ts, so any feature rendering a
 * chart stays theme-aware without ever computing colors itself.
 */

/**
 * Categorical chart slots — the DEFAULT vocabulary for any series whose
 * colour carries no clinical meaning (a specialty, a weekday, a drug class).
 * They ladder by luminance, so they stay separable in greyscale and under
 * colour-vision deficiency, and they live outside the alarm hues entirely.
 */
export type ChartTone = 'chart1' | 'chart2' | 'chart3' | 'chart4' | 'chart5';

/**
 * Clinical semantic tones. Use one ONLY when the colour is the message —
 * a lab-status breakdown, a satisfaction scale. Choosing `warning` for a
 * category that merely happens to be fourth in a list is the bug ADR-0001 §9
 * fixed; reach for a `ChartTone` instead.
 */
export type SemanticTone =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'success'
  | 'warning'
  | 'info'
  | 'error';

/** Design-system accent a series/slice is drawn with. */
export type AnalyticsTone = ChartTone | SemanticTone;

/** A labelled point on a category axis (bar, line, area, distribution). */
export interface SeriesPoint {
  readonly label: string;
  readonly value: number;
}

/** A named series with its analytics tone (multi-series line/area/bar). */
export interface NamedSeries {
  readonly name: string;
  readonly tone: AnalyticsTone;
  readonly points: readonly SeriesPoint[];
}

/** A slice for pie/donut charts. */
export interface Slice {
  readonly label: string;
  readonly value: number;
  readonly tone: AnalyticsTone;
}

/** A heatmap cell grid: rows × columns of intensity values. */
export interface HeatmapData {
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  /** rows[r] × columns[c] → value. */
  readonly cells: readonly (readonly number[])[];
  readonly max: number;
}
