/**
 * Shared chart library — hand-rolled, token-styled SVG/CSS charts following
 * the KpiWidget Sparkline precedent (no third-party chart dependency). Every
 * chart is responsive, theme-aware, and carries native tooltips; multi-series
 * and pie/donut charts add interactive legends. Features (dashboard, reports)
 * supply data in the shared contracts from types.ts.
 */
export { LineAreaChart, type LineAreaChartProps } from './LineAreaChart';
export { BarChart, type BarChartProps } from './BarChart';
export { PieChart, type PieChartProps } from './PieChart';
export { Heatmap, type HeatmapProps } from './Heatmap';
export { DistributionBars, type DistributionBarsProps } from './DistributionBars';
export { ChartLegend, type ChartLegendProps, type LegendItem } from './ChartLegend';
export { TONE_CLASSES, BG_SOLID, ORDERED_TONES, toneAt, type ToneClasses } from './palette';
export type {
  AnalyticsTone,
  ChartTone,
  SemanticTone,
  SeriesPoint,
  NamedSeries,
  Slice,
  HeatmapData,
} from './types';
