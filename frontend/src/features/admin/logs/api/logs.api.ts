/**
 * System Logs — mock service (ADM-07 · UX §3.7).
 *
 * This service *aggregates* rather than stores. Its rows come from the trails
 * ADM-02, ADM-04, ADM-05, ADM-06B and ADM-10 already keep, so a suspension
 * performed on the Doctors page — or a gated conversation read on the
 * Communications page — is in the log the moment it happens, which is what
 * makes this an investigation tool instead of a fixture. Only the System
 * category is seeded, because nothing in a frontend can observe a service
 * degrading.
 *
 * There is no operation here that changes an event. §3.7 makes logs read-only
 * for everyone including administrators, and a service with no mutation is a
 * stronger guarantee than a UI with no button. The only writes are saved views
 * and the export record — and the export writes an event *about itself*.
 *
 * **Every source is read raw, exactly once.** `administrationApi
 * .getAuditEvents()` is deliberately not called: it already folds the PHI
 * access log into the audit feed on read, so aggregating from it *and* from
 * `phiAccess.list()` would put every reveal in the log twice, under two
 * unrelated ids (`phi:…` and `legacy:aud-phi-…`) that dedupe-by-id cannot
 * pair. The seeded `auditEvents` array is imported instead, and the PHI log is
 * taken from `phiAccess.list()` on its own.
 *
 * The dependency runs one way: this module imports `administration.api`, and
 * `logs.ts` imports neither. That is what lets `administrationApi
 * .getAuditEvents()` *be* a projection of the log's taxonomy — it classifies
 * through `fromLegacyAudit` and narrows through `projectAuditFeed`, both from
 * the pure module — rather than a second store the log could disagree with.
 */

import type { ExportDataset } from '@/utils/export';
import { exportCsv, exportJson } from '@/utils/export';

import { administrationApi, auditEvents } from '../../api/administration.api';
import { oversightApi } from '../../appointments/api/oversight.api';
import { communicationsApi } from '../../communications/communications.api';
import { doctorsApi } from '../../doctors/api/doctors.api';
import { patientsApi } from '../../patients/api/patients.api';
import {
  CATEGORY_LABEL,
  EMPTY_FILTERS,
  EVENT_TYPE_LABEL,
  SEVERITY_LABEL,
  TYPE_CATEGORY,
  activeFilterCount,
  filterEvents,
  formatTimestamp,
  fromAppointmentEvents,
  fromContentAccess,
  fromDoctorAudit,
  fromDoctorLogins,
  fromLegacyAudit,
  fromPatientEvents,
  fromPhiAccess,
  toDateTimeLocalValue,
} from '../logs';
import type {
  LogEvent,
  LogEventType,
  LogFilters,
  LogListRequest,
  LogPage,
  LogSeverity,
  SavedView,
} from '../logs.types';

const LATENCY_MS = 260;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/* ── Seeded System corpus ─────────────────────────────────────── */

const DAY_MS = 86_400_000;
const SEED_SPAN_DAYS = 21;
/** Rounds of the three shapes below — 24 System events in all. */
const SEED_ROUNDS = 8;

/**
 * The corpus is pinned to module load and derived from its own index. No
 * `Math.random()` anywhere: a log whose rows move between renders is not a
 * log, and the table pages through this corpus expecting page 3 to still be
 * page 3 on the way back.
 */
const SEED_ANCHOR_MS = Date.now();

interface SystemShape {
  readonly type: LogEventType;
  readonly severity: LogSeverity;
  readonly target: string;
  readonly summary: (round: number) => string;
  readonly payload: (round: number) => Readonly<Record<string, string | number | boolean>>;
}

const SYSTEM_SHAPES: readonly SystemShape[] = [
  {
    type: 'service-degraded',
    severity: 'warning',
    target: 'svc-scheduling',
    summary: (round) =>
      `Scheduling API p95 latency ${String(760 + round * 37)} ms across a 5-minute window`,
    payload: (round) => ({
      service: 'scheduling',
      p95Ms: 760 + round * 37,
      windowMinutes: 5,
      recovered: round % 2 === 0,
    }),
  },
  {
    type: 'integration-failed',
    severity: 'critical',
    target: 'int-lab-bridge',
    summary: (round) =>
      `Laboratory bridge rejected a results batch — ${String(3 + round)} messages held`,
    payload: (round) => ({
      integration: 'lab-bridge',
      httpStatus: 502,
      messagesHeld: 3 + round,
    }),
  },
  {
    type: 'job-completed',
    severity: 'info',
    target: 'job-search-index',
    summary: (round) => `Nightly search-index rebuild finished in ${String(180 + round * 11)} s`,
    payload: (round) => ({
      job: 'search-index-rebuild',
      durationSeconds: 180 + round * 11,
      documents: 41_200 + round * 130,
    }),
  },
];

const SEED_COUNT = SEED_ROUNDS * SYSTEM_SHAPES.length;
const SEED_STEP_MS = (SEED_SPAN_DAYS * DAY_MS) / SEED_COUNT;

/**
 * Evenly spaced backwards from the anchor, with an index-derived sub-second
 * offset so no two seeded rows share a millisecond — §3.7 renders timestamps
 * to milliseconds, and identical instants would make the sort order arbitrary.
 */
function seededAt(index: number): string {
  return new Date(SEED_ANCHOR_MS - index * SEED_STEP_MS - ((index * 373) % 1000)).toISOString();
}

const SYSTEM_LOG: readonly LogEvent[] = SYSTEM_SHAPES.flatMap((shape, shapeIndex) =>
  Array.from({ length: SEED_ROUNDS }, (_, round) => {
    const index = round * SYSTEM_SHAPES.length + shapeIndex;
    return {
      id: `system:${shape.type}:${String(round)}`,
      at: seededAt(index),
      category: TYPE_CATEGORY[shape.type],
      type: shape.type,
      severity: shape.severity,
      // No person behind these. The platform observes itself, and an invented
      // administrator on a degradation would be a name to chase that never
      // did anything.
      actor: 'Platform monitor',
      actorRole: 'system',
      target: shape.target,
      action: EVENT_TYPE_LABEL[shape.type],
      summary: shape.summary(round),
      ip: null,
      device: null,
      payload: shape.payload(round),
    } satisfies LogEvent;
  }),
);

/* ── Export records ───────────────────────────────────────────── */

/**
 * Events written by `exportEvents`, appended to the aggregate on every read.
 * Module-level rather than stored, matching the seeded corpus: an export is a
 * fact about this session, and it belongs in the same stream as everything
 * else the moment it happens.
 */
const exportRecords: LogEvent[] = [];
let exportSequence = 0;

/**
 * Every scalar `LogFilters` field that was actually set, keyed for the
 * export payload with a `filter` prefix so none collides with the export's
 * own `actor`/`format`/`rowCount` keys on the same object.
 *
 * `query` is administrator free text — the one field here that could contain
 * anything, including punctuation a naive summary line would mangle. It is
 * trimmed and passed through as a plain string like every other field, never
 * concatenated into markup: `LogEvent.payload` values reach the screen only
 * through the drawer's key-value grid and `JSON.stringify`, and reach a file
 * only through `toDataset` → `csvField`/`toJson`, both of which already quote
 * or escape arbitrary text. Nothing here needs its own escaping on top of
 * that — it just needs to not be silently dropped.
 */
function activeFilterEntries(
  filters: LogFilters,
): Readonly<Record<string, string | number | boolean>> {
  const entries: Record<string, string | number | boolean> = {};
  if (filters.query.trim() !== '') entries.filterQuery = filters.query.trim();
  if (filters.actorRole !== 'all') entries.filterRole = filters.actorRole;
  if (filters.actor !== 'all') entries.filterActor = filters.actor;
  if (filters.type !== 'all') entries.filterType = filters.type;
  if (filters.severity !== 'all') entries.filterSeverity = filters.severity;
  if (filters.from !== '') entries.filterFrom = filters.from;
  if (filters.to !== '') entries.filterTo = filters.to;
  if (filters.ip.trim() !== '') entries.filterIp = filters.ip.trim();
  return entries;
}

/**
 * A one-line description of the same fields `activeFilterEntries` records,
 * for the row's `summary`. Without this, "3 filter(s) applied" only tells a
 * reviewer *how many* constraints were in force — never which actor, IP or
 * date window narrowed what left the building, which is exactly what "what
 * did this administrator take?" needs answered.
 */
function describeActiveFilters(filters: LogFilters): string | null {
  const entries = activeFilterEntries(filters);
  const parts = Object.entries(entries).map(([key, value]) => {
    const label = key.slice('filter'.length).toLowerCase();
    return `${label}=${String(value)}`;
  });
  return parts.length === 0 ? null : parts.join(', ');
}

function exportSummary(format: 'csv' | 'json', filters: LogFilters, rowCount: number): string {
  const base = `Exported ${String(rowCount)} log rows as ${format.toUpperCase()}`;
  const description = describeActiveFilters(filters);
  return description === null
    ? `${base}, no filters applied`
    : `${base} with ${String(activeFilterCount(filters))} filter(s) applied: ${description}`;
}

function buildExportEvent(
  format: 'csv' | 'json',
  filters: LogFilters,
  actor: string,
  rowCount: number,
): LogEvent {
  exportSequence += 1;
  return {
    id: `export:${String(exportSequence)}`,
    at: new Date().toISOString(),
    category: TYPE_CATEGORY['data-export'],
    type: 'data-export',
    // Never `info`. A bulk extraction of the audit trail is legitimate and
    // still the thing a reviewer most wants surfaced, the same reasoning that
    // makes a PHI reveal a `warning`.
    severity: 'warning',
    actor,
    actorRole: 'administrator',
    // A file name, not a record — nothing about the exported rows leaks here.
    target: `medora-system-logs.${format}`,
    action: EVENT_TYPE_LABEL['data-export'],
    summary: exportSummary(format, filters, rowCount),
    ip: null,
    device: null,
    payload: {
      format,
      rowCount,
      activeFilters: activeFilterCount(filters),
      ...activeFilterEntries(filters),
    },
  } satisfies LogEvent;
}

/* ── Aggregation ──────────────────────────────────────────────── */

/**
 * One pass over every trail the platform keeps, classified into `LogEvent`s.
 *
 * Sources are read in parallel and each exactly once — see the module note on
 * why `getAuditEvents()` is not among them.
 */
async function aggregate(): Promise<readonly LogEvent[]> {
  const [doctors, patients, oversight, phiLog, communications] = await Promise.all([
    doctorsApi.list(),
    patientsApi.list(),
    oversightApi.list(),
    administrationApi.phiAccess.list(),
    communicationsApi.list(),
  ]);

  return [
    ...doctors.doctors.flatMap((doctor) => fromDoctorLogins(doctor)),
    ...doctors.doctors.flatMap((doctor) => fromDoctorAudit(doctor)),
    ...patients.patients.flatMap((patient) => fromPatientEvents(patient)),
    ...oversight.appointments.flatMap((appointment) => fromAppointmentEvents(appointment)),
    ...fromPhiAccess(phiLog),
    ...fromContentAccess(communications.accessLog),
    ...fromLegacyAudit(auditEvents),
    ...SYSTEM_LOG,
    ...exportRecords,
  ];
}

/* ── Export dataset ───────────────────────────────────────────── */

const EXPORT_COLUMNS: readonly string[] = [
  // Named for the clock it is in. The cell is `formatTimestamp`'s output —
  // the reader's local wall clock, exactly as the table showed it — and a
  // bare wall clock in a file that outlives the session it was taken in is
  // ambiguous unless the header says whose clock it is.
  'Timestamp (local)',
  'Category',
  'Event',
  'Severity',
  'Actor',
  'Role',
  'Target',
  'Summary',
  'IP',
  'Device',
];

/** The columns of the table, in the table's order — an export of what was on screen. */
function toDataset(rows: readonly LogEvent[]): ExportDataset {
  return {
    filename: 'medora-system-logs',
    title: 'System logs',
    columns: EXPORT_COLUMNS,
    rows: rows.map((event) => [
      formatTimestamp(event.at),
      CATEGORY_LABEL[event.category],
      EVENT_TYPE_LABEL[event.type],
      SEVERITY_LABEL[event.severity],
      event.actor,
      event.actorRole,
      event.target,
      event.summary,
      event.ip ?? '—',
      event.device ?? '—',
    ]),
  };
}

/* ── Saved views ──────────────────────────────────────────────── */

const SAVED_VIEWS_KEY = 'medora.admin.logs.views.v1';

/**
 * Local wall clock, never `toISOString()`: a saved view's `from` lands in a
 * `datetime-local` input, whose value sanitisation blanks an ISO instant
 * outright — so the seeded view used to filter the table by a seven-day
 * window the bar rendered as empty. See `toDateTimeLocalValue`.
 */
function sevenDaysAgo(): string {
  return toDateTimeLocalValue(new Date(Date.now() - 7 * DAY_MS));
}

/** §3.7's two shipped views — the searches an investigation starts from. */
function seedViews(): readonly SavedView[] {
  return [
    {
      id: 'view-failed-logins',
      name: 'Failed logins 7d',
      filters: { ...EMPTY_FILTERS, type: 'login-failed', from: sevenDaysAgo() },
    },
    {
      id: 'view-admin-phi',
      name: 'Admin PHI access',
      filters: { ...EMPTY_FILTERS, type: 'phi-revealed' },
    },
  ];
}

function persistViews(views: readonly SavedView[]): readonly SavedView[] {
  try {
    window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // Storage unavailable — views stay session-local.
  }
  return views;
}

function loadViews(): readonly SavedView[] {
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    // Seeded on first read rather than on write, so a cleared store comes back
    // with the two views §3.7 promises instead of an empty picker.
    if (raw === null) return persistViews(seedViews());
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return persistViews(seedViews());
    return parsed as readonly SavedView[];
  } catch {
    return seedViews();
  }
}

function nextViewId(existing: readonly SavedView[]): string {
  const used = new Set(existing.map((view) => view.id));
  let n = existing.length + 1;
  while (used.has(`view-${String(n)}`)) n += 1;
  return `view-${String(n)}`;
}

/* ── Service ──────────────────────────────────────────────────── */

export const logsApi = {
  list: async (request: LogListRequest): Promise<LogPage> => {
    const all = await aggregate();
    // Filter and count on this side of the seam — a real API would, and the
    // page must never hold more than one page.
    const matched = filterEvents(all, request.filters, request.sort);
    const rows = matched.slice(request.offset, request.offset + request.limit);
    return delay({ rows, total: matched.length });
  },

  /**
   * Every actor name in the log, sorted — the domain of the actor filter.
   *
   * `matchesFilters` compares the actor exactly, so the filter needs the
   * names from the whole aggregate. Deriving them from the page on screen
   * would offer the reader only whoever happened to act most recently, and
   * quietly hide anyone whose events all sit on a later page.
   */
  actors: async (): Promise<readonly string[]> => {
    const all = await aggregate();
    return delay([...new Set(all.map((event) => event.actor))].sort((a, b) => a.localeCompare(b)));
  },

  savedViews: (): Promise<readonly SavedView[]> => delay(loadViews()),

  createView: (name: string, filters: LogFilters): Promise<readonly SavedView[]> => {
    const current = loadViews();
    const view: SavedView = { id: nextViewId(current), name, filters };
    return delay(persistViews([...current, view]));
  },

  deleteView: (id: string): Promise<readonly SavedView[]> =>
    delay(persistViews(loadViews().filter((view) => view.id !== id))),

  exportEvents: async (
    format: 'csv' | 'json',
    filters: LogFilters,
    actor: string,
  ): Promise<number> => {
    const all = await aggregate();
    const rows = filterEvents(all, filters, 'newest');
    /*
     * The export event is appended BEFORE the file is written, the same order
     * ADM-10 uses for PHI reveals: an access that failed to log is an access
     * that did not happen. §3.7 requires the export itself be logged.
     */
    exportRecords.push(buildExportEvent(format, filters, actor, rows.length));
    if (format === 'csv') exportCsv(toDataset(rows));
    else exportJson(toDataset(rows));
    return delay(rows.length);
  },

  /**
   * Appends a `data-export` event for an export this service did not run
   * itself — the Communications Overview tab's aggregate export (ADM-06B
   * Task 7) is the first caller. `exportEvents` above builds its own event
   * inline because it knows the exact filters and row count that produced
   * it; a caller elsewhere knows its own export just as precisely, so this
   * takes the finished fields rather than reimplementing
   * `buildExportEvent`'s filter-specific shape for a caller with no filters
   * to describe.
   *
   * Synchronous, unlike `exportEvents`: the caller has already decided to
   * export by the time it calls this, and §3.6/§3.7 both ask for the write
   * to land before the file does — "an access that failed to log is an
   * access that did not happen," the same ordering `exportEvents` uses.
   *
   * Not named to match `/event/i` other than `exportEvents` itself — see
   * `logs.api.test.ts`'s read-only guard on this surface.
   */
  recordExport: (input: {
    readonly target: string;
    readonly summary: string;
    readonly actor: string;
    readonly payload: Readonly<Record<string, string | number | boolean>>;
  }): void => {
    exportSequence += 1;
    exportRecords.push({
      id: `export:${String(exportSequence)}`,
      at: new Date().toISOString(),
      category: TYPE_CATEGORY['data-export'],
      type: 'data-export',
      severity: 'warning',
      actor: input.actor,
      actorRole: 'administrator',
      target: input.target,
      action: EVENT_TYPE_LABEL['data-export'],
      summary: input.summary,
      ip: null,
      device: null,
      payload: input.payload,
    } satisfies LogEvent);
  },
};
