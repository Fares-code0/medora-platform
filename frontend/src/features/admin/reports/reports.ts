/**
 * Admin Reports — pure derivation (ADM-08 · UX §3.8).
 *
 * Every number on `/admin/reports` is computed here, from documents the other
 * admin modules already hold. Nothing in this file fetches, stores, or renders;
 * `reports.api.ts` supplies the sources and `ReportsSection.tsx` draws the
 * result, which is what makes the whole report testable as arithmetic.
 *
 * ## The rule this page is built on
 *
 * ADM-01 established it and this report inherits it: **a figure is derived from
 * a real store, or it is labelled.** Growth, utilization and most of clinical
 * operations come out of the ADM-02 / ADM-04 / ADM-05 documents, so a doctor
 * verified on the Doctors page moves the activation rate here on the next
 * render. Where no source exists — laboratory turnaround, AI service usage —
 * the widget says so and names what would supply it, instead of serving an
 * invented series in the right shape. `WidgetAvailability` is three-valued for
 * exactly that reason.
 *
 * ## One projection, three renderings
 *
 * §3.8 makes every widget range-aware, viewable as a table and individually
 * exportable. `datasetOf()` is the single function that turns a `WidgetVisual`
 * into rows and columns, so the chart, the table and the CSV are the same
 * numbers by construction rather than by three careful implementations.
 */

import type { AnalyticsTone, HeatmapData, NamedSeries, SeriesPoint } from '@/components/charts';
import { formatDateWith , formatNumber } from '@/i18n';
import { routes } from '@/routes';

import type { SystemHealth } from '../administration.types';
import { HEATMAP_HOURS, HEATMAP_WEEKDAYS, buildHeatmap } from '../appointments/oversight';
import type { OversightAppointment, PlatformDoctor } from '../appointments/oversight.types';
import type { DoctorRecord } from '../doctors/doctors.types';
import type { LogEvent } from '../logs/logs.types';
import type { ServiceHealth } from '../overview/overview.types';
import type { PatientAccount } from '../patients/patients.types';

import type {
  BucketKind,
  BucketSpan,
  RangeKey,
  ReportDocument,
  ReportId,
  ReportRange,
  ReportWidget,
  ScheduleDraft,
  ScheduleFrequency,
  ScheduledReport,
  SummaryDirection,
  ValueFormat,
  WidgetDataset,
  WidgetSummary,
  WidgetVisual,
} from './reports.types';

/* ── Labels ───────────────────────────────────────────────────── */

export const REPORT_LABEL: Record<ReportId, string> = {
  growth: 'Growth',
  utilization: 'Utilization',
  clinical: 'Clinical operations',
  system: 'System performance',
};

export const REPORT_CAPTION: Record<ReportId, string> = {
  growth: 'Who joined the platform, and how many of them started using it.',
  utilization: 'Where appointment demand lands, and whether there is capacity for it.',
  clinical: 'How quickly the platform responds, and how appointments end.',
  system: 'What the platform itself is doing, and where it is under strain.',
};

export const RANGE_LABEL: Record<RangeKey, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '12m': 'Last 12 months',
};

export const FREQUENCY_LABEL: Record<ScheduleFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export function isReportId(value: string): value is ReportId {
  return value in REPORT_LABEL;
}

export function isRangeKey(value: string): value is RangeKey {
  return value in RANGE_LABEL;
}

/* ── Range arithmetic ─────────────────────────────────────────── */

const RANGE_SHAPE: Record<RangeKey, { readonly bucket: BucketKind; readonly count: number }> = {
  '7d': { bucket: 'day', count: 7 },
  '30d': { bucket: 'day', count: 30 },
  '90d': { bucket: 'week', count: 13 },
  '12m': { bucket: 'month', count: 12 },
};

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Calendar-aware stepping, not `ms + n * DAY_MS`.
 *
 * `setDate`/`setMonth` walk the local calendar, so a range that spans a
 * daylight-saving change keeps 24-hour days on the axis instead of gaining or
 * losing an hour, and a monthly bucket is a real month rather than 30 days.
 * Every bucket boundary in this file goes through one of these three.
 */
function addDays(ms: number, count: number): number {
  const date = new Date(ms);
  date.setDate(date.getDate() + count);
  return date.getTime();
}

function startOfWeek(ms: number): number {
  const date = new Date(startOfDay(ms));
  // JS weeks start on Sunday; the clinic's do not, and neither does the
  // heatmap this page shares with ADM-05.
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
}

function startOfMonth(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  date.setDate(1);
  return date.getTime();
}

function addMonths(ms: number, count: number): number {
  const date = new Date(startOfMonth(ms));
  date.setMonth(date.getMonth() + count);
  return date.getTime();
}

function stepBack(kind: BucketKind, ms: number, units: number): number {
  if (kind === 'day') return addDays(ms, -units);
  if (kind === 'week') return addDays(ms, -units * 7);
  return addMonths(ms, -units);
}

function bucketLabel(kind: BucketKind, fromMs: number): string {
  const date = new Date(fromMs);
  if (kind === 'month') {
    return formatDateWith(date, { month: 'short', year: '2-digit' });
  }
  return formatDateWith(date, { month: 'short', day: 'numeric' });
}

/**
 * `count` buckets of `kind`, ending immediately before `endExclusiveMs`.
 *
 * `endExclusiveMs` must already sit on a boundary of `kind` — both callers
 * align it — so a bucket never straddles two calendar units.
 */
function buildBuckets(
  kind: BucketKind,
  count: number,
  endExclusiveMs: number,
): readonly BucketSpan[] {
  return Array.from({ length: count }, (_, index) => {
    const fromMs = stepBack(kind, endExclusiveMs, count - index);
    const toMs = stepBack(kind, endExclusiveMs, count - index - 1);
    return { label: bucketLabel(kind, fromMs), fromMs, toMs };
  });
}

/** The window ending with the calendar unit `now` falls in, inclusive. */
export function resolveRange(key: RangeKey, now: number): ReportRange {
  const { bucket, count } = RANGE_SHAPE[key];
  const endExclusive =
    bucket === 'day'
      ? addDays(startOfDay(now), 1)
      : bucket === 'week'
        ? addDays(startOfWeek(now), 7)
        : addMonths(startOfMonth(now), 1);

  const buckets = buildBuckets(bucket, count, endExclusive);
  return {
    key,
    bucket,
    buckets,
    fromMs: buckets[0]?.fromMs ?? endExclusive,
    toMs: endExclusive,
  };
}

/**
 * The same number of the same buckets, immediately before `range`.
 *
 * Built by stepping the calendar rather than subtracting `toMs - fromMs`,
 * which for a 12-month range would land the comparison window a day or two
 * off every February.
 */
export function previousRange(range: ReportRange): ReportRange {
  const buckets = buildBuckets(range.bucket, range.buckets.length, range.fromMs);
  return {
    key: range.key,
    bucket: range.bucket,
    buckets,
    fromMs: buckets[0]?.fromMs ?? range.fromMs,
    toMs: range.fromMs,
  };
}

/** `true` when `iso` falls inside the half-open window. */
export function inRange(range: ReportRange, iso: string): boolean {
  const ms = Date.parse(iso);
  return !Number.isNaN(ms) && ms >= range.fromMs && ms < range.toMs;
}

/** Which bucket `iso` lands in, or `-1` when it is outside the range. */
export function bucketIndexOf(range: ReportRange, iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return -1;
  return range.buckets.findIndex((bucket) => ms >= bucket.fromMs && ms < bucket.toMs);
}

/** An all-zero series over the range's buckets, ready to be filled. */
function emptyCounts(range: ReportRange): number[] {
  return range.buckets.map(() => 0);
}

function pointsOf(range: ReportRange, values: readonly number[]): readonly SeriesPoint[] {
  return range.buckets.map((bucket, index) => ({
    label: bucket.label,
    value: values[index] ?? 0,
  }));
}

/* ── Formatting ───────────────────────────────────────────────── */

export function formatValue(format: ValueFormat, value: number): string {
  switch (format) {
    case 'percent':
      return `${round1(value).toString()}%`;
    case 'hours':
      return value < 1
        ? `${Math.round(value * 60).toString()} min`
        : `${round1(value).toString()} h`;
    case 'ms':
      return `${Math.round(value).toString()} ms`;
    case 'gb':
      return `${round1(value).toString()} GB`;
    case 'count':
      return formatNumber(Math.round(value));
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percent(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/* ── The one projection: visual → dataset ─────────────────────── */

/**
 * The tabular form of a widget. "View as table" renders this and "Export this
 * widget" writes it, so neither can drift from the chart above them.
 */
export function datasetOf(visual: WidgetVisual): WidgetDataset {
  switch (visual.kind) {
    case 'line':
    case 'area': {
      const labels = visual.series[0]?.points.map((point) => point.label) ?? [];
      return {
        columns: [visual.categoryLabel, ...visual.series.map((series) => series.name)],
        rows: labels.map((label, index) => [
          label,
          ...visual.series.map((series) =>
            formatValue(visual.format, series.points[index]?.value ?? 0),
          ),
        ]),
      };
    }
    case 'bar':
    case 'distribution': {
      const annotations = visual.annotations ?? [];
      return {
        columns: [
          visual.categoryLabel,
          visual.valueLabel,
          ...annotations.map((annotation) => annotation.column),
        ],
        rows: visual.series.points.map((point, index) => [
          point.label,
          formatValue(visual.format, point.value),
          ...annotations.map((annotation) => annotation.values[index] ?? '—'),
        ]),
      };
    }
    case 'pie':
      return {
        columns: [visual.categoryLabel, visual.valueLabel],
        rows: visual.slices.map((slice) => [slice.label, formatValue(visual.format, slice.value)]),
      };
    case 'heatmap':
      return {
        columns: [visual.categoryLabel, ...visual.data.columns],
        rows: visual.data.rows.map((row, rowIndex) => [
          row,
          ...visual.data.columns.map((_, columnIndex) => {
            const cell = visual.data.cells[rowIndex]?.[columnIndex] ?? 0;
            return cell === visual.blankValue ? '—' : formatValue(visual.format, cell);
          }),
        ]),
      };
    case 'facts':
      return {
        columns: ['Metric', 'Value'],
        rows: visual.facts.map((fact) => [fact.label, fact.value]),
      };
  }
}

/* ── Widget construction helpers ──────────────────────────────── */

interface WidgetInput {
  readonly id: ReportWidget['id'];
  readonly title: string;
  readonly caption: string;
  readonly visual: WidgetVisual;
  readonly summary: WidgetSummary | null;
  readonly drillTo?: string;
  readonly drillLabel?: string;
  readonly rangeOverride?: string;
  /** Forces `empty` even when the visual exists — see `hasAnyValue`. */
  readonly empty?: { readonly when: boolean; readonly reason: string };
}

function widget(input: WidgetInput): ReportWidget {
  const isEmpty = input.empty?.when === true;
  return {
    id: input.id,
    title: input.title,
    caption: input.caption,
    availability: isEmpty ? 'empty' : 'ready',
    note: isEmpty ? (input.empty?.reason ?? null) : null,
    visual: isEmpty ? null : input.visual,
    summary: isEmpty ? null : input.summary,
    drillTo: input.drillTo ?? null,
    drillLabel: input.drillLabel ?? null,
    rangeOverride: input.rangeOverride ?? null,
  };
}

/**
 * A widget for a figure this client has no source for at all.
 *
 * Distinct from `empty` on purpose: `empty` invites a wider range, and no
 * range will ever populate one of these. The reason names the missing service
 * so the row reads as a handoff rather than a bug.
 */
function unavailable(
  id: ReportWidget['id'],
  title: string,
  caption: string,
  reason: string,
): ReportWidget {
  return {
    id,
    title,
    caption,
    availability: 'unavailable',
    note: reason,
    visual: null,
    summary: null,
    drillTo: null,
    drillLabel: null,
    rangeOverride: null,
  };
}

function summary(
  label: string,
  raw: number,
  format: ValueFormat,
  direction: SummaryDirection,
): WidgetSummary {
  return { label, value: formatValue(format, raw), raw, direction, comparison: null };
}

function hasAnyValue(values: readonly number[]): boolean {
  return values.some((value) => value !== 0);
}

/* ── Sources ──────────────────────────────────────────────────── */

/**
 * Everything the four reports read. Assembled once per document build by
 * `reports.api.ts`, so a report never fetches a store twice and the widgets on
 * one tab are guaranteed to be describing the same instant.
 */
export interface ReportSources {
  readonly doctors: readonly DoctorRecord[];
  readonly patients: readonly PatientAccount[];
  readonly appointments: readonly OversightAppointment[];
  readonly platformDoctors: readonly PlatformDoctor[];
  readonly logEvents: readonly LogEvent[];
  readonly services: readonly ServiceHealth[];
  readonly system: SystemHealth;
  readonly now: number;
}

const CATEGORICAL: readonly AnalyticsTone[] = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'];

function toneAtIndex(index: number): AnalyticsTone {
  return CATEGORICAL[index % CATEGORICAL.length] ?? 'chart1';
}

/**
 * The busiest `limit` values of `key`, plus an `Other` bucket when more exist.
 *
 * Charts here carry five categorical tones (`ChartTone`), and a sixth series
 * would either repeat a colour or reach into the alarm hues for a category
 * that carries no alarm — the exact mistake ADR-0001 §9 fixed. Folding the
 * tail into `Other` keeps the total honest while staying inside the palette.
 */
function topCategories(
  values: readonly string[],
  limit: number,
): { readonly named: readonly string[]; readonly hasOther: boolean } {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const sorted = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return { named: sorted.slice(0, limit), hasOther: sorted.length > limit };
}

function categoryOf(value: string, named: readonly string[]): string {
  return named.includes(value) ? value : 'Other';
}

/* ── Growth ───────────────────────────────────────────────────── */

/**
 * Cumulative account totals at the end of each bucket.
 *
 * Counted from `joinedAt` / `registeredAt` against the bucket's *end*, so the
 * last point is the platform's total today rather than the total of whoever
 * happened to join inside the window. A cumulative line that restarts at the
 * range boundary is the classic way to make a healthy platform look like it
 * lost every user it ever had.
 */
export function deriveUserGrowth(sources: ReportSources, range: ReportRange): ReportWidget {
  const doctors = range.buckets.map(
    (bucket) =>
      sources.doctors.filter((doctor) => Date.parse(doctor.joinedAt) < bucket.toMs).length,
  );
  const patients = range.buckets.map(
    (bucket) =>
      sources.patients.filter((patient) => Date.parse(patient.registeredAt) < bucket.toMs).length,
  );
  const total = (doctors.at(-1) ?? 0) + (patients.at(-1) ?? 0);

  return widget({
    id: 'user-growth',
    title: 'User growth',
    caption: 'Total doctors and patients on the platform at the close of each period.',
    visual: {
      kind: 'line',
      categoryLabel: 'Period',
      format: 'count',
      series: [
        { name: 'Doctors', tone: 'chart1', points: pointsOf(range, doctors) },
        { name: 'Patients', tone: 'chart2', points: pointsOf(range, patients) },
      ],
    },
    summary: summary('Accounts at period end', total, 'count', 'higher-better'),
    empty: {
      when: total === 0,
      reason: 'No accounts existed on or before this period.',
    },
  });
}

/** New accounts per bucket — the derivative of the line above. */
export function deriveNetNew(sources: ReportSources, range: ReportRange): ReportWidget {
  const doctors = emptyCounts(range);
  const patients = emptyCounts(range);

  for (const doctor of sources.doctors) {
    const index = bucketIndexOf(range, doctor.joinedAt);
    if (index >= 0) doctors[index] = (doctors[index] ?? 0) + 1;
  }
  for (const patient of sources.patients) {
    const index = bucketIndexOf(range, patient.registeredAt);
    if (index >= 0) patients[index] = (patients[index] ?? 0) + 1;
  }

  const total = sum(doctors) + sum(patients);

  return widget({
    id: 'net-new',
    title: 'Net-new accounts',
    caption: 'Registrations inside each period, doctors and patients separately.',
    visual: {
      kind: 'line',
      categoryLabel: 'Period',
      format: 'count',
      series: [
        { name: 'Doctors', tone: 'chart1', points: pointsOf(range, doctors) },
        { name: 'Patients', tone: 'chart2', points: pointsOf(range, patients) },
      ],
    },
    summary: summary('New accounts', total, 'count', 'higher-better'),
    empty: {
      when: total === 0,
      reason: 'Nobody registered in this period. Widen the range to see earlier signups.',
    },
  });
}

/**
 * The share of accounts registered in the range that went on to use the
 * platform.
 *
 * "Activated" is spelled out per role rather than left to a single flag,
 * because the two onboarding journeys genuinely differ: a doctor is not usable
 * until their credentials are verified *and* they have signed in, while a
 * patient only has to do something with the account — sign in or book. Using
 * "has signed in" for both would count a doctor stuck in the verification
 * queue as activated, which is precisely the cohort §3.1's action queue exists
 * to chase.
 */
export function deriveActivation(sources: ReportSources, range: ReportRange): ReportWidget {
  const doctorCohort = sources.doctors.filter((doctor) => inRange(range, doctor.joinedAt));
  const activatedDoctors = doctorCohort.filter(
    (doctor) =>
      doctor.verification === 'verified' &&
      doctor.logins.some((login) => login.result === 'success'),
  );

  const patientCohort = sources.patients.filter((patient) => inRange(range, patient.registeredAt));
  const activatedPatients = patientCohort.filter((patient) =>
    patient.events.some((event) => event.kind === 'sign-in' || event.kind === 'booking-made'),
  );

  const cohort = doctorCohort.length + patientCohort.length;
  const activated = activatedDoctors.length + activatedPatients.length;
  const doctorRate = percent(activatedDoctors.length, doctorCohort.length);
  const patientRate = percent(activatedPatients.length, patientCohort.length);

  return widget({
    id: 'activation-rate',
    title: 'Activation rate',
    caption:
      'Of the accounts created in this period, the share that became usable — a doctor verified and signed in, a patient signed in or booked.',
    visual: {
      kind: 'bar',
      categoryLabel: 'Role',
      valueLabel: 'Activation',
      format: 'percent',
      series: {
        name: 'Activation rate',
        tone: 'chart1',
        points: [
          { label: 'Doctors', value: round1(doctorRate) },
          { label: 'Patients', value: round1(patientRate) },
        ],
      },
      annotations: [
        { column: 'Activated', values: [activatedDoctors.length, activatedPatients.length] },
        { column: 'Registered', values: [doctorCohort.length, patientCohort.length] },
      ],
    },
    summary: summary('Overall activation', percent(activated, cohort), 'percent', 'higher-better'),
    empty: {
      when: cohort === 0,
      reason: 'Nobody registered in this period, so there is no cohort to activate.',
    },
  });
}

const COHORT_MONTHS = 6;

/** The sentinel `blankValue` for a cohort month that has not happened yet. */
const NO_COHORT_DATA = -1;

/**
 * Monthly registration cohorts against the months they stayed active in.
 *
 * **Deliberately not range-aware**, and the chip on the widget says so. A
 * retention cohort measures behaviour over months; computed across a 7-day
 * window it would have one cohort, one column, and no retention in it. Six
 * months is the widest grid the shared `Heatmap` renders (its column classes
 * stop at eight) and the shortest that shows a curve, so the grid is fixed at
 * the six months ending with the current one whatever the global range says.
 */
export function deriveRetentionCohorts(sources: ReportSources): ReportWidget {
  const thisMonth = startOfMonth(sources.now);
  const cohortStarts = Array.from({ length: COHORT_MONTHS }, (_, index) =>
    addMonths(thisMonth, -(COHORT_MONTHS - 1 - index)),
  );

  const rows = cohortStarts.map((start) =>
    formatDateWith(new Date(start), { month: 'short', year: '2-digit' }),
  );
  const columns = Array.from({ length: COHORT_MONTHS }, (_, index) => `M${index.toString()}`);

  const cells = cohortStarts.map((start) => {
    const end = addMonths(start, 1);
    const cohort = sources.patients.filter((patient) => {
      const registered = Date.parse(patient.registeredAt);
      return registered >= start && registered < end;
    });

    return columns.map((_, offset) => {
      const windowStart = addMonths(start, offset);
      const windowEnd = addMonths(start, offset + 1);
      // A future month is not zero retention, it is no data. `-1` renders as a
      // blank cell rather than as the coldest colour on the scale, which would
      // read as "everybody churned" for every cohort younger than the grid.
      if (windowStart > sources.now) return NO_COHORT_DATA;
      const retained = cohort.filter((patient) =>
        patient.events.some((event) => {
          const at = Date.parse(event.at);
          return at >= windowStart && at < windowEnd;
        }),
      ).length;
      return Math.round(percent(retained, cohort.length));
    });
  });

  const observed = cells.flat().filter((value) => value !== NO_COHORT_DATA);
  // Month 0 is trivially high for every cohort — registering is itself an
  // event — so the headline is month 1, the first month that is a choice.
  const monthOne = cells
    .map((row) => row[1] ?? NO_COHORT_DATA)
    .filter((value) => value !== NO_COHORT_DATA);

  return widget({
    id: 'retention-cohorts',
    title: 'Retention by cohort',
    caption:
      'Each row is a month of patient registrations; each column is how many of that cohort were still active N months later.',
    rangeOverride: `Last ${COHORT_MONTHS.toString()} months`,
    visual: {
      kind: 'heatmap',
      categoryLabel: 'Cohort',
      format: 'percent',
      blankValue: NO_COHORT_DATA,
      data: heatmapOf(rows, columns, cells),
    },
    summary:
      monthOne.length === 0
        ? null
        : summary('Month-1 retention', sum(monthOne) / monthOne.length, 'percent', 'higher-better'),
    empty: {
      when: observed.length === 0 || !hasAnyValue(observed),
      reason: 'No patient registered in the last six months has any recorded account activity.',
    },
  });
}

function heatmapOf(
  rows: readonly string[],
  columns: readonly string[],
  cells: readonly (readonly number[])[],
): HeatmapData {
  const max = Math.max(0, ...cells.flat());
  return { rows, columns, cells, max };
}

/* ── Utilization ──────────────────────────────────────────────── */

/**
 * Appointments per bucket, cancellations included.
 *
 * Included on purpose, and the caption says so: this widget answers "how much
 * did the book move", and a cancelled appointment consumed a request, a
 * notification and somebody's attention. The utilisation heatmap below
 * excludes them, because that one answers "was the slot occupied" — the same
 * distinction ADM-05 already draws in `buildHeatmap`.
 */
export function deriveAppointmentVolume(sources: ReportSources, range: ReportRange): ReportWidget {
  const counts = emptyCounts(range);
  for (const appointment of sources.appointments) {
    const index = bucketIndexOf(range, appointment.startsAt);
    if (index >= 0) counts[index] = (counts[index] ?? 0) + 1;
  }
  const total = sum(counts);

  return widget({
    id: 'appointment-volume',
    title: 'Appointment volume',
    caption: 'Every appointment scheduled in each period, cancellations and no-shows included.',
    visual: {
      kind: 'area',
      categoryLabel: 'Period',
      format: 'count',
      series: [{ name: 'Appointments', tone: 'chart1', points: pointsOf(range, counts) }],
    },
    summary: summary('Appointments', total, 'count', 'neutral'),
    drillTo: routes.admin.appointments,
    drillLabel: 'Open appointment oversight',
    empty: { when: total === 0, reason: 'No appointment falls in this period.' },
  });
}

const SPECIALTY_LIMIT = 4;

export function deriveVolumeBySpecialty(sources: ReportSources, range: ReportRange): ReportWidget {
  const inWindow = sources.appointments.filter((appointment) =>
    inRange(range, appointment.startsAt),
  );
  const { named, hasOther } = topCategories(
    inWindow.map((appointment) => appointment.specialty),
    SPECIALTY_LIMIT,
  );
  const categories = hasOther ? [...named, 'Other'] : named;

  const byCategory = new Map<string, number[]>(
    categories.map((category) => [category, emptyCounts(range)]),
  );
  for (const appointment of inWindow) {
    const bucket = bucketIndexOf(range, appointment.startsAt);
    if (bucket < 0) continue;
    const counts = byCategory.get(categoryOf(appointment.specialty, named));
    if (counts !== undefined) counts[bucket] = (counts[bucket] ?? 0) + 1;
  }

  const series: readonly NamedSeries[] = categories.map((category, index) => ({
    name: category,
    tone: toneAtIndex(index),
    points: pointsOf(range, byCategory.get(category) ?? emptyCounts(range)),
  }));

  return widget({
    id: 'volume-by-specialty',
    title: 'Volume by specialty',
    caption:
      // §3.8 asks for a stacked area. The shared chart library draws overlaid
      // series, not stacked ones, and pre-summing the data would make every
      // tooltip report a running total instead of the specialty's own figure.
      // Overlaid lines answer the same question without lying about the values.
      'The busiest specialties, one line each. Everything outside the top four is folded into Other.',
    visual: { kind: 'line', categoryLabel: 'Period', format: 'count', series },
    summary: summary('Specialties booked', categories.length, 'count', 'neutral'),
    drillTo: routes.admin.appointments,
    drillLabel: 'Open appointment oversight',
    empty: { when: inWindow.length === 0, reason: 'No appointment falls in this period.' },
  });
}

/**
 * Requested → confirmed → completed, counted over the appointments that were
 * *requested* in the range.
 *
 * Stage membership is read from the transition history rather than from the
 * current status, because a completed appointment was confirmed at some point
 * and a status-only reading would drop it out of the middle stage. An
 * appointment with no `requested` event still counts in stage 1 — it exists,
 * so it was requested; the seed simply does not carry the row for every one.
 */
export function deriveBookingFunnel(sources: ReportSources, range: ReportRange): ReportWidget {
  const requested = sources.appointments.filter((appointment) =>
    inRange(range, appointment.startsAt),
  );
  const confirmed = requested.filter(
    (appointment) =>
      appointment.events.some((event) => event.kind === 'confirmed') ||
      appointment.status === 'confirmed' ||
      appointment.status === 'completed',
  );
  const completed = requested.filter(
    (appointment) =>
      appointment.status === 'completed' ||
      appointment.events.some((event) => event.kind === 'completed'),
  );

  const conversion = percent(completed.length, requested.length);

  return widget({
    id: 'booking-funnel',
    title: 'Booking funnel',
    caption: 'How far the appointments requested in this period got.',
    visual: {
      kind: 'distribution',
      categoryLabel: 'Stage',
      valueLabel: 'Appointments',
      format: 'count',
      series: {
        name: 'Booking funnel',
        tone: 'chart1',
        points: [
          { label: 'Requested', value: requested.length },
          { label: 'Confirmed', value: confirmed.length },
          { label: 'Completed', value: completed.length },
        ],
      },
      annotations: [
        {
          column: 'Share of requested',
          values: [
            formatValue('percent', 100),
            formatValue('percent', percent(confirmed.length, requested.length)),
            formatValue('percent', conversion),
          ],
        },
      ],
    },
    summary: summary('Requested → completed', conversion, 'percent', 'higher-better'),
    drillTo: `${routes.admin.appointments}?status=pending`,
    drillLabel: 'Review appointments still pending',
    empty: { when: requested.length === 0, reason: 'No appointment was requested in this period.' },
  });
}

/**
 * Hour × weekday pressure, through **ADM-05's own `buildHeatmap`**.
 *
 * Reusing that function rather than writing a second one is the point: the
 * heatmap on appointment oversight and the heatmap here are then the same
 * derivation over a different filter, so they cannot report different peaks
 * for the same week. Its exclusion of cancellations comes along with it.
 */
export function derivePeakHours(sources: ReportSources, range: ReportRange): ReportWidget {
  const inWindow = sources.appointments.filter((appointment) =>
    inRange(range, appointment.startsAt),
  );
  const heatmap = buildHeatmap(inWindow);

  const rows = HEATMAP_HOURS.map((hour) => `${hour.toString().padStart(2, '0')}:00`);
  const cells = HEATMAP_HOURS.map((hour) =>
    HEATMAP_WEEKDAYS.map(
      (_, weekday) =>
        heatmap.cells.find((cell) => cell.hour === hour && cell.weekday === weekday)?.count ?? 0,
    ),
  );

  return widget({
    id: 'peak-hours',
    title: 'Peak hours',
    caption:
      'Occupied slots by hour and weekday. Cancellations are excluded — they never took the capacity.',
    visual: {
      kind: 'heatmap',
      categoryLabel: 'Hour',
      format: 'count',
      blankValue: null,
      data: heatmapOf(rows, HEATMAP_WEEKDAYS, cells),
    },
    summary: summary('Busiest slot', heatmap.peak, 'count', 'neutral'),
    empty: {
      when: heatmap.total === 0,
      reason: 'No appointment in this period fell inside clinic hours.',
    },
  });
}

/**
 * Today's bookable capacity against today's demand, per specialty.
 *
 * **A live snapshot, not a series**, and the chip on the widget says so.
 * Capacity is `openSlotsToday` plus what is already booked today — the only
 * capacity figure the platform actually publishes — so extrapolating it across
 * a 90-day window would be inventing eighty-nine days of roster. Demand is
 * today's booked slots plus every request still sitting in `pending`, whatever
 * date it was made: an unanswered request is demand the clinic has not met,
 * and leaving it out is what would make an over-subscribed specialty look
 * comfortable.
 */
export function deriveCapacityVsDemand(sources: ReportSources): ReportWidget {
  const todayStart = startOfDay(sources.now);
  const todayEnd = addDays(todayStart, 1);

  const todays = sources.appointments.filter((appointment) => {
    const at = Date.parse(appointment.startsAt);
    return at >= todayStart && at < todayEnd && appointment.status !== 'cancelled';
  });
  const pending = sources.appointments.filter((appointment) => appointment.status === 'pending');

  const specialties = [
    ...new Set([
      ...sources.platformDoctors.map((doctor) => doctor.specialty),
      ...todays.map((appointment) => appointment.specialty),
      ...pending.map((appointment) => appointment.specialty),
    ]),
  ].sort((a, b) => a.localeCompare(b));

  const rows = specialties
    .map((specialty) => {
      const openSlots = sources.platformDoctors
        .filter((doctor) => doctor.specialty === specialty)
        .reduce((total, doctor) => total + (doctor.openSlotsToday ?? 0), 0);
      const bookedToday = todays.filter(
        (appointment) => appointment.specialty === specialty,
      ).length;
      const pendingRequests = pending.filter(
        (appointment) => appointment.specialty === specialty,
      ).length;

      return {
        specialty,
        capacity: openSlots + bookedToday,
        demand: bookedToday + pendingRequests,
      };
    })
    .filter((row) => row.capacity > 0 || row.demand > 0)
    .sort((a, b) => b.demand - a.demand || a.specialty.localeCompare(b.specialty))
    .slice(0, SPECIALTY_LIMIT + 1);

  const totalCapacity = rows.reduce((total, row) => total + row.capacity, 0);
  const totalDemand = rows.reduce((total, row) => total + row.demand, 0);

  return widget({
    id: 'capacity-vs-demand',
    title: 'Capacity vs demand',
    caption:
      'Today’s bookable slots against today’s bookings plus every request still waiting for one. Above 100% the specialty is over-subscribed.',
    rangeOverride: 'Today',
    visual: {
      kind: 'bar',
      categoryLabel: 'Specialty',
      valueLabel: 'Demand vs capacity',
      format: 'percent',
      series: {
        name: 'Demand vs capacity',
        tone: 'chart1',
        points: rows.map((row) => ({
          label: row.specialty,
          value: round1(percent(row.demand, row.capacity)),
        })),
      },
      // The one place on this page where colour is the message: a bar past
      // 100% is a specialty that cannot serve what it has been asked for, and
      // that is an alarm rather than a category (ADR-0001 §9).
      barTones: rows.map((row): AnalyticsTone => (row.demand > row.capacity ? 'error' : 'chart1')),
      annotations: [
        { column: 'Capacity (slots)', values: rows.map((row) => row.capacity) },
        { column: 'Demand (slots)', values: rows.map((row) => row.demand) },
      ],
    },
    summary: summary(
      'Platform utilisation',
      percent(totalDemand, totalCapacity),
      'percent',
      'neutral',
    ),
    drillTo: routes.admin.appointments,
    drillLabel: 'Open appointment oversight',
    empty: {
      when: rows.length === 0,
      reason: 'No doctor is publishing capacity today and nothing is booked or waiting.',
    },
  });
}

/* ── Clinical operations ──────────────────────────────────────── */

/**
 * Mean hours from a request being made to it being confirmed, bucketed by when
 * the request arrived.
 *
 * Derived from the transition history rather than from
 * `DoctorRecord.statistics.avgResponseHours`, which is a pre-computed
 * per-doctor figure over an unstated window. Two sources for one number is the
 * disagreement ADM-01 was built to end; the transitions are the ones that can
 * be range-scoped, so they win.
 */
export function deriveResponseTime(sources: ReportSources, range: ReportRange): ReportWidget {
  const totals = emptyCounts(range);
  const counts = emptyCounts(range);

  for (const appointment of sources.appointments) {
    const requested = appointment.events.find((event) => event.kind === 'requested');
    const confirmed = appointment.events.find((event) => event.kind === 'confirmed');
    if (requested === undefined || confirmed === undefined) continue;

    const index = bucketIndexOf(range, requested.at);
    if (index < 0) continue;

    const hours = (Date.parse(confirmed.at) - Date.parse(requested.at)) / 3_600_000;
    // A confirmation stamped before its request is a corrupt history, not a
    // negative response time; averaging it in would drag the mean below zero.
    if (!Number.isFinite(hours) || hours < 0) continue;

    totals[index] = (totals[index] ?? 0) + hours;
    counts[index] = (counts[index] ?? 0) + 1;
  }

  const means = totals.map((total, index) => {
    const count = counts[index] ?? 0;
    return count === 0 ? 0 : total / count;
  });
  const answered = sum(counts);
  const overall = answered === 0 ? 0 : sum(totals) / answered;

  return widget({
    id: 'response-time',
    title: 'Response time to requests',
    caption:
      'Mean time from a patient requesting an appointment to a doctor confirming it, by the period the request arrived in.',
    visual: {
      kind: 'line',
      categoryLabel: 'Period',
      format: 'hours',
      series: [
        { name: 'Mean response', tone: 'chart1', points: pointsOf(range, means.map(round1)) },
      ],
    },
    summary: summary('Mean response', overall, 'hours', 'lower-better'),
    drillTo: `${routes.admin.appointments}?flag=stuck-pending`,
    drillLabel: 'Review requests nobody has answered',
    empty: {
      when: answered === 0,
      reason: 'No request in this period has both a requested and a confirmed transition.',
    },
  });
}

/**
 * How appointments ended, by specialty.
 *
 * The bars are the **no-show rate**, because that is the one §3.8 names as a
 * drill-down and the one an administrator intervenes on; completion and
 * cancellation ride along as annotation columns, so the table and the export
 * carry all three rates over a single shared denominator. Quoting three rates
 * as three chart series over a categorical axis would need three colours to
 * mean three unrelated things on the same bar.
 */
export function deriveOutcomeRates(sources: ReportSources, range: ReportRange): ReportWidget {
  const concluded = sources.appointments.filter(
    (appointment) =>
      inRange(range, appointment.startsAt) &&
      (appointment.status === 'completed' ||
        appointment.status === 'cancelled' ||
        appointment.status === 'no-show'),
  );

  const { named } = topCategories(
    concluded.map((appointment) => appointment.specialty),
    SPECIALTY_LIMIT + 1,
  );

  const rows = named.map((specialty) => {
    const own = concluded.filter((appointment) => appointment.specialty === specialty);
    const count = (status: string) =>
      own.filter((appointment) => appointment.status === status).length;
    return {
      specialty,
      total: own.length,
      completion: percent(count('completed'), own.length),
      cancellation: percent(count('cancelled'), own.length),
      noShow: percent(count('no-show'), own.length),
    };
  });

  const noShowTotal = concluded.filter((appointment) => appointment.status === 'no-show').length;

  return widget({
    id: 'outcome-rates',
    title: 'Outcome rates by specialty',
    caption:
      'Bars are the no-show rate; completion and cancellation share the same denominator and are in the table.',
    visual: {
      kind: 'bar',
      categoryLabel: 'Specialty',
      valueLabel: 'No-show rate',
      format: 'percent',
      series: {
        name: 'No-show rate',
        tone: 'chart1',
        points: rows.map((row) => ({ label: row.specialty, value: round1(row.noShow) })),
      },
      annotations: [
        {
          column: 'Completion',
          values: rows.map((row) => formatValue('percent', row.completion)),
        },
        {
          column: 'Cancellation',
          values: rows.map((row) => formatValue('percent', row.cancellation)),
        },
        { column: 'Concluded', values: rows.map((row) => row.total) },
      ],
    },
    summary: summary(
      'No-show rate',
      percent(noShowTotal, concluded.length),
      'percent',
      'lower-better',
    ),
    drillTo: `${routes.admin.appointments}?status=no-show`,
    drillLabel: 'Open the no-shows',
    empty: {
      when: concluded.length === 0,
      reason: 'No appointment in this period has reached a final state yet.',
    },
  });
}

/**
 * Prescriptions issued, grouped by the prescriber's specialty.
 *
 * **Not range-aware**, and the chip says which window it does cover. The only
 * platform-wide source is `DoctorRecord.activity`, which is a count over a
 * fixed window the record states itself — there is no per-prescription
 * timestamp anywhere in the admin area to bucket. Re-scoping it to the
 * selected range would mean scaling a number by a ratio, which is a guess
 * wearing a chart's clothes.
 */
export function derivePrescriptionVolume(sources: ReportSources): ReportWidget {
  const windowDays = Math.max(
    0,
    ...sources.doctors.map((doctor) => doctor.activity?.windowDays ?? 0),
  );

  const bySpecialty = new Map<string, number>();
  for (const doctor of sources.doctors) {
    // A record with no activity counts contributes nothing rather than a 0
    // that would read as "issued none".
    if (doctor.activity === null) continue;
    bySpecialty.set(
      doctor.specialty,
      (bySpecialty.get(doctor.specialty) ?? 0) + doctor.activity.prescriptionsIssued,
    );
  }

  const rows = [...bySpecialty.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SPECIALTY_LIMIT + 1);

  const total = rows.reduce((running, [, value]) => running + value, 0);

  return widget({
    id: 'prescription-volume',
    title: 'Prescription volume',
    caption:
      'Prescriptions issued per specialty, from each doctor’s activity record. Counts only — no medication, dose or patient appears here.',
    rangeOverride: windowDays > 0 ? `Last ${windowDays.toString()} days` : 'Reported window',
    visual: {
      kind: 'bar',
      categoryLabel: 'Specialty',
      valueLabel: 'Prescriptions',
      format: 'count',
      series: {
        name: 'Prescriptions',
        tone: 'chart2',
        points: rows.map(([specialty, value]) => ({ label: specialty, value })),
      },
    },
    summary: summary('Prescriptions issued', total, 'count', 'neutral'),
    drillTo: routes.admin.doctors,
    drillLabel: 'Open doctors',
    empty: {
      when: total === 0,
      reason: 'No doctor’s activity record reports a prescription in its reported window.',
    },
  });
}

/* ── System performance ───────────────────────────────────────── */

/**
 * Uptime per service, with whatever p95 the platform monitor actually logged.
 *
 * §3.8 asks for latency *percentiles*. The only latency this client can see is
 * the p95 samples the monitor writes into the system log when a service
 * degrades, plus one instantaneous API figure on the platform-status record —
 * a distribution cannot be reconstructed from that, so the annotation reports
 * the observed samples and the report note says what is missing. Uptime itself
 * is served rather than derived, and carries ADM-01's caveat: no telemetry
 * backend exists behind it.
 */
export function deriveUptimeLatency(sources: ReportSources, range: ReportRange): ReportWidget {
  const samples = new Map<string, number[]>();
  for (const event of sources.logEvents) {
    if (event.type !== 'service-degraded' || !inRange(range, event.at)) continue;
    const service = event.payload.service;
    const p95 = event.payload.p95Ms;
    if (typeof service !== 'string' || typeof p95 !== 'number') continue;
    samples.set(service, [...(samples.get(service) ?? []), p95]);
  }

  const worstP95 = (serviceId: string): string => {
    const observed = samples.get(serviceId) ?? [];
    return observed.length === 0 ? '—' : formatValue('ms', Math.max(...observed));
  };

  return widget({
    id: 'uptime-latency',
    title: 'API uptime & latency',
    caption:
      'Rolling uptime per service. The latency column is the worst p95 the monitor logged for that service in this period — a sample, not a distribution.',
    visual: {
      kind: 'bar',
      categoryLabel: 'Service',
      valueLabel: 'Uptime',
      format: 'percent',
      series: {
        name: 'Uptime',
        tone: 'chart1',
        points: sources.services.map((service) => ({
          label: service.name,
          value: service.uptimePercent,
        })),
      },
      barTones: sources.services.map((service): AnalyticsTone =>
        service.status === 'operational' ? 'chart1' : 'warning',
      ),
      annotations: [
        {
          column: 'Status',
          values: sources.services.map((service) => service.status),
        },
        {
          column: 'Worst p95 logged',
          values: sources.services.map((service) => worstP95(service.id)),
        },
      ],
    },
    summary: summary('Current API response', sources.system.apiResponseMs, 'ms', 'lower-better'),
    empty: {
      when: sources.services.length === 0,
      reason: 'The platform monitor reported no services.',
    },
  });
}

/**
 * Logged service failures per bucket.
 *
 * Deliberately a **count and not a rate**: an error rate needs a request
 * count, and nothing in this client emits one. Presenting failures over an
 * invented denominator would produce a percentage that looks authoritative and
 * means nothing, so the axis says what it is counting.
 */
export function deriveErrorRate(sources: ReportSources, range: ReportRange): ReportWidget {
  const degraded = emptyCounts(range);
  const failed = emptyCounts(range);

  for (const event of sources.logEvents) {
    const index = bucketIndexOf(range, event.at);
    if (index < 0) continue;
    if (event.type === 'service-degraded') degraded[index] = (degraded[index] ?? 0) + 1;
    if (event.type === 'integration-failed') failed[index] = (failed[index] ?? 0) + 1;
  }

  const total = sum(degraded) + sum(failed);

  return widget({
    id: 'error-rate',
    title: 'Error trend',
    caption:
      'Service degradations and integration failures the platform logged. A true error *rate* needs a request count nothing here emits — these are absolute counts.',
    visual: {
      kind: 'line',
      categoryLabel: 'Period',
      format: 'count',
      series: [
        { name: 'Degradations', tone: 'warning', points: pointsOf(range, degraded) },
        { name: 'Integration failures', tone: 'error', points: pointsOf(range, failed) },
      ],
    },
    summary: summary('Failures logged', total, 'count', 'lower-better'),
    drillTo: `${routes.admin.logs}?severity=critical`,
    drillLabel: 'Investigate in system logs',
    empty: { when: total === 0, reason: 'The platform logged no service failure in this period.' },
  });
}

/**
 * Notification delivery success per bucket, from the receipts ADM-05 keeps.
 *
 * The one system-performance widget with a genuinely real source: every
 * appointment carries per-party delivery receipts, so this is measured rather
 * than served. `sent` counts as success — the provider accepted it — while
 * `pending` does not, because an unconfirmed notification is exactly the one a
 * reader wants separated from a delivered one.
 */
export function deriveNotificationDelivery(
  sources: ReportSources,
  range: ReportRange,
): ReportWidget {
  const delivered = emptyCounts(range);
  const pending = emptyCounts(range);
  const failed = emptyCounts(range);

  for (const appointment of sources.appointments) {
    for (const notification of appointment.notifications) {
      const index = bucketIndexOf(range, notification.at);
      if (index < 0) continue;
      if (notification.status === 'delivered' || notification.status === 'sent') {
        delivered[index] = (delivered[index] ?? 0) + 1;
      } else if (notification.status === 'failed') {
        failed[index] = (failed[index] ?? 0) + 1;
      } else {
        pending[index] = (pending[index] ?? 0) + 1;
      }
    }
  }

  const totals = range.buckets.map(
    (_, index) => (delivered[index] ?? 0) + (pending[index] ?? 0) + (failed[index] ?? 0),
  );
  const rates = totals.map((total, index) => round1(percent(delivered[index] ?? 0, total)));
  const grandTotal = sum(totals);

  return widget({
    id: 'notification-delivery',
    title: 'Notification delivery',
    caption:
      'Share of appointment notifications the provider accepted or delivered, per period. Pending receipts count against the rate.',
    visual: {
      kind: 'bar',
      categoryLabel: 'Period',
      valueLabel: 'Delivery success',
      format: 'percent',
      series: {
        name: 'Delivery success',
        tone: 'chart1',
        points: pointsOf(range, rates),
      },
      annotations: [
        { column: 'Delivered', values: delivered },
        { column: 'Pending', values: pending },
        { column: 'Failed', values: failed },
      ],
    },
    summary: summary(
      'Delivery success',
      percent(sum(delivered), grandTotal),
      'percent',
      'higher-better',
    ),
    empty: {
      when: grandTotal === 0,
      reason: 'No notification receipt falls in this period.',
    },
  });
}

/**
 * Storage as it stands, because growth over time has no source.
 *
 * The platform-status record carries one instantaneous pair of figures. A
 * series would need a history nothing keeps, so this reports the current
 * position and the report note says what a growth curve would require. Same
 * caveat as every other served figure on this tab: it is mock-served.
 */
export function deriveStorageGrowth(sources: ReportSources): ReportWidget {
  const { storageUsedGb, storageTotalGb } = sources.system;
  const free = Math.max(0, storageTotalGb - storageUsedGb);

  return widget({
    id: 'storage-growth',
    title: 'Storage',
    caption:
      'Current platform storage. Growth over time needs a metrics history the platform does not keep — this is the position now.',
    rangeOverride: 'Current',
    visual: {
      kind: 'facts',
      facts: [
        { label: 'Used', value: formatValue('gb', storageUsedGb), hint: null },
        { label: 'Free', value: formatValue('gb', free), hint: null },
        { label: 'Total', value: formatValue('gb', storageTotalGb), hint: null },
        {
          label: 'Utilisation',
          value: formatValue('percent', percent(storageUsedGb, storageTotalGb)),
          hint: 'Used against provisioned capacity.',
        },
      ],
    },
    summary: summary(
      'Storage used',
      percent(storageUsedGb, storageTotalGb),
      'percent',
      'lower-better',
    ),
    drillTo: routes.admin.settings('integrations'),
    drillLabel: 'Manage storage integration',
    empty: { when: storageTotalGb === 0, reason: 'The platform reported no provisioned storage.' },
  });
}

/* ── Report assembly ──────────────────────────────────────────── */

/*
 * Restated when D-10…D-14 landed. The lab inbox it shipped *does* carry the
 * timestamps this widget would need — so the honest reason is no longer "the
 * data does not exist" but "it is not reachable from here", which is a
 * different handoff and points at a different fix.
 */
const LAB_TURNAROUND_REASON =
  'The lab inbox shipped by D-10…D-14 does carry collection, receipt and review timestamps — but it is a doctor-area store, and a feature module may not read another’s data (FRONTEND_ARCHITECTURE §3.4), so those rows are not reachable from the admin area. The only source on this side is a doctor’s activity record, which counts results reviewed and never says when an order was placed. A platform-wide turnaround figure needs a laboratory service both areas read.';

const AI_USAGE_REASON =
  'The AI assistant is served entirely from mocks and nothing meters it. Request volume and latency need the model service (dependency register §9, row 4); the service-health tile above reports only whether it answers.';

const REPORT_NOTES: Record<ReportId, readonly string[]> = {
  growth: [
    'Geographic distribution is a multi-clinic widget (§3.8, “if multi-clinic”). This deployment models one clinic, so it is deliberately absent rather than rendered empty.',
  ],
  utilization: [],
  clinical: [],
  system: [
    'Service health, uptime and storage are mock-served — no telemetry backend exists behind them, the same caveat the admin overview carries. Notification delivery is the one figure on this tab measured from a real store.',
    'Latency percentiles need a metrics backend that keeps a distribution. The samples shown are the individual p95 readings the monitor wrote to the system log.',
  ],
};

/** Builds one report tab, without comparisons. See `withComparisons`. */
export function buildReport(
  id: ReportId,
  sources: ReportSources,
  range: ReportRange,
): ReportDocument {
  const widgets: readonly ReportWidget[] =
    id === 'growth'
      ? [
          deriveUserGrowth(sources, range),
          deriveNetNew(sources, range),
          deriveActivation(sources, range),
          deriveRetentionCohorts(sources),
        ]
      : id === 'utilization'
        ? [
            deriveAppointmentVolume(sources, range),
            deriveVolumeBySpecialty(sources, range),
            deriveBookingFunnel(sources, range),
            derivePeakHours(sources, range),
            deriveCapacityVsDemand(sources),
          ]
        : id === 'clinical'
          ? [
              deriveResponseTime(sources, range),
              deriveOutcomeRates(sources, range),
              derivePrescriptionVolume(sources),
              unavailable(
                'lab-turnaround',
                'Lab turnaround time',
                'Time from a laboratory order being placed to its result being available.',
                LAB_TURNAROUND_REASON,
              ),
            ]
          : [
              deriveUptimeLatency(sources, range),
              deriveErrorRate(sources, range),
              deriveNotificationDelivery(sources, range),
              unavailable(
                'ai-usage',
                'AI service usage & latency',
                'Assistant requests and how long the model took to answer them.',
                AI_USAGE_REASON,
              ),
              deriveStorageGrowth(sources),
            ];

  return { id, range, compare: false, widgets, notes: REPORT_NOTES[id] };
}

/**
 * Folds a previous-window document into the current one as per-widget deltas.
 *
 * Matched by widget id rather than by position, so a widget that is `empty` in
 * one window and `ready` in the other cannot shift the pairing and hand a
 * widget somebody else's previous value.
 */
export function withComparisons(current: ReportDocument, previous: ReportDocument): ReportDocument {
  const previousById = new Map(previous.widgets.map((entry) => [entry.id, entry]));

  return {
    ...current,
    compare: true,
    widgets: current.widgets.map((entry) => {
      /*
       * A widget that carries a `rangeOverride` is not scoped by the range the
       * comparison shifts — a live capacity snapshot, a six-month cohort grid,
       * a doctor-reported activity window, a current storage figure. Building
       * the previous document moves the range, that widget returns the same
       * number, and the delta renders as a confident "0% vs previous period"
       * on a figure that was never capable of moving. Withholding it is the
       * only honest reading; the chip already tells the reader why.
       */
      if (entry.rangeOverride !== null) return entry;

      const before = previousById.get(entry.id)?.summary ?? null;
      const previousRaw = before === null ? null : before.raw;
      if (entry.summary === null || entry.summary.raw === null || previousRaw === null) {
        return entry;
      }
      return {
        ...entry,
        summary: { ...entry.summary, comparison: compare(entry.summary, previousRaw) },
      };
    }),
  };
}

function compare(current: WidgetSummary, previousRaw: number): WidgetSummary['comparison'] {
  const currentRaw = current.raw ?? 0;
  // A previous window of zero has no ratio to report. The value is still shown
  // — "was 0" is informative — but the percentage is withheld rather than
  // rendered as an infinite or arbitrarily large jump.
  const deltaPercent =
    previousRaw === 0 ? null : round1(((currentRaw - previousRaw) / Math.abs(previousRaw)) * 100);

  const movedUp = currentRaw > previousRaw;
  const flat = currentRaw === previousRaw;
  const sentiment: 'good' | 'bad' | 'neutral' =
    flat || current.direction === 'neutral'
      ? 'neutral'
      : (movedUp && current.direction === 'higher-better') ||
          (!movedUp && current.direction === 'lower-better')
        ? 'good'
        : 'bad';

  return {
    previousValue: formatValue(formatOf(current), previousRaw),
    deltaPercent,
    sentiment,
  };
}

/**
 * Recovers the format a summary was written with, so the comparison value is
 * spelled the same way as the value it is compared against.
 *
 * Read back off the formatted string rather than stored a second time: the
 * summary already carries the rendering, and a duplicated `format` field is
 * one more thing to keep in step with it.
 */
function formatOf(entry: WidgetSummary): ValueFormat {
  if (entry.value.endsWith('%')) return 'percent';
  if (entry.value.endsWith('ms')) return 'ms';
  if (entry.value.endsWith('GB')) return 'gb';
  if (entry.value.endsWith(' h') || entry.value.endsWith('min')) return 'hours';
  return 'count';
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/* ── Scheduled reports ────────────────────────────────────────── */

/** A conservative address check — enough to catch a typo, not an RFC parser. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseRecipients(raw: string): readonly string[] {
  return raw
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export interface ScheduleValidation {
  readonly ok: boolean;
  readonly nameError: string | null;
  readonly recipientsError: string | null;
}

export function validateSchedule(draft: ScheduleDraft): ScheduleValidation {
  const nameError = draft.name.trim().length === 0 ? 'Give the schedule a name.' : null;

  const invalid = draft.recipients.filter((entry) => !EMAIL.test(entry));
  const recipientsError =
    draft.recipients.length === 0
      ? 'Add at least one recipient.'
      : invalid.length > 0
        ? `Not an email address: ${invalid.join(', ')}`
        : null;

  return { ok: nameError === null && recipientsError === null, nameError, recipientsError };
}

/**
 * The next delivery after `fromMs`, at 07:00 local.
 *
 * A fixed hour rather than "now plus a day": a daily report that arrives at
 * whatever minute somebody happened to create it is not a schedule anybody can
 * build a morning around.
 */
export function nextRunAfter(frequency: ScheduleFrequency, fromMs: number): string {
  const at = new Date(startOfDay(fromMs));
  at.setHours(7, 0, 0, 0);

  if (frequency === 'daily') {
    if (at.getTime() <= fromMs) at.setDate(at.getDate() + 1);
    return at.toISOString();
  }
  if (frequency === 'weekly') {
    // Next Monday, so a weekly report covers a whole week rather than a
    // fragment of the current one.
    const daysToMonday = (8 - at.getDay()) % 7 || 7;
    at.setDate(at.getDate() + daysToMonday);
    return at.toISOString();
  }
  at.setMonth(at.getMonth() + 1, 1);
  return at.toISOString();
}

/** Schedules whose last attempt failed — the §3.8 notification trigger. */
export function failedSchedules(schedules: readonly ScheduledReport[]): readonly ScheduledReport[] {
  return schedules.filter((schedule) => schedule.lastRun?.status === 'failed');
}

/* ── Export naming ────────────────────────────────────────────── */

/** Kebab-cased and ASCII-safe, so the file name survives every filesystem. */
export function exportSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
