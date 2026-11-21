/**
 * The revenue category's flag-off alternate (RM M17.2 — API §12.1).
 *
 * > "`revenue` only when billing flag on (else 404/flag-off alternate)"
 *
 * ADR-018 §2 already picked which of those two: **the alternate
 * payload**, because "the frontend renders alternates and has no 404
 * branch there". This file is the shape of that alternate.
 *
 * ## Why this is not `AnalyticsSnapshot`
 *
 * `AnalyticsSnapshot` in `features/doctor/reports/model/types.ts` has
 * eleven members — trend, weekday, departments, labStatus, heatmap and
 * the rest — and **M21 owns it**. Returning a whole snapshot here would
 * mean computing ten analytics this milestone has no mandate for, and
 * would leave M21 replacing rather than extending. M17's own exit gate
 * is "nothing built ahead of product need; contract slot reserved".
 *
 * So what is reserved is the *slot*: a caller asking for revenue gets a
 * well-formed, self-describing answer saying billing is off and naming
 * what the UI should render instead. When M21 builds the analytics
 * endpoint it serves this same payload for `category=revenue` while the
 * flag is off, and the real snapshot when it is on.
 *
 * ## The alternate content is the contract's, not invented
 *
 * UX §2.1: the revenue card is "visible only when the clinic enables
 * per-doctor billing; otherwise the slot shows **'Top visit types'**
 * instead". UX §3.1 names Storage & Usage as the admin slot's fallback,
 * which `StorageUsageCard` already ships. The doctor's fallback had no
 * server side at all, and is this.
 */

/** One row of the alternate — a visit type and how often it occurred. */
export interface TopVisitTypeView {
  readonly label: string;
  readonly value: number;
}

export interface RevenueAlternateView {
  readonly category: 'revenue';
  /**
   * Always `false` here, and present rather than implied.
   *
   * A client that had to infer "billing is off" from the *absence* of
   * revenue figures would render an empty chart on a deployment whose
   * billing is on but whose month is quiet. The flag says which of the
   * two it is looking at.
   */
  readonly billingEnabled: boolean;
  /**
   * What to render in the slot — the vocabulary the UI switches on, so
   * the server names the alternate rather than the client guessing from
   * the payload's shape.
   */
  readonly alternate: 'top-visit-types';
  /** A line the card can show verbatim. */
  readonly notice: string;
  readonly topVisitTypes: readonly TopVisitTypeView[];
  /** The window the counts cover, echoed so a cached card can date itself. */
  readonly range: { readonly from: string; readonly to: string };
}

/* ── The full snapshot (RM M21.1 — API §12.1) ───────────────────── */

/**
 * The chart primitives, transcribed from `@/components/charts`.
 *
 * `tone` is a presentational hint the frontend's chart library already
 * understands, and it travels because the *server* decides which series
 * is which — a client colouring by array position would recolour every
 * chart the day a series is added.
 */
export interface SeriesPointView {
  readonly label: string;
  readonly value: number;
}

export interface NamedSeriesView {
  readonly name: string;
  readonly tone: string;
  readonly points: readonly SeriesPointView[];
}

export interface SliceView {
  readonly label: string;
  readonly value: number;
  readonly tone: string;
}

export interface HeatmapView {
  readonly rows: readonly string[];
  readonly columns: readonly string[];
  readonly cells: readonly (readonly number[])[];
  readonly max: number;
}

/**
 * One KPI chip.
 *
 * **`icon` is deliberately absent**, and it is the one place this shape
 * departs from the frontend's `KpiDatum`. That field is typed
 * `LucideIcon` — a React component reference — which cannot cross a wire
 * and has no server-side meaning. `id` is the stable key
 * (`CATEGORY_VIEW`'s `kpiIds` are exactly these), and the client maps it
 * to an icon the same way it maps a category to one today.
 */
export interface KpiView {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly format: 'number' | 'currency' | 'percent';
  readonly deltaPercent: number;
  readonly tone: string;
  readonly spark: readonly number[];
}

/**
 * `AnalyticsSnapshot`, with every member present.
 *
 * Members outside the requested category's `charts` come back **empty**
 * rather than absent: the frontend type requires all eleven, and an
 * absent member would make every consumer test for undefined on a field
 * its own type says exists. Empty is also the honest answer — the
 * category did not ask for it, so nothing was computed.
 */
export interface AnalyticsSnapshotView {
  readonly category: string;
  readonly billingEnabled: boolean;
  readonly range: { readonly from: string; readonly to: string };
  /** Present only when `compare=true` was asked for. */
  readonly comparison: { readonly from: string; readonly to: string } | null;
  readonly kpis: readonly KpiView[];
  readonly trend: readonly NamedSeriesView[];
  readonly weekday: NamedSeriesView;
  readonly departments: readonly SliceView[];
  readonly labStatus: readonly SliceView[];
  readonly ageDistribution: NamedSeriesView;
  readonly heatmap: HeatmapView;
  readonly pharmacy: NamedSeriesView;
  readonly messages: NamedSeriesView;
  readonly aiUsage: NamedSeriesView;
  readonly records: NamedSeriesView;
}

/** API §12.2 — one insight card. */
export interface InsightView {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly detail: string;
  readonly trend: 'up' | 'down' | 'flat' | null;
  readonly tone: string;
}
