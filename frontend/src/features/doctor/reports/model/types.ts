import {
  Activity,
  Bot,
  Calendar,
  DollarSign,
  FileText,
  FlaskConical,
  MessageSquare,
  Pill,
  Users,
  type LucideIcon,
} from 'lucide-react';

import type {
  AnalyticsTone,
  HeatmapData,
  NamedSeries,
  SemanticTone,
  SeriesPoint,
  Slice,
} from '@/components/charts';

/**
 * Reports & Analytics domain model — feature-local types for the enterprise
 * reporting center. Everything is frontend-only: deterministic seeded
 * datasets plus a per-user localStorage document for saved and scheduled
 * reports. No PHI — analytics are aggregate counts, never patient rows.
 */

/* ── Report categories (analytics domains) ──────────────────────── */

export type ReportCategory =
  | 'overview'
  | 'revenue'
  | 'patients'
  | 'appointments'
  | 'laboratory'
  | 'records'
  | 'pharmacy'
  | 'messages'
  | 'ai';

export interface CategoryMeta {
  readonly id: ReportCategory;
  readonly label: string;
  readonly icon: LucideIcon;
  /**
   * UI accent for the category chip and its KPI cards — a semantic tone, not
   * a chart slot. Chart marks inside a category pick their own colours from
   * the categorical ramp (ADR-0001 §9).
   */
  readonly tone: SemanticTone;
}

export type { AnalyticsTone, SemanticTone, SeriesPoint, NamedSeries, Slice, HeatmapData };

export const REPORT_CATEGORIES: readonly CategoryMeta[] = [
  { id: 'overview', label: 'Executive overview', icon: Activity, tone: 'primary' },
  { id: 'revenue', label: 'Revenue', icon: DollarSign, tone: 'success' },
  { id: 'patients', label: 'Patients', icon: Users, tone: 'primary' },
  { id: 'appointments', label: 'Appointments', icon: Calendar, tone: 'info' },
  { id: 'laboratory', label: 'Laboratory', icon: FlaskConical, tone: 'error' },
  { id: 'records', label: 'Medical records', icon: FileText, tone: 'secondary' },
  { id: 'pharmacy', label: 'Pharmacy', icon: Pill, tone: 'warning' },
  { id: 'messages', label: 'Messages', icon: MessageSquare, tone: 'info' },
  { id: 'ai', label: 'AI usage', icon: Bot, tone: 'accent' },
];

export function isReportCategory(value: string): value is ReportCategory {
  return REPORT_CATEGORIES.some((category) => category.id === value);
}

/**
 * Per-category view definition — which charts, trend series, KPIs, and
 * insights belong to each category. Selecting a category focuses the page on
 * ONLY that domain's analytics (no unrelated charts). Overview is the single
 * cross-practice summary. `chart` ids are resolved by the analytics grid.
 */
export interface CategoryView {
  readonly charts: readonly string[];
  /** Trend series to include (by name); null = all series. */
  readonly trendSeries: readonly string[] | null;
  /** KPI ids to show; empty = hide the KPI band for this focused view. */
  readonly kpiIds: readonly string[];
  /** Insight kinds to show; null = all. */
  readonly insightKinds: readonly InsightKind[] | null;
}

export const CATEGORY_VIEW: Record<ReportCategory, CategoryView> = {
  overview: {
    charts: ['trend', 'departments', 'labStatus', 'weekday', 'pharmacy', 'age', 'heatmap'],
    trendSeries: null,
    kpiIds: ['revenue', 'patients', 'appointments', 'lab-orders', 'prescriptions', 'growth'],
    insightKinds: null,
  },
  revenue: {
    charts: ['trend'],
    trendSeries: ['Revenue (k)'],
    kpiIds: ['revenue', 'growth'],
    insightKinds: ['revenue'],
  },
  patients: {
    charts: ['departments', 'age', 'trend'],
    trendSeries: ['Patients'],
    kpiIds: ['patients'],
    insightKinds: ['workload'],
  },
  appointments: {
    charts: ['weekday', 'heatmap', 'trend'],
    trendSeries: ['Appointments'],
    kpiIds: ['appointments'],
    insightKinds: ['busiest'],
  },
  laboratory: {
    charts: ['labStatus'],
    trendSeries: null,
    kpiIds: ['lab-orders'],
    insightKinds: ['critical', 'lab'],
  },
  records: {
    charts: ['records'],
    trendSeries: null,
    kpiIds: [],
    insightKinds: [],
  },
  pharmacy: {
    charts: ['pharmacy'],
    trendSeries: null,
    kpiIds: ['prescriptions'],
    insightKinds: ['pharmacy'],
  },
  messages: {
    charts: ['messages'],
    trendSeries: null,
    kpiIds: [],
    insightKinds: [],
  },
  ai: {
    charts: ['ai'],
    trendSeries: null,
    kpiIds: [],
    insightKinds: [],
  },
};

/* ── Date ranges ────────────────────────────────────────────────── */

export type DateRangeKey = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export const DATE_RANGES: readonly { readonly id: DateRangeKey; readonly label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'quarter', label: 'This quarter' },
  { id: 'year', label: 'This year' },
  { id: 'custom', label: 'Custom' },
];

/* ── Advanced filters ───────────────────────────────────────────── */

export type Gender = 'all' | 'female' | 'male';
export type AgeBand = 'all' | '0-17' | '18-39' | '40-64' | '65+';

/**
 * Advanced filters for the Doctor Reports page. Patient and Doctor filters
 * are intentionally absent — a doctor only ever sees their own analytics, so
 * those controls made no sense here.
 */
export interface ReportFilters {
  readonly category: ReportCategory;
  readonly range: DateRangeKey;
  readonly customFrom: string | null;
  readonly customTo: string | null;
  readonly department: string;
  readonly status: string;
  readonly medication: string;
  readonly labTest: string;
  readonly age: AgeBand;
  readonly gender: Gender;
}

export const DEFAULT_FILTERS: ReportFilters = {
  category: 'overview',
  range: 'month',
  customFrom: null,
  customTo: null,
  department: 'all',
  status: 'all',
  medication: 'all',
  labTest: 'all',
  age: 'all',
  gender: 'all',
};

/* ── KPIs ───────────────────────────────────────────────────────── */

export interface KpiDatum {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  /** Formatting hint for display. */
  readonly format: 'number' | 'currency' | 'percent';
  readonly deltaPercent: number;
  /** KPI chip accent — semantic, never a chart slot. */
  readonly tone: SemanticTone;
  readonly icon: LucideIcon;
  /** Short recent series for the KPI sparkline. */
  readonly spark: readonly number[];
}

/* ── Chart series ───────────────────────────────────────────────── */
/* The chart data contracts (AnalyticsTone, SeriesPoint, NamedSeries, Slice,
   HeatmapData) live in the shared chart library (@/components/charts) and are
   re-exported above so reports code keeps its existing import paths. */

/* ── The analytics snapshot for a filter set ────────────────────── */

export interface AnalyticsSnapshot {
  readonly kpis: readonly KpiDatum[];
  /** Multi-series trend over the period (revenue / patients / appointments). */
  readonly trend: readonly NamedSeries[];
  /** Volume per weekday (bar). */
  readonly weekday: NamedSeries;
  /** Patients per department (pie / donut). */
  readonly departments: readonly Slice[];
  /** Lab order status split (donut). */
  readonly labStatus: readonly Slice[];
  /** Age distribution (distribution bars). */
  readonly ageDistribution: NamedSeries;
  /** Activity heatmap (weekday × time-of-day). */
  readonly heatmap: HeatmapData;
  /** Prescriptions by drug class (bar). */
  readonly pharmacy: NamedSeries;
  /** Messages sent per weekday (bar). */
  readonly messages: NamedSeries;
  /** AI assistant usage by feature (distribution). */
  readonly aiUsage: NamedSeries;
  /** Medical records created by type (bar). */
  readonly records: NamedSeries;
}

/* ── Insights ───────────────────────────────────────────────────── */

export type InsightKind =
  'workload' | 'busiest' | 'critical' | 'pharmacy' | 'lab' | 'revenue' | 'ai';

export interface Insight {
  readonly id: string;
  readonly kind: InsightKind;
  readonly title: string;
  readonly detail: string;
  /** Direction of the movement it describes, if any. */
  readonly trend: 'up' | 'down' | 'flat' | null;
  /** Insight accent — semantic; an insight's colour IS its message. */
  readonly tone: SemanticTone;
}

/* ── Saved reports ──────────────────────────────────────────────── */

export interface SavedReport {
  readonly id: string;
  readonly name: string;
  readonly category: ReportCategory;
  readonly range: DateRangeKey;
  readonly favorite: boolean;
  readonly createdAt: string;
  readonly lastViewedAt: string;
  /** Snapshot of the filters this report was saved with. */
  readonly filters: ReportFilters;
}

/* ── Scheduled reports ──────────────────────────────────────────── */

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';
export type ScheduleStatus = 'active' | 'paused';
export type ExportFormat = 'csv' | 'excel' | 'pdf' | 'print';

export const EXPORT_FORMATS: readonly {
  readonly id: ExportFormat;
  readonly label: string;
  readonly description: string;
}[] = [
  { id: 'csv', label: 'CSV', description: 'Comma-separated values for spreadsheets.' },
  { id: 'excel', label: 'Excel', description: 'Formatted .xlsx workbook.' },
  { id: 'pdf', label: 'PDF', description: 'Print-ready document with charts.' },
  { id: 'print', label: 'Print', description: 'Send to your printer.' },
];

export interface ScheduleRun {
  readonly id: string;
  readonly at: string;
  readonly status: 'sent' | 'failed';
}

export interface ScheduledReport {
  readonly id: string;
  readonly name: string;
  readonly category: ReportCategory;
  readonly frequency: ScheduleFrequency;
  readonly format: ExportFormat;
  readonly recipients: readonly string[];
  readonly status: ScheduleStatus;
  readonly nextRunAt: string;
  readonly history: readonly ScheduleRun[];
}

/* ── The per-user reports document ──────────────────────────────── */

export interface ReportsDocument {
  readonly saved: readonly SavedReport[];
  readonly scheduled: readonly ScheduledReport[];
}
