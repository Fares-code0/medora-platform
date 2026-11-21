import { hashString } from '@/features/shared-domain/patient-identity';
import { formatNumber as formatAppNumber } from '@/i18n';

import {
  BASE_AGE,
  BASE_AI,
  BASE_APPOINTMENTS,
  BASE_DEPARTMENTS,
  BASE_HEATMAP,
  BASE_KPIS,
  BASE_LAB_STATUS,
  BASE_MESSAGES,
  BASE_PATIENTS,
  BASE_PHARMACY,
  BASE_RECORDS,
  BASE_REVENUE,
  BASE_WEEKDAY,
  MONTHS,
  TIME_SLOTS,
  WEEKDAYS,
} from './mock-data';
import type {
  AnalyticsSnapshot,
  DateRangeKey,
  Insight,
  KpiDatum,
  NamedSeries,
  ReportFilters,
  SeriesPoint,
  Slice,
} from './types';

/**
 * Analytics derivation — turns the base seeds into a filter-specific
 * snapshot. Ranges reshape the trend axis (today→hours, week→days,
 * month→weeks, quarter/year→months) and scale magnitudes; advanced filters
 * apply a deterministic multiplier so the charts visibly respond to a
 * narrower slice. All pure functions — one source of truth for every number
 * the page renders. Magnitudes are illustrative mock values, not real data.
 */

/* ── Scaling ────────────────────────────────────────────────────── */

const RANGE_TOTAL_SCALE: Record<DateRangeKey, number> = {
  today: 0.04,
  week: 0.25,
  month: 1,
  quarter: 3,
  year: 12,
  custom: 1.5,
};

/** Deterministic per-filter multiplier so a narrower slice shrinks the data. */
function filterMultiplier(filters: ReportFilters): number {
  const active = [
    filters.department,
    filters.status,
    filters.medication,
    filters.labTest,
    filters.age,
    filters.gender,
  ].filter((value) => value !== 'all');

  const factor = active.reduce((product, value) => {
    const jitter = 0.35 + (hashString(value) % 50) / 100; // 0.35 – 0.84
    return product * jitter;
  }, 1);

  return Math.max(0.05, factor);
}

function round(value: number): number {
  return Math.round(value);
}

/* ── Trend axis (reshapes with the range) ───────────────────────── */

function resample(base: readonly number[], n: number): number[] {
  if (n === base.length) return [...base];
  const out: number[] = [];
  const lastIndex = base.length - 1;
  for (let i = 0; i < n; i += 1) {
    const t = n === 1 ? 0 : (i / (n - 1)) * lastIndex;
    const lo = Math.floor(t);
    const hi = Math.ceil(t);
    const frac = t - lo;
    const value = (base[lo] ?? 0) + ((base[hi] ?? 0) - (base[lo] ?? 0)) * frac;
    out.push(value);
  }
  return out;
}

function axisFor(range: DateRangeKey): readonly string[] {
  switch (range) {
    case 'today':
      return TIME_SLOTS;
    case 'week':
      return WEEKDAYS;
    case 'month':
      return ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    case 'quarter':
      return MONTHS.slice(9, 12);
    case 'year':
    case 'custom':
      return MONTHS;
  }
}

/** Per-bucket magnitude so daily buckets read smaller than monthly ones. */
const PER_BUCKET_SCALE: Record<DateRangeKey, number> = {
  today: 0.06,
  week: 0.28,
  month: 0.3,
  quarter: 1,
  year: 1,
  custom: 1,
};

function buildTrend(filters: ReportFilters, mult: number): readonly NamedSeries[] {
  const labels = axisFor(filters.range);
  const n = labels.length;
  const bucket = PER_BUCKET_SCALE[filters.range] * mult;

  const make = (
    name: NamedSeries['name'],
    base: readonly number[],
    tone: NamedSeries['tone'],
  ): NamedSeries => {
    const values = resample(base, n);
    return {
      name,
      tone,
      points: labels.map((label, i) => ({ label, value: round((values[i] ?? 0) * bucket) })),
    };
  };

  // Three unrelated business metrics plotted together — categorical. Revenue
  // was success-green, which read as "revenue is healthy" regardless of the
  // line's direction.
  return [
    make('Revenue (k)', BASE_REVENUE, 'chart1'),
    make('Patients', BASE_PATIENTS, 'chart2'),
    make('Appointments', BASE_APPOINTMENTS, 'chart3'),
  ];
}

/* ── Scaled helpers for the other charts ────────────────────────── */

function scalePoints(points: readonly SeriesPoint[], factor: number): readonly SeriesPoint[] {
  return points.map((point) => ({ ...point, value: round(point.value * factor) }));
}

function scaleSlices(slices: readonly Slice[], factor: number): readonly Slice[] {
  return slices.map((slice) => ({ ...slice, value: round(slice.value * factor) }));
}

function scaleKpis(kpis: readonly KpiDatum[], factor: number, mult: number): readonly KpiDatum[] {
  // Growth (percent) is a rate — it shouldn't scale with volume; others do.
  return kpis.map((kpi) => {
    if (kpi.format === 'percent') return kpi;
    return {
      ...kpi,
      value: round(kpi.value * factor),
      spark: kpi.spark.map((point) => round(point * factor * mult)),
    };
  });
}

/* ── Snapshot ───────────────────────────────────────────────────── */

export function buildSnapshot(filters: ReportFilters): AnalyticsSnapshot {
  const mult = filterMultiplier(filters);
  const total = RANGE_TOTAL_SCALE[filters.range] * mult;

  const heatCells = BASE_HEATMAP.map((row) => row.map((cell) => round(cell * total)));
  const heatMax = Math.max(1, ...heatCells.flat());

  return {
    kpis: scaleKpis(BASE_KPIS, total, mult),
    trend: buildTrend(filters, mult),
    weekday: { name: 'Appointments', tone: 'chart1', points: scalePoints(BASE_WEEKDAY, total) },
    departments: scaleSlices(BASE_DEPARTMENTS, total),
    labStatus: scaleSlices(BASE_LAB_STATUS, total),
    ageDistribution: { name: 'Patients', tone: 'chart1', points: scalePoints(BASE_AGE, total) },
    heatmap: { rows: WEEKDAYS, columns: TIME_SLOTS, cells: heatCells, max: heatMax },
    pharmacy: { name: 'Prescriptions', tone: 'chart2', points: scalePoints(BASE_PHARMACY, total) },
    messages: { name: 'Messages', tone: 'chart3', points: scalePoints(BASE_MESSAGES, total) },
    aiUsage: { name: 'AI actions', tone: 'chart4', points: scalePoints(BASE_AI, total) },
    records: { name: 'Records', tone: 'chart5', points: scalePoints(BASE_RECORDS, total) },
  };
}

/* ── Insights ───────────────────────────────────────────────────── */

function maxSlice(slices: readonly Slice[]): Slice | undefined {
  return slices.reduce<Slice | undefined>(
    (best, slice) => (best === undefined || slice.value > best.value ? slice : best),
    undefined,
  );
}

function maxPoint(points: readonly SeriesPoint[]): SeriesPoint | undefined {
  return points.reduce<SeriesPoint | undefined>(
    (best, point) => (best === undefined || point.value > best.value ? point : best),
    undefined,
  );
}

export function deriveInsights(snapshot: AnalyticsSnapshot): readonly Insight[] {
  const insights: Insight[] = [];

  const topDept = maxSlice(snapshot.departments);
  if (topDept) {
    insights.push({
      id: 'workload',
      kind: 'workload',
      title: 'Highest workload',
      detail: `${topDept.label} carries the most patients this period (${formatNumber(topDept.value)}).`,
      trend: 'up',
      tone: 'primary',
    });
  }

  const busiest = maxPoint(snapshot.weekday.points);
  if (busiest) {
    insights.push({
      id: 'busiest',
      kind: 'busiest',
      title: 'Busiest day',
      detail: `${busiest.label} is your peak day with ${formatNumber(busiest.value)} appointments.`,
      trend: 'flat',
      tone: 'info',
    });
  }

  const critical = snapshot.labStatus.find((slice) => slice.label === 'Critical');
  if (critical) {
    insights.push({
      id: 'critical',
      kind: 'critical',
      title: 'Critical patients',
      detail: `${formatNumber(critical.value)} lab results flagged critical — review promptly.`,
      trend: critical.value > 15 ? 'up' : 'flat',
      tone: 'error',
    });
  }

  const topDrug = maxPoint(snapshot.pharmacy.points);
  if (topDrug) {
    insights.push({
      id: 'pharmacy',
      kind: 'pharmacy',
      title: 'Prescription trends',
      detail: `${topDrug.label} lead prescriptions at ${formatNumber(topDrug.value)} orders.`,
      trend: 'up',
      tone: 'warning',
    });
  }

  const completed = snapshot.labStatus.find((slice) => slice.label === 'Completed')?.value ?? 0;
  const labTotal = snapshot.labStatus.reduce((sum, slice) => sum + slice.value, 0);
  if (labTotal > 0) {
    const rate = Math.round((completed / labTotal) * 100);
    insights.push({
      id: 'lab',
      kind: 'lab',
      title: 'Lab throughput',
      detail: `${String(rate)}% of lab orders were completed this period.`,
      trend: rate >= 70 ? 'up' : 'down',
      tone: 'success',
    });
  }

  const revenueKpi = snapshot.kpis.find((kpi) => kpi.id === 'revenue');
  if (revenueKpi) {
    insights.push({
      id: 'revenue',
      kind: 'revenue',
      title: 'Revenue momentum',
      detail: `Revenue is ${revenueKpi.deltaPercent >= 0 ? 'up' : 'down'} ${formatPercent(
        Math.abs(revenueKpi.deltaPercent),
      )} versus the previous period.`,
      trend: revenueKpi.deltaPercent >= 0 ? 'up' : 'down',
      tone: 'accent',
    });
  }

  return insights;
}

/* ── Formatters ─────────────────────────────────────────────────── */

export function formatNumber(value: number): string {
  return formatAppNumber(Math.round(value));
}

export function formatCurrency(value: number): string {
  if (value >= 1000) {
    return `$${formatAppNumber(value / 1000, {
      maximumFractionDigits: value >= 100_000 ? 0 : 1,
    })}k`;
  }
  return `$${formatNumber(value)}`;
}

export function formatPercent(value: number): string {
  return `${formatAppNumber(value, { maximumFractionDigits: 1 })}%`;
}

export function formatKpiValue(kpi: KpiDatum): string {
  switch (kpi.format) {
    case 'currency':
      return formatCurrency(kpi.value);
    case 'percent':
      return formatPercent(kpi.value);
    case 'number':
      return formatNumber(kpi.value);
  }
}
