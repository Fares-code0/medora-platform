import type { AnalyticsTone, ChartTone } from './types';

/**
 * Analytics color system — maps each analytics tone to design-system token
 * utility classes for SVG fills/strokes/text and subtle backgrounds. Charts
 * only ever reference these, so every series stays theme-aware (light/dark)
 * and consistent with the module palette. `ORDERED_TONES` is the categorical
 * sequence used when a chart auto-assigns colors to slices/series.
 */

export interface ToneClasses {
  /** SVG fill (solid marks: bars, slices, dots). */
  readonly fill: string;
  /**
   * The LINE itself, for line/area charts. Not an outline — for the pale
   * chart slots this is the darker edge colour, because a 1.40:1 line would
   * be invisible.
   */
  readonly stroke: string;
  /**
   * OUTLINE of a solid SVG mark — a bar, a pie slice. Distinct from `stroke`
   * because the two roles disagree for semantic tones: a semantic line must
   * be drawn in its own colour, while a semantic slice needs a *separator*
   * from its neighbour, which its own colour cannot provide.
   *
   *  - chart slots  -> the darker same-hue edge. Load-bearing: it is what
   *    holds the pale slots 4 and 5 to 3:1 against the surface.
   *  - semantic     -> `stroke-surface`, the neighbour separator, since these
   *    tones have no darker variant and already clear 4.5:1 unaided.
   */
  readonly edge: string;
  /**
   * Outline for a CSS (non-SVG) mark — distribution bars, legend swatches.
   * The `edge` counterpart, expressed as a ring so it does not change the
   * mark's box.
   */
  readonly ring: string;
  /** Text color (legends, labels). */
  readonly text: string;
}

export const TONE_CLASSES: Record<AnalyticsTone, ToneClasses> = {
  /* ── Categorical slots — the default for non-clinical series ────── */
  chart1: {
    fill: 'fill-chart-1',
    stroke: 'stroke-chart-1-edge',
    edge: 'stroke-chart-1-edge',
    ring: 'ring-chart-1-edge',
    text: 'text-text-primary',
  },
  chart2: {
    fill: 'fill-chart-2',
    stroke: 'stroke-chart-2-edge',
    edge: 'stroke-chart-2-edge',
    ring: 'ring-chart-2-edge',
    text: 'text-text-primary',
  },
  chart3: {
    fill: 'fill-chart-3',
    stroke: 'stroke-chart-3-edge',
    edge: 'stroke-chart-3-edge',
    ring: 'ring-chart-3-edge',
    text: 'text-text-primary',
  },
  chart4: {
    fill: 'fill-chart-4',
    stroke: 'stroke-chart-4-edge',
    edge: 'stroke-chart-4-edge',
    ring: 'ring-chart-4-edge',
    text: 'text-text-primary',
  },
  chart5: {
    fill: 'fill-chart-5',
    stroke: 'stroke-chart-5-edge',
    edge: 'stroke-chart-5-edge',
    ring: 'ring-chart-5-edge',
    text: 'text-text-primary',
  },

  /* ── Clinical semantics — only when the colour IS the message ───── */
  /*
   * No darker `-edge` variant exists for these, and they do not need one:
   * every semantic base clears 4.5:1 against the surface unaided (ADR-0001),
   * so nothing has to carry their contrast. Their `edge` is therefore the
   * surface separator — the job that actually remains on a pie, telling one
   * slice from the next — while `stroke` stays the tone itself so a semantic
   * line chart draws in its own colour.
   */
  primary: {
    fill: 'fill-primary',
    stroke: 'stroke-primary',
    edge: 'stroke-surface',
    ring: 'ring-primary',
    text: 'text-primary',
  },
  secondary: {
    fill: 'fill-secondary',
    stroke: 'stroke-secondary',
    edge: 'stroke-surface',
    ring: 'ring-secondary',
    text: 'text-secondary',
  },
  accent: {
    fill: 'fill-accent',
    stroke: 'stroke-accent',
    edge: 'stroke-surface',
    ring: 'ring-accent',
    text: 'text-accent',
  },
  success: {
    fill: 'fill-success',
    stroke: 'stroke-success',
    edge: 'stroke-surface',
    ring: 'ring-success',
    text: 'text-success',
  },
  warning: {
    fill: 'fill-warning',
    stroke: 'stroke-warning',
    edge: 'stroke-surface',
    ring: 'ring-warning',
    text: 'text-warning',
  },
  info: {
    fill: 'fill-info',
    stroke: 'stroke-info',
    edge: 'stroke-surface',
    ring: 'ring-info',
    text: 'text-info',
  },
  error: {
    fill: 'fill-error',
    stroke: 'stroke-error',
    edge: 'stroke-surface',
    ring: 'ring-error',
    text: 'text-error',
  },
};

/** Solid background per tone (bars, legend swatches). */
export const BG_SOLID: Record<AnalyticsTone, string> = {
  chart1: 'bg-chart-1',
  chart2: 'bg-chart-2',
  chart3: 'bg-chart-3',
  chart4: 'bg-chart-4',
  chart5: 'bg-chart-5',
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  error: 'bg-error',
};

/**
 * Categorical order for auto-assigned series/slice colours.
 *
 * ONLY chart slots appear here, and that is the point: this list used to run
 * `primary, success, accent, warning, info, secondary, error`, so the second
 * auto-assigned category was success-green, the fourth warning-amber and the
 * seventh error-red — alarm colours chosen by list position rather than by
 * meaning. Nothing auto-assigned can reach a clinical hue any more.
 *
 * A chart needing a semantic colour must ask for it explicitly, per series.
 */
export const ORDERED_TONES: readonly ChartTone[] = [
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
];

export function toneAt(index: number): ChartTone {
  return ORDERED_TONES[index % ORDERED_TONES.length] ?? 'chart1';
}
