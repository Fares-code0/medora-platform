import {
  Activity,
  Calendar,
  DollarSign,
  FlaskConical,
  Pill,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { apiClient } from '@/api/client';
import {
  asRecord,
  malformedResponse,
  notConnected,
  readArray,
  readData,
  readEnum,
  readNumber,
  readOptionalString,
  readString,
} from '@/api/http';
import type { AnalyticsTone, SemanticTone } from '@/components/charts';

import type { AnalyticsResult, RevenueAlternate, ReportsService } from '../model/reports-service';
import {
  DEFAULT_FILTERS,
  type AgeBand,
  type AnalyticsSnapshot,
  type DateRangeKey,
  type ExportFormat,
  type Gender,
  type HeatmapData,
  type Insight,
  type InsightKind,
  type KpiDatum,
  type NamedSeries,
  type ReportCategory,
  type ReportFilters,
  type ReportsDocument,
  type SavedReport,
  type ScheduledReport,
  type SeriesPoint,
  type Slice,
} from '../model/types';

/**
 * Reports over HTTP — RM M21's `/reports/*` routes (API §12.1–§12.4).
 *
 * | Method                | Route                                              |
 * | --------------------- | -------------------------------------------------- |
 * | fetchAnalytics        | `GET /reports/analytics` + `GET /reports/insights` |
 * | fetchReportsDocument  | `GET /reports/saved` + `GET /reports/scheduled`    |
 * | createSavedReport     | `POST /reports/saved`                              |
 * | duplicateSavedReport  | `POST /reports/saved` (a copy is a new report)     |
 * | deleteSavedReport     | `DELETE /reports/saved/{id}`                       |
 * | createSchedule        | `POST /reports/scheduled`                          |
 * | toggleScheduleStatus  | `PATCH /reports/scheduled/{id}` `{ status }`       |
 * | deleteSchedule        | `DELETE /reports/scheduled/{id}`                   |
 *
 * **Served only by an API built from `backend`.** Against one built from
 * `main` the analytics answer 404 — no `/reports/analytics` there is the M17
 * revenue alternate alone, and no other report route exists — and the page
 * shows its error state, as every other backend-only route in this client
 * does.
 *
 * **Scope is the server's.** Every figure is keyed on the caller's own
 * `doctors` row and every document on their own `owner_id`; nothing here
 * sends a user or doctor id, and `userId` is ignored, as the port says it
 * will be.
 *
 * **What the server does not do, and the port says so (`capabilities`).**
 * No rename and no favourite route; no "last viewed" write (opening a saved
 * report re-reads the list instead); department, status, medication and lab
 * test are not analytics parameters (M21.1 takes gender and age band); and
 * the scheduled-report executor is registered blocked (M30.2), so a schedule
 * is stored and never sent. Export stays the client's engine over the
 * snapshot the page shows, for every format — the server's own CSV route is
 * the same snapshot, and its PDF and Excel answer 501.
 */

const CATEGORIES: readonly ReportCategory[] = [
  'overview',
  'revenue',
  'patients',
  'appointments',
  'laboratory',
  'records',
  'pharmacy',
  'messages',
  'ai',
];
const RANGES: readonly DateRangeKey[] = ['today', 'week', 'month', 'quarter', 'year', 'custom'];
const AGE_BANDS: readonly AgeBand[] = ['all', '0-17', '18-39', '40-64', '65+'];
const GENDERS: readonly Gender[] = ['all', 'female', 'male'];
const SEMANTIC_TONES: readonly SemanticTone[] = [
  'primary',
  'secondary',
  'accent',
  'success',
  'warning',
  'info',
  'error',
];
const TONES: readonly AnalyticsTone[] = [
  ...SEMANTIC_TONES,
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
];
const INSIGHT_KINDS: readonly InsightKind[] = [
  'workload',
  'busiest',
  'critical',
  'pharmacy',
  'lab',
  'revenue',
  'ai',
];
const TRENDS = ['up', 'down', 'flat'] as const;
const KPI_FORMATS = ['number', 'currency', 'percent'] as const;
const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
const FORMATS: readonly ExportFormat[] = ['csv', 'excel', 'pdf', 'print'];
const SCHEDULE_STATUSES = ['active', 'paused'] as const;
const RUN_STATUSES = ['sent', 'failed'] as const;

/**
 * A KPI's icon is presentation, so the server leaves it out (`KpiView`:
 * "`icon` is deliberately absent"); the id is the stable key.
 */
const KPI_ICONS: Readonly<Record<string, LucideIcon>> = {
  revenue: DollarSign,
  patients: Users,
  appointments: Calendar,
  'lab-orders': FlaskConical,
  prescriptions: Pill,
  growth: TrendingUp,
};

/* ── Reading ─────────────────────────────────────────────────────── */

function toPoint(value: unknown, what: string): SeriesPoint {
  const dto = asRecord(value, what);
  return { label: readString(dto, 'label', what), value: readNumber(dto, 'value', what) };
}

function toSeries(value: unknown, what: string): NamedSeries {
  const dto = asRecord(value, what);
  return {
    name: readString(dto, 'name', what),
    tone: readEnum(dto, 'tone', TONES, what),
    points: readArray(dto, 'points', what).map((point) => toPoint(point, what)),
  };
}

function toSlice(value: unknown, what: string): Slice {
  const dto = asRecord(value, what);
  return {
    label: readString(dto, 'label', what),
    value: readNumber(dto, 'value', what),
    tone: readEnum(dto, 'tone', TONES, what),
  };
}

function numbers(value: unknown, what: string): readonly number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'number')) {
    throw malformedResponse(what);
  }
  return value as readonly number[];
}

function strings(value: unknown, what: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw malformedResponse(what);
  }
  return value as readonly string[];
}

function toHeatmap(value: unknown): HeatmapData {
  const what = 'analytics.heatmap';
  const dto = asRecord(value, what);
  return {
    rows: strings(dto.rows, what),
    columns: strings(dto.columns, what),
    cells: readArray(dto, 'cells', what).map((row) => numbers(row, what)),
    max: readNumber(dto, 'max', what),
  };
}

function toKpi(value: unknown): KpiDatum {
  const what = 'analytics.kpi';
  const dto = asRecord(value, what);
  const id = readString(dto, 'id', what);
  return {
    id,
    label: readString(dto, 'label', what),
    value: readNumber(dto, 'value', what),
    format: readEnum(dto, 'format', KPI_FORMATS, what),
    deltaPercent: readNumber(dto, 'deltaPercent', what),
    tone: readEnum(dto, 'tone', SEMANTIC_TONES, what),
    icon: KPI_ICONS[id] ?? Activity,
    spark: numbers(dto.spark, what),
  };
}

function toSnapshot(dto: Record<string, unknown>): AnalyticsSnapshot {
  const what = 'analytics';
  return {
    kpis: readArray(dto, 'kpis', what).map(toKpi),
    trend: readArray(dto, 'trend', what).map((series) => toSeries(series, `${what}.trend`)),
    weekday: toSeries(dto.weekday, `${what}.weekday`),
    departments: readArray(dto, 'departments', what).map((slice) =>
      toSlice(slice, `${what}.departments`),
    ),
    labStatus: readArray(dto, 'labStatus', what).map((slice) =>
      toSlice(slice, `${what}.labStatus`),
    ),
    ageDistribution: toSeries(dto.ageDistribution, `${what}.ageDistribution`),
    heatmap: toHeatmap(dto.heatmap),
    pharmacy: toSeries(dto.pharmacy, `${what}.pharmacy`),
    messages: toSeries(dto.messages, `${what}.messages`),
    aiUsage: toSeries(dto.aiUsage, `${what}.aiUsage`),
    records: toSeries(dto.records, `${what}.records`),
  };
}

/** Every member present and empty: what the server sends for a chart a category did not ask for. */
const EMPTY_SNAPSHOT: AnalyticsSnapshot = {
  kpis: [],
  trend: [],
  weekday: { name: 'Appointments', tone: 'primary', points: [] },
  departments: [],
  labStatus: [],
  ageDistribution: { name: 'Patients', tone: 'info', points: [] },
  heatmap: { rows: [], columns: [], cells: [], max: 0 },
  pharmacy: { name: 'Prescriptions', tone: 'warning', points: [] },
  messages: { name: 'Messages', tone: 'info', points: [] },
  aiUsage: { name: 'AI threads', tone: 'accent', points: [] },
  records: { name: 'Records', tone: 'secondary', points: [] },
};

function toRevenueAlternate(dto: Record<string, unknown>): RevenueAlternate {
  const what = 'analytics.revenueAlternate';
  return {
    notice: readString(dto, 'notice', what),
    topVisitTypes: readArray(dto, 'topVisitTypes', what).map((point) => toPoint(point, what)),
  };
}

function toInsight(value: unknown): Insight {
  const what = 'insight';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    kind: readEnum(dto, 'kind', INSIGHT_KINDS, what),
    title: readString(dto, 'title', what),
    detail: readString(dto, 'detail', what),
    trend: dto.trend === null ? null : readEnum(dto, 'trend', TRENDS, what),
    tone: readEnum(dto, 'tone', SEMANTIC_TONES, what),
  };
}

function toFilters(value: unknown): ReportFilters {
  const what = 'savedReport.filters';
  const dto = asRecord(value, what);
  const text = (key: keyof ReportFilters) =>
    readOptionalString(dto, key, what) ?? String(DEFAULT_FILTERS[key] ?? 'all');
  return {
    category: readEnum(dto, 'category', CATEGORIES, what),
    range: readEnum(dto, 'range', RANGES, what),
    customFrom: readOptionalString(dto, 'customFrom', what),
    customTo: readOptionalString(dto, 'customTo', what),
    department: text('department'),
    status: text('status'),
    medication: text('medication'),
    labTest: text('labTest'),
    age: readEnum(dto, 'age', AGE_BANDS, what),
    gender: readEnum(dto, 'gender', GENDERS, what),
  };
}

function toSaved(value: unknown): SavedReport {
  const what = 'savedReport';
  const dto = asRecord(value, what);
  const createdAt = readString(dto, 'createdAt', what);
  if (typeof dto.favorite !== 'boolean') throw malformedResponse(what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    category: readEnum(dto, 'category', CATEGORIES, what),
    range: readEnum(dto, 'range', RANGES, what),
    favorite: dto.favorite,
    createdAt,
    // Never opened since it was saved: saving it was the last view.
    lastViewedAt: readOptionalString(dto, 'lastViewedAt', what) ?? createdAt,
    filters: toFilters(dto.filters),
  };
}

function toScheduled(value: unknown): ScheduledReport {
  const what = 'scheduledReport';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    category: readEnum(dto, 'category', CATEGORIES, what),
    frequency: readEnum(dto, 'frequency', FREQUENCIES, what),
    format: readEnum(dto, 'format', FORMATS, what),
    recipients: strings(dto.recipients, `${what}.recipients`),
    status: readEnum(dto, 'status', SCHEDULE_STATUSES, what),
    nextRunAt: readString(dto, 'nextRunAt', what),
    history: readArray(dto, 'history', what).map((run) => {
      const row = asRecord(run, `${what}.run`);
      return {
        id: readString(row, 'id', what),
        at: readString(row, 'at', what),
        status: readEnum(row, 'status', RUN_STATUSES, what),
      };
    }),
  };
}

function list(body: unknown, what: string): readonly unknown[] {
  const data = readData(body, what);
  if (!Array.isArray(data)) throw malformedResponse(what);
  return data as readonly unknown[];
}

/* ── Requests ────────────────────────────────────────────────────── */

/**
 * The analytics query. Only what the server applies is sent: department,
 * status, medication and lab test are not parameters (and the screens do
 * not offer them over this adapter). A custom range sends its bounds; the
 * server refuses one without both (422), which the page shows as an error.
 */
function analyticsQuery(filters: ReportFilters): Record<string, unknown> {
  return {
    category: filters.category,
    range: filters.range,
    ...(filters.range === 'custom'
      ? { from: filters.customFrom ?? undefined, to: filters.customTo ?? undefined }
      : {}),
    gender: filters.gender,
    ageBand: filters.age,
  };
}

async function fetchReportsDocument(): Promise<ReportsDocument> {
  const [saved, scheduled] = await Promise.all([
    apiClient.get('/reports/saved'),
    apiClient.get('/reports/scheduled'),
  ]);
  return {
    saved: list(saved, 'saved reports').map(toSaved),
    scheduled: list(scheduled, 'scheduled reports').map(toScheduled),
  };
}

function savedBody(name: string, filters: ReportFilters) {
  return {
    name,
    category: filters.category,
    range: filters.range,
    favorite: false,
    filters,
  };
}

export const httpReportsService: ReportsService = {
  async fetchAnalytics(filters): Promise<AnalyticsResult> {
    const query = analyticsQuery(filters);
    // Insights read the period only (`InsightService` takes no category or
    // demographic), so only the period is sent.
    const insightQuery = { range: query.range, from: query.from, to: query.to };
    const [snapshotBody, insightsBody] = await Promise.all([
      apiClient.get('/reports/analytics', query),
      apiClient.get('/reports/insights', insightQuery),
    ]);
    const dto = asRecord(readData(snapshotBody, 'analytics'), 'analytics');
    const insights = list(insightsBody, 'insights').map(toInsight);

    // Revenue with billing off is a different, self-describing document
    // (`alternate: 'top-visit-types'`), never a snapshot of zeros.
    if (dto.alternate === 'top-visit-types') {
      return { snapshot: EMPTY_SNAPSHOT, insights, revenueAlternate: toRevenueAlternate(dto) };
    }
    return { snapshot: toSnapshot(dto), insights, revenueAlternate: null };
  },

  fetchReportsDocument,

  async createSavedReport(_userId, { name, filters }) {
    await apiClient.post('/reports/saved', savedBody(name, filters));
    return fetchReportsDocument();
  },

  renameSavedReport() {
    // Not offered (`capabilities.renameSaved`): no route renames a report.
    return Promise.reject(notConnected('Renaming a saved report'));
  },

  async duplicateSavedReport(_userId, id) {
    const source = (await fetchReportsDocument()).saved.find((report) => report.id === id);
    if (source === undefined) throw malformedResponse('saved report to duplicate');
    await apiClient.post('/reports/saved', savedBody(`${source.name} (copy)`, source.filters));
    return fetchReportsDocument();
  },

  async deleteSavedReport(_userId, id) {
    await apiClient.delete(`/reports/saved/${encodeURIComponent(id)}`);
    return fetchReportsDocument();
  },

  toggleFavorite() {
    // Not offered (`capabilities.favorites`): no route stars a report.
    return Promise.reject(notConnected('Favourite reports'));
  },

  // No route records a view; the list is re-read so the rail is current.
  touchSavedReport: () => fetchReportsDocument(),

  async createSchedule(_userId, input) {
    await apiClient.post('/reports/scheduled', {
      name: input.name,
      category: input.category,
      frequency: input.frequency,
      format: input.format,
      recipients: input.recipients,
    });
    return fetchReportsDocument();
  },

  async toggleScheduleStatus(_userId, id) {
    // The route sets a status rather than flipping one, so read the
    // current one first: a double click must not pause and resume.
    const current = (await fetchReportsDocument()).scheduled.find((report) => report.id === id);
    if (current === undefined) throw malformedResponse('scheduled report to toggle');
    await apiClient.patch(`/reports/scheduled/${encodeURIComponent(id)}`, {
      status: current.status === 'active' ? 'paused' : 'active',
    });
    return fetchReportsDocument();
  },

  async deleteSchedule(_userId, id) {
    await apiClient.delete(`/reports/scheduled/${encodeURIComponent(id)}`);
    return fetchReportsDocument();
  },

  // The file is built by the dialog from the snapshot on screen; there is
  // nothing for the server to generate first (see the header).
  runExport: (format) => Promise.resolve({ format }),

  capabilities: {
    advancedFilters: ['age', 'gender'],
    departmentOptions: [],
    renameSaved: false,
    favorites: false,
    scheduleDelivery: false,
    illustrative: false,
  },
};
