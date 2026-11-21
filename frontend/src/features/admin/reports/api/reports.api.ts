/**
 * Admin Reports — mock service (ADM-08 · UX §3.8).
 *
 * Like ADM-07's, this service **derives rather than stores**. Every figure on
 * `/admin/reports` is computed from documents ADM-02, ADM-04, ADM-05, ADM-07
 * and ADM-01 already hold, so a doctor verified on the Doctors page moves the
 * activation rate here on the next read, and the no-show rate on this page and
 * the no-show rows on appointment oversight are the same appointments counted
 * once. There is no report corpus anywhere; there is nothing here to seed and
 * nothing to fall out of step.
 *
 * Two things *are* stored, and both are the administrator's own settings
 * rather than platform data: the scheduled-report list, in `localStorage`, and
 * nothing else.
 *
 * ## Exports log themselves
 *
 * Both export paths call `logsApi.recordExport()` **before** writing the file,
 * the ordering ADM-06B and ADM-10 already use — an extraction that failed to
 * log is an extraction that did not happen. §3.7 requires exports to appear in
 * the log they came from, and a leadership deck of platform analytics is
 * exactly the extraction a reviewer wants to see there.
 *
 * ## What this service does NOT do
 *
 * It does not run schedules. Nothing in a browser can deliver an email on a
 * recurrence, so `nextRunAt` is computed and stored and no delivery is ever
 * attempted from here. `lastRun` therefore reports what a server told us, and
 * the seeded failure below exists to make §3.8's "scheduled-report failures
 * notify the admin" a reachable, visible state rather than dead UI.
 */

import type { ExportDataset } from '@/utils/export';
import { exportCsv, exportPdf } from '@/utils/export';

import { administrationApi } from '../../api/administration.api';
import { oversightApi } from '../../appointments/api/oversight.api';
import { doctorsApi } from '../../doctors/api/doctors.api';
import { logsApi } from '../../logs/api/logs.api';
import { EMPTY_FILTERS as EMPTY_LOG_FILTERS } from '../../logs/logs';
import type { LogEvent } from '../../logs/logs.types';
import { overviewApi } from '../../overview/api/overview.api';
import { patientsApi } from '../../patients/api/patients.api';
import {
  RANGE_LABEL,
  REPORT_LABEL,
  buildReport,
  datasetOf,
  exportSlug,
  nextRunAfter,
  previousRange,
  resolveRange,
  withComparisons,
  type ReportSources,
} from '../reports';
import type {
  RangeKey,
  ReportDocument,
  ReportId,
  ScheduleDraft,
  ScheduledReport,
  WidgetDataset,
} from '../reports.types';

const LATENCY_MS = 260;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/**
 * How much of the system log the performance tab reads.
 *
 * The log is paginated by design (ADM-07), and this is a page request like any
 * other rather than a private door into the whole corpus — which is what a
 * real client would have to do, and what keeps this service honest about the
 * fact that a server would cap it. The seeded system corpus is far smaller
 * than this, so nothing on the tab is currently truncated.
 */
const LOG_WINDOW = 500;

/* ── Source assembly ──────────────────────────────────────────── */

/**
 * One pass over every store a report reads, in parallel and each exactly once.
 *
 * Assembled together rather than per widget so every figure on a tab describes
 * the same instant: `now` is captured here and threaded through the pure
 * module, which is the same discipline ADM-05's section uses for its "one
 * clock per render".
 */
async function collectSources(): Promise<ReportSources> {
  const [doctors, patients, oversight, logPage, signals, platform] = await Promise.all([
    doctorsApi.list(),
    patientsApi.list(),
    oversightApi.list(),
    logsApi.list({
      filters: EMPTY_LOG_FILTERS,
      sort: 'newest',
      offset: 0,
      limit: LOG_WINDOW,
    }),
    // The range argument only picks the activity series' length, which this
    // page does not read — it wants `services`, which is range-free.
    overviewApi.signals('30d'),
    administrationApi.getPlatformStatus(),
  ]);

  return {
    doctors: doctors.doctors,
    patients: patients.patients,
    appointments: oversight.appointments,
    platformDoctors: oversight.doctors,
    logEvents: logPage.rows satisfies readonly LogEvent[],
    services: signals.services,
    system: platform.system,
    now: Date.now(),
  };
}

/* ── Scheduled reports ────────────────────────────────────────── */

const SCHEDULES_KEY = 'medora.admin.reports.schedules.v1';

const DAY_MS = 86_400_000;

/**
 * The two shipped schedules — one healthy, one failed.
 *
 * The failed one is deliberate and is the only invented fact in this file: it
 * makes §3.8's "scheduled-report failures notify the admin" a state a reader
 * can actually see, on a page where nothing else can produce one because
 * nothing here delivers email. Its detail names a plausible cause rather than
 * "error", so the row is something an administrator can act on.
 */
function seedSchedules(now: number): readonly ScheduledReport[] {
  return [
    {
      id: 'sched-weekly-growth',
      reportId: 'growth',
      name: 'Weekly growth summary',
      frequency: 'weekly',
      range: '30d',
      recipients: ['leadership@medora.health'],
      format: 'pdf',
      createdBy: 'Platform',
      createdAt: new Date(now - 30 * DAY_MS).toISOString(),
      paused: false,
      lastRun: {
        at: new Date(now - 2 * DAY_MS).toISOString(),
        status: 'delivered',
        detail: 'Delivered to 1 recipient.',
      },
      nextRunAt: nextRunAfter('weekly', now),
    },
    {
      id: 'sched-monthly-utilization',
      reportId: 'utilization',
      name: 'Monthly utilization review',
      frequency: 'monthly',
      range: '90d',
      recipients: ['operations@medora.health', 'clinic-leads@medora.health'],
      format: 'csv',
      createdBy: 'Platform',
      createdAt: new Date(now - 90 * DAY_MS).toISOString(),
      paused: false,
      lastRun: {
        at: new Date(now - 5 * DAY_MS).toISOString(),
        status: 'failed',
        detail: 'The mail provider rejected the attachment — the deck exceeded the 10 MB limit.',
      },
      nextRunAt: nextRunAfter('monthly', now),
    },
  ];
}

function persist(schedules: readonly ScheduledReport[]): readonly ScheduledReport[] {
  try {
    window.localStorage.setItem(SCHEDULES_KEY, JSON.stringify(schedules));
  } catch {
    // Storage unavailable — schedules stay session-local, like ADM-07's views.
  }
  return schedules;
}

function load(): readonly ScheduledReport[] {
  try {
    const raw = window.localStorage.getItem(SCHEDULES_KEY);
    // Seeded on first read rather than on first write, so clearing storage
    // brings the two shipped schedules back instead of an empty panel.
    if (raw === null) return persist(seedSchedules(Date.now()));
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return persist(seedSchedules(Date.now()));
    return parsed as readonly ScheduledReport[];
  } catch {
    return seedSchedules(Date.now());
  }
}

function nextScheduleId(existing: readonly ScheduledReport[]): string {
  const used = new Set(existing.map((schedule) => schedule.id));
  let n = existing.length + 1;
  while (used.has(`sched-${n.toString()}`)) n += 1;
  return `sched-${n.toString()}`;
}

/* ── Export datasets ──────────────────────────────────────────── */

/**
 * One widget's table as a downloadable file.
 *
 * The dataset is passed in rather than recomputed here, and that is the point:
 * the caller hands over exactly the `datasetOf(widget.visual)` the table on
 * screen was drawn from, so "export this widget" cannot produce a file the
 * reader was not looking at.
 */
function widgetFile(
  reportId: ReportId,
  title: string,
  dataset: WidgetDataset,
  rangeKey: RangeKey,
): ExportDataset {
  return {
    filename: `medora-${exportSlug(REPORT_LABEL[reportId])}-${exportSlug(title)}`,
    title: `${REPORT_LABEL[reportId]} · ${title} · ${RANGE_LABEL[rangeKey]}`,
    columns: dataset.columns,
    rows: dataset.rows,
  };
}

/**
 * Every widget on a tab, one after another, as a single printable document.
 *
 * §3.8 calls it a "PDF deck". The shared exporter writes a flat table per
 * dataset, so the deck is the widgets concatenated with their titles as
 * separator rows and a normalised column count — a widget with three columns
 * and one with six cannot share a header, and padding to the widest is what
 * keeps the rows aligned in the file. Widgets with no source appear as a
 * titled row stating why, so the deck says the same thing the screen does.
 */
function deckFile(document: ReportDocument): ExportDataset {
  const sections = document.widgets.map((entry) => {
    if (entry.visual === null) {
      return { title: entry.title, dataset: { columns: ['Status'], rows: [[entry.note ?? '—']] } };
    }
    return { title: entry.title, dataset: datasetOf(entry.visual) };
  });

  const width = Math.max(1, ...sections.map((section) => section.dataset.columns.length));
  const pad = (row: readonly (string | number)[]): readonly (string | number)[] => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ''),
  ];

  const rows: (readonly (string | number)[])[] = [];
  for (const section of sections) {
    rows.push(pad([section.title]));
    rows.push(pad(section.dataset.columns));
    for (const row of section.dataset.rows) rows.push(pad(row));
    rows.push(pad([]));
  }

  return {
    filename: `medora-${exportSlug(REPORT_LABEL[document.id])}-report`,
    title: `${REPORT_LABEL[document.id]} · ${RANGE_LABEL[document.range.key]}`,
    columns: Array.from({ length: width }, (_, index) =>
      index === 0 ? 'Report' : ' '.repeat(index),
    ),
    rows,
  };
}

/* ── Service ──────────────────────────────────────────────────── */

export interface ReportRequest {
  readonly reportId: ReportId;
  readonly range: RangeKey;
  readonly compare: boolean;
}

export const reportsApi = {
  /**
   * One report tab, optionally with the previous window folded in as deltas.
   *
   * The comparison is a second `buildReport` over `previousRange`, not a
   * separate set of formulas — so a widget's "vs previous" is definitionally
   * the same computation, and a change to a derivation moves both halves at
   * once. It costs one extra pass over sources already in memory.
   */
  document: async ({ reportId, range, compare }: ReportRequest): Promise<ReportDocument> => {
    const sources = await collectSources();
    const resolved = resolveRange(range, sources.now);
    const current = buildReport(reportId, sources, resolved);

    if (!compare) return delay(current);

    const before = buildReport(reportId, sources, previousRange(resolved));
    return delay(withComparisons(current, before));
  },

  schedules: (): Promise<readonly ScheduledReport[]> => delay(load()),

  createSchedule: (draft: ScheduleDraft, actor: string): Promise<readonly ScheduledReport[]> => {
    const current = load();
    const now = Date.now();
    const schedule: ScheduledReport = {
      id: nextScheduleId(current),
      reportId: draft.reportId,
      name: draft.name.trim(),
      frequency: draft.frequency,
      range: draft.range,
      recipients: draft.recipients,
      format: draft.format,
      createdBy: actor,
      createdAt: new Date(now).toISOString(),
      paused: false,
      // Never `{ status: 'delivered' }` on creation: a schedule that has not
      // run yet has no outcome, and seeding one would put a delivery in the
      // panel that never happened.
      lastRun: null,
      nextRunAt: nextRunAfter(draft.frequency, now),
    };
    return delay(persist([...current, schedule]));
  },

  setSchedulePaused: (id: string, paused: boolean): Promise<readonly ScheduledReport[]> =>
    delay(
      persist(
        load().map((schedule) =>
          schedule.id === id
            ? {
                ...schedule,
                paused,
                // Resuming recomputes the next run rather than keeping a date
                // that has since passed, which would render as overdue forever.
                nextRunAt: paused
                  ? schedule.nextRunAt
                  : nextRunAfter(schedule.frequency, Date.now()),
              }
            : schedule,
        ),
      ),
    ),

  deleteSchedule: (id: string): Promise<readonly ScheduledReport[]> =>
    delay(persist(load().filter((schedule) => schedule.id !== id))),

  /** One widget's table as CSV, logged before the file is written. */
  exportWidget: (input: {
    readonly reportId: ReportId;
    readonly range: RangeKey;
    readonly title: string;
    readonly dataset: WidgetDataset;
    readonly actor: string;
  }): Promise<number> => {
    const file = widgetFile(input.reportId, input.title, input.dataset, input.range);
    logsApi.recordExport({
      target: `${file.filename}.csv`,
      summary: `Exported the “${input.title}” widget from the ${REPORT_LABEL[input.reportId]} report (${RANGE_LABEL[input.range]}) as CSV — ${input.dataset.rows.length.toString()} rows`,
      actor: input.actor,
      payload: {
        format: 'csv',
        report: input.reportId,
        widget: input.title,
        range: input.range,
        rowCount: input.dataset.rows.length,
      },
    });
    exportCsv(file);
    return delay(input.dataset.rows.length);
  },

  /**
   * The whole tab as a PDF deck, logged before the file is written.
   *
   * Rebuilt from source rather than taking the rendered document as an
   * argument: the deck is a leadership artifact that outlives the tab it came
   * from, and exporting a document the page happened to be holding — possibly
   * a stale one, possibly one whose comparison was toggled mid-render — is how
   * a file ends up disagreeing with the screen it was taken from.
   */
  exportDeck: async (input: {
    readonly reportId: ReportId;
    readonly range: RangeKey;
    readonly compare: boolean;
    readonly actor: string;
  }): Promise<number> => {
    const document = await reportsApi.document(input);
    const file = deckFile(document);
    const widgetCount = document.widgets.filter((entry) => entry.visual !== null).length;

    logsApi.recordExport({
      target: `${file.filename}.pdf`,
      summary: `Exported the ${REPORT_LABEL[input.reportId]} report (${RANGE_LABEL[input.range]}) as a PDF deck — ${widgetCount.toString()} widgets`,
      actor: input.actor,
      payload: {
        format: 'pdf',
        report: input.reportId,
        range: input.range,
        compare: input.compare,
        widgetCount,
      },
    });
    exportPdf(file);
    return widgetCount;
  },
} as const;
