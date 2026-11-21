import { DEPARTMENTS } from '../model/mock-data';
import type {
  AnalyticsResult,
  CreateSavedReportInput,
  RenameSavedReportInput,
  ReportsService,
  ScheduleInput,
} from '../model/reports-service';
import { buildSnapshot, deriveInsights } from '../model/selectors';
import { localId, readReports, writeReports } from '../model/store';
import type {
  ExportFormat,
  ReportFilters,
  ReportsDocument,
  SavedReport,
  ScheduleFrequency,
  ScheduledReport,
} from '../model/types';

/**
 * Mock reports service — Promise-based seams shaped like the future
 * analytics API. Analytics are derived deterministically from the filter
 * set; saved and scheduled reports persist per user through the store.
 * Export is simulated (no real file leaves the browser except the CSV the
 * page builds client-side). `userId` is threaded because the document is
 * namespaced per account.
 */

const LATENCY_MS = 260;

function delay(ms: number = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchAnalytics(filters: ReportFilters): Promise<AnalyticsResult> {
  await delay();
  const snapshot = buildSnapshot(filters);
  return { snapshot, insights: deriveInsights(snapshot), revenueAlternate: null };
}

async function fetchReportsDocument(userId: string): Promise<ReportsDocument> {
  await delay(180);
  return readReports(userId);
}

/* ── Saved reports ──────────────────────────────────────────────── */

function mutateSaved(
  userId: string,
  mutate: (saved: readonly SavedReport[]) => readonly SavedReport[],
): ReportsDocument {
  const current = readReports(userId);
  const next: ReportsDocument = { ...current, saved: mutate(current.saved) };
  writeReports(userId, next);
  return next;
}

async function createSavedReport(
  userId: string,
  input: CreateSavedReportInput,
): Promise<ReportsDocument> {
  await delay();
  const now = new Date().toISOString();
  const report: SavedReport = {
    id: localId('rep'),
    name: input.name,
    category: input.filters.category,
    range: input.filters.range,
    favorite: false,
    createdAt: now,
    lastViewedAt: now,
    filters: input.filters,
  };
  // Keep the list bounded to a small, demo-friendly size.
  return mutateSaved(userId, (saved) => [report, ...saved].slice(0, 12));
}

async function renameSavedReport(
  userId: string,
  input: RenameSavedReportInput,
): Promise<ReportsDocument> {
  await delay(160);
  return mutateSaved(userId, (saved) =>
    saved.map((report) => (report.id === input.id ? { ...report, name: input.name } : report)),
  );
}

async function duplicateSavedReport(userId: string, id: string): Promise<ReportsDocument> {
  await delay(160);
  return mutateSaved(userId, (saved) => {
    const source = saved.find((report) => report.id === id);
    if (!source) return saved;
    const now = new Date().toISOString();
    const copy: SavedReport = {
      ...source,
      id: localId('rep'),
      name: `${source.name} (copy)`,
      favorite: false,
      createdAt: now,
      lastViewedAt: now,
    };
    return [copy, ...saved].slice(0, 12);
  });
}

async function deleteSavedReport(userId: string, id: string): Promise<ReportsDocument> {
  await delay(160);
  return mutateSaved(userId, (saved) => saved.filter((report) => report.id !== id));
}

async function toggleFavorite(userId: string, id: string): Promise<ReportsDocument> {
  await delay(120);
  return mutateSaved(userId, (saved) =>
    saved.map((report) => (report.id === id ? { ...report, favorite: !report.favorite } : report)),
  );
}

async function touchSavedReport(userId: string, id: string): Promise<ReportsDocument> {
  await delay(80);
  return mutateSaved(userId, (saved) =>
    saved.map((report) =>
      report.id === id ? { ...report, lastViewedAt: new Date().toISOString() } : report,
    ),
  );
}

/* ── Scheduled reports ──────────────────────────────────────────── */

function mutateScheduled(
  userId: string,
  mutate: (scheduled: readonly ScheduledReport[]) => readonly ScheduledReport[],
): ReportsDocument {
  const current = readReports(userId);
  const next: ReportsDocument = { ...current, scheduled: mutate(current.scheduled) };
  writeReports(userId, next);
  return next;
}

const NEXT_RUN_OFFSET: Record<ScheduleFrequency, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
};

async function createSchedule(userId: string, input: ScheduleInput): Promise<ReportsDocument> {
  await delay();
  const schedule: ScheduledReport = {
    id: localId('sch'),
    name: input.name,
    category: input.category,
    frequency: input.frequency,
    format: input.format,
    recipients: input.recipients,
    status: 'active',
    nextRunAt: new Date(Date.now() + NEXT_RUN_OFFSET[input.frequency]).toISOString(),
    history: [],
  };
  return mutateScheduled(userId, (scheduled) => [schedule, ...scheduled].slice(0, 8));
}

async function toggleScheduleStatus(userId: string, id: string): Promise<ReportsDocument> {
  await delay(140);
  return mutateScheduled(userId, (scheduled) =>
    scheduled.map((schedule) =>
      schedule.id === id
        ? { ...schedule, status: schedule.status === 'active' ? 'paused' : 'active' }
        : schedule,
    ),
  );
}

async function deleteSchedule(userId: string, id: string): Promise<ReportsDocument> {
  await delay(160);
  return mutateScheduled(userId, (scheduled) => scheduled.filter((s) => s.id !== id));
}

/* ── Export (mock) ──────────────────────────────────────────────── */

async function runExport(format: ExportFormat): Promise<{ readonly format: ExportFormat }> {
  // Simulated generation latency; the CSV path builds a real client-side file
  // in the dialog. PDF/Excel/Print are mocked (no backend renderer).
  await delay(650);
  return { format };
}

/**
 * The mock adapter. Reached only through `features/doctor/reports/service.ts`
 * (`docs/handoff/auth-seam.md` §1, rule 3) — nothing downstream may import
 * this module, and `service.test.ts` asserts it over the source tree because
 * a type alone does not keep a seam closed.
 */
export const mockReportsService: ReportsService = {
  fetchAnalytics,
  fetchReportsDocument,
  createSavedReport,
  renameSavedReport,
  duplicateSavedReport,
  deleteSavedReport,
  toggleFavorite,
  touchSavedReport,
  createSchedule,
  toggleScheduleStatus,
  deleteSchedule,
  runExport,
  capabilities: {
    advancedFilters: ['department', 'status', 'medication', 'labTest', 'age', 'gender'],
    departmentOptions: DEPARTMENTS,
    renameSaved: true,
    favorites: true,
    scheduleDelivery: true,
    illustrative: true,
  },
};
