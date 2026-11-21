/**
 * Admin Reports — domain types (ADM-08 · UX §3.8).
 *
 * Four reports, one range, one comparison switch. Everything on the page is a
 * `ReportWidget`, and every widget is built the same way: a `WidgetVisual`
 * describing what to draw, from which the table and the export file are
 * *derived* rather than assembled a second time. That is the one structural
 * decision worth stating up front — §3.8 requires each widget to be
 * range-aware, viewable as a table and individually exportable, and three
 * independent renderings of the same numbers is three chances for them to
 * disagree. `datasetOf()` in `reports.ts` is the single projection.
 *
 * ## Availability is three-valued, not two
 *
 * The spec's state list has "empty range" and "error". A frontend deriving
 * leadership analytics from mock stores needs a third: **no source exists at
 * all**. Lab turnaround time and AI service latency are specified widgets with
 * nothing anywhere in this client that could answer them, and rendering them
 * as "no data for this period" would be a lie — it says try a wider range,
 * when no range will ever help. `unavailable` says what is missing and who
 * would supply it, which is the honest reading and the one an operator can
 * act on. See ADM-01's precedent for labelling invented figures rather than
 * quietly serving them.
 */

import type { AnalyticsTone, HeatmapData, NamedSeries, Slice } from '@/components/charts';

/* ── Reports and ranges ───────────────────────────────────────── */

/** §3.8's four report selector tabs. */
export type ReportId = 'growth' | 'utilization' | 'clinical' | 'system';

export const REPORT_IDS: readonly ReportId[] = ['growth', 'utilization', 'clinical', 'system'];

export type RangeKey = '7d' | '30d' | '90d' | '12m';

export const RANGE_KEYS: readonly RangeKey[] = ['7d', '30d', '90d', '12m'];

/** How a range is cut up along the x-axis. */
export type BucketKind = 'day' | 'week' | 'month';

/**
 * A resolved window, half-open `[fromMs, toMs)`.
 *
 * Half-open on purpose: an appointment starting at exactly the boundary
 * belongs to one bucket, not to both, and the closed-interval version of this
 * double-counts every row that lands on a bucket edge. The comparison window
 * is the same length immediately before `fromMs`, so the two never overlap.
 */
export interface ReportRange {
  readonly key: RangeKey;
  readonly fromMs: number;
  readonly toMs: number;
  readonly bucket: BucketKind;
  /** Bucket boundaries, ascending; `buckets.length` is the series length. */
  readonly buckets: readonly BucketSpan[];
}

export interface BucketSpan {
  readonly label: string;
  readonly fromMs: number;
  readonly toMs: number;
}

/* ── Widgets ──────────────────────────────────────────────────── */

export type WidgetId =
  // Growth
  | 'user-growth'
  | 'net-new'
  | 'activation-rate'
  | 'retention-cohorts'
  // Utilization
  | 'appointment-volume'
  | 'volume-by-specialty'
  | 'booking-funnel'
  | 'peak-hours'
  | 'capacity-vs-demand'
  // Clinical operations
  | 'response-time'
  | 'outcome-rates'
  | 'prescription-volume'
  | 'lab-turnaround'
  // System performance
  | 'uptime-latency'
  | 'error-rate'
  | 'notification-delivery'
  | 'ai-usage'
  | 'storage-growth';

/**
 * How a widget's numbers are spelled. Carried on the visual rather than
 * applied at the call site so the chart's axis, the table's cells and the
 * exported file all format identically — a percentage that renders as `82%`
 * on screen and `82` in the CSV is two different claims about the same cell.
 */
export type ValueFormat = 'count' | 'percent' | 'hours' | 'ms' | 'gb';

/** A labelled figure in a `facts` widget — the shape with no chart. */
export interface WidgetFact {
  readonly label: string;
  readonly value: string;
  readonly hint: string | null;
}

/** One extra table/export column beside a bar series. See `annotations`. */
export interface WidgetAnnotation {
  readonly column: string;
  /** One entry per `series.points` entry, in the same order. */
  readonly values: readonly (string | number)[];
}

/**
 * What a widget draws. The discriminant picks the chart component; every
 * variant also carries the axis labels `datasetOf()` needs to name its
 * columns, so the table view is never missing a header the chart implied.
 */
export type WidgetVisual =
  | {
      readonly kind: 'line' | 'area';
      readonly series: readonly NamedSeries[];
      readonly categoryLabel: string;
      readonly format: ValueFormat;
    }
  | {
      readonly kind: 'bar' | 'distribution';
      readonly series: NamedSeries;
      readonly categoryLabel: string;
      readonly valueLabel: string;
      readonly format: ValueFormat;
      readonly barTones?: readonly AnalyticsTone[];
      /**
       * Extra columns the table and the export carry and the chart does not,
       * aligned index-for-index with `series.points`.
       *
       * They exist because several §3.8 widgets are one chartable number plus
       * the figures that number was computed from — the no-show rate beside
       * its completion and cancellation rates, a specialty's utilisation
       * beside its capacity and demand. Dropping those would make the table
       * view a strictly poorer rendering than the chart, and putting them in
       * a separately-assembled dataset would give the widget two sources.
       * Declared here, inside the visual, `datasetOf()` still derives
       * everything from one object.
       */
      readonly annotations?: readonly WidgetAnnotation[];
    }
  | {
      readonly kind: 'pie';
      readonly slices: readonly Slice[];
      readonly categoryLabel: string;
      readonly valueLabel: string;
      readonly format: ValueFormat;
    }
  | {
      readonly kind: 'heatmap';
      readonly data: HeatmapData;
      readonly categoryLabel: string;
      readonly format: ValueFormat;
      /**
       * The cell value that means "no data", or `null` when every cell is real.
       *
       * A retention grid has cells in the future, and those are not zero
       * retention — rendering them as the coldest colour on the scale would
       * say every young cohort churned completely. The sentinel keeps them
       * blank in the grid and as `—` in the table, which is the honest
       * reading and the one `datasetOf()` needs to know about.
       */
      readonly blankValue: number | null;
    }
  | {
      readonly kind: 'facts';
      readonly facts: readonly WidgetFact[];
    };

/**
 * The tabular form of a widget — what "view as table" renders and what "export
 * this widget" writes. Derived from the visual by `datasetOf()`; never built
 * independently.
 */
export interface WidgetDataset {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly (string | number)[])[];
}

export type WidgetAvailability = 'ready' | 'empty' | 'unavailable';

/**
 * Which way is "better" for a headline figure.
 *
 * Declared by the widget rather than inferred from the sign of the delta,
 * because "up" is not always good: a rising no-show rate and a rising
 * activation rate move the same way on the axis and in opposite directions for
 * the reader. Leaving that to arithmetic is how a dashboard ends up painting a
 * worsening metric green.
 */
export type SummaryDirection = 'higher-better' | 'lower-better' | 'neutral';

/**
 * A widget's headline number and, when the compare switch is on, how it moved
 * against the immediately preceding window of the same length.
 */
export interface WidgetSummary {
  readonly label: string;
  /** Formatted for display. */
  readonly value: string;
  /**
   * The unformatted figure the comparison is computed from. `null` when the
   * headline is not a number at all, which also means it can never be compared.
   */
  readonly raw: number | null;
  readonly direction: SummaryDirection;
  readonly comparison: WidgetComparison | null;
}

export interface WidgetComparison {
  readonly previousValue: string;
  /** Rounded to one decimal. `null` when the previous window was zero. */
  readonly deltaPercent: number | null;
  /** Whether the move is good, bad, or carries no judgement. */
  readonly sentiment: 'good' | 'bad' | 'neutral';
}

export interface ReportWidget {
  readonly id: WidgetId;
  readonly title: string;
  readonly caption: string;
  readonly availability: WidgetAvailability;
  /**
   * Why the widget is not `ready`. Rendered on screen verbatim, so it names
   * the missing source rather than saying "no data".
   */
  readonly note: string | null;
  /** `null` exactly when `availability !== 'ready'`. */
  readonly visual: WidgetVisual | null;
  readonly summary: WidgetSummary | null;
  /** A management page with the matching filter already applied (§3.8). */
  readonly drillTo: string | null;
  readonly drillLabel: string | null;
  /**
   * Set when the widget answers a different question from the global range —
   * `capacity-vs-demand` is a live snapshot, `prescription-volume` reports the
   * fixed window each doctor's activity record covers. Rendered as a chip so a
   * reader never reads a range-free number as range-scoped.
   */
  readonly rangeOverride: string | null;
}

export interface ReportDocument {
  readonly id: ReportId;
  readonly range: ReportRange;
  readonly compare: boolean;
  readonly widgets: readonly ReportWidget[];
  /** Report-level footnotes — deliberate omissions, mostly. */
  readonly notes: readonly string[];
}

/* ── Scheduled reports (§3.8 "Schedule report") ───────────────── */

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export type ScheduleFormat = 'pdf' | 'csv';

/**
 * The outcome of one delivery attempt. §3.8: "Scheduled-report failures notify
 * the admin via 2.9-equivalent system notification", so a failure has to be a
 * first-class stored outcome rather than an absence of success.
 */
export interface ScheduleRun {
  readonly at: string;
  readonly status: 'delivered' | 'failed';
  readonly detail: string;
}

export interface ScheduledReport {
  readonly id: string;
  readonly reportId: ReportId;
  readonly name: string;
  readonly frequency: ScheduleFrequency;
  readonly range: RangeKey;
  /** Email addresses. Validated on create; never a patient's. */
  readonly recipients: readonly string[];
  readonly format: ScheduleFormat;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly paused: boolean;
  readonly lastRun: ScheduleRun | null;
  readonly nextRunAt: string;
}

/** What the schedule dialog submits. */
export interface ScheduleDraft {
  readonly reportId: ReportId;
  readonly name: string;
  readonly frequency: ScheduleFrequency;
  readonly range: RangeKey;
  readonly recipients: readonly string[];
  readonly format: ScheduleFormat;
}
