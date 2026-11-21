import type {
  AnalyticsSnapshot,
  ExportFormat,
  Insight,
  ReportFilters,
  ReportsDocument,
  ScheduleFrequency,
  SeriesPoint,
} from './types';

/**
 * The reports port — `api/seam.ts`'s pattern, one feature, one port.
 *
 * **Where this file lives, and why it is not in `src/types/`.** The same
 * reasoning the laboratory, pharmacy, messaging and notifications ports record
 * (`labs/model/lab-service.ts`): `import/no-restricted-paths` forbids
 * `src/api` from importing a feature, so a port under `features/` cannot have
 * an HTTP adapter in `src/api/endpoints/` — and reports cannot have one
 * anyway, because the backend implements auth, `/health`, `/ready` and
 * `/me/*` and no analytics endpoint exists
 * (`docs/handoff/auth-seam.md` §3). The day they land, this file moves to
 * `src/types/reports/`, the adapter is written, and `service.ts` grows a
 * `selectService` call; every consumer already imports `service.ts`.
 *
 * **`userId` is threaded through every document method rather than read from
 * the session inside the adapter.** On the mock path it namespaces the store;
 * on a live path the server will scope the read from the session and ignore
 * the argument. Passing it keeps the mock honest about the namespacing it
 * actually does — and `docs/handoff/clinic-isolation.md` is explicit that a
 * server must never scope a read from a request parameter, so the live adapter
 * dropping it is the correct end state, not a regression.
 */

export interface AnalyticsResult {
  readonly snapshot: AnalyticsSnapshot;
  readonly insights: readonly Insight[];
  /**
   * What the revenue category shows instead of revenue when the clinic has
   * no billing (ADR-037 §3, API §12.1): the server's notice and the doctor's
   * most frequent visit types. `null` everywhere else, and always in the
   * demo, whose revenue figures are seeded.
   */
  readonly revenueAlternate: RevenueAlternate | null;
}

export interface RevenueAlternate {
  /** A sentence the screen shows verbatim. */
  readonly notice: string;
  readonly topVisitTypes: readonly SeriesPoint[];
}

/** The report filters a source actually applies. */
export type AdvancedFilterKey =
  'department' | 'status' | 'medication' | 'labTest' | 'age' | 'gender';

export interface ReportsCapabilities {
  /**
   * The advanced filters the source applies. The server's analytics take
   * gender and age band only (M21.1); offering department or lab test there
   * would draw an unfiltered chart under a filter chip.
   */
  readonly advancedFilters: readonly AdvancedFilterKey[];
  /**
   * The departments the department filter offers, where the source applies
   * that filter. The adapter supplies them because only it knows them: the
   * demo's list is part of its seeded dataset, and the server applies no
   * department filter (empty), so a live build carries no demo list (RM M40.4).
   */
  readonly departmentOptions: readonly string[];
  /** Whether a saved report can be renamed (no server route). */
  readonly renameSaved: boolean;
  /** Whether a saved report can be starred (no server route). */
  readonly favorites: boolean;
  /**
   * Whether a schedule is actually delivered. The server stores schedules
   * but its executor is registered blocked (M30.2): nothing can carry the
   * document to the recipients yet, so nothing is sent.
   */
  readonly scheduleDelivery: boolean;
  /** Whether the figures are the demo's seeded, illustrative corpus. */
  readonly illustrative: boolean;
}

export interface ScheduleInput {
  readonly name: string;
  readonly category: ReportsDocument['scheduled'][number]['category'];
  readonly frequency: ScheduleFrequency;
  readonly format: ExportFormat;
  readonly recipients: readonly string[];
}

export interface CreateSavedReportInput {
  readonly name: string;
  readonly filters: ReportFilters;
}

export interface RenameSavedReportInput {
  readonly id: string;
  readonly name: string;
}

export interface ReportsService {
  /* ── Analytics ─────────────────────────────────────────────── */
  /**
   * The snapshot **and** the insights derived from it, in one answer. Two
   * calls would let the page render insights about a snapshot it is no longer
   * showing, which is the kind of disagreement a doctor reads as a bug in the
   * numbers rather than in the fetch.
   */
  fetchAnalytics(filters: ReportFilters): Promise<AnalyticsResult>;

  /* ── The saved + scheduled document ────────────────────────── */
  fetchReportsDocument(userId: string): Promise<ReportsDocument>;

  /**
   * Every mutation below answers the **whole patched document**, never void
   * and never the one row it touched. The query layer writes that straight
   * into the cache instead of refetching, so the rail cannot briefly show a
   * report that was just deleted, and StrictMode's double-invoke cannot
   * produce two of them.
   */
  createSavedReport(userId: string, input: CreateSavedReportInput): Promise<ReportsDocument>;
  renameSavedReport(userId: string, input: RenameSavedReportInput): Promise<ReportsDocument>;
  duplicateSavedReport(userId: string, id: string): Promise<ReportsDocument>;
  deleteSavedReport(userId: string, id: string): Promise<ReportsDocument>;
  toggleFavorite(userId: string, id: string): Promise<ReportsDocument>;
  /** Records that a saved report was opened, for the rail's recency order. */
  touchSavedReport(userId: string, id: string): Promise<ReportsDocument>;

  createSchedule(userId: string, input: ScheduleInput): Promise<ReportsDocument>;
  toggleScheduleStatus(userId: string, id: string): Promise<ReportsDocument>;
  deleteSchedule(userId: string, id: string): Promise<ReportsDocument>;

  /* ── Export ────────────────────────────────────────────────── */
  /**
   * Server-side generation, and the one method here whose absence is visible
   * to the user: the CSV that actually reaches the disk is built in the
   * browser by `utils/export.ts` and this method stands beside it for the
   * formats a renderer owns. It answers the format it produced rather than
   * void so the caller reports what happened rather than what it asked for.
   */
  runExport(format: ExportFormat): Promise<{ readonly format: ExportFormat }>;

  readonly capabilities: ReportsCapabilities;
}
