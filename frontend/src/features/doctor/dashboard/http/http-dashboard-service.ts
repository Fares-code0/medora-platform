import { Calendar, CalendarCheck, ClipboardList, Users } from 'lucide-react';

import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  malformedResponse,
  readArray,
  readData,
  readEnum,
  readNumber,
  readString,
} from '@/api/http';
import type { NamedSeries, Slice } from '@/components/charts';
import type { StatisticDelta, StatusKind } from '@/components/patterns';
import { httpPatientDirectory } from '@/features/shared-domain/patient-identity';
import { routes } from '@/routes';
import { isApiError } from '@/types/api';
import { formatTime } from '@/utils/dates';

import {
  CRITICAL_ALERT_KINDS,
  alertDetail,
  alertHref,
  type CriticalAlert,
  type CriticalAlertsAnswer,
} from '../model/critical-alerts';
import type {
  DashboardOverview,
  DashboardSection,
  DashboardService,
} from '../model/dashboard-service';
import { waitedFor } from '../model/elapsed';
import type {
  ActivityEntry,
  OverviewKpi,
  OverviewNotification,
  OverviewStatistic,
  ScheduleEntry,
} from '../model/mock-data';
import {
  ACTIVITY_KINDS,
  ACTIVITY_PRESENTATION,
  PULSE_WINDOW_DAYS,
  noShowRateStatistic,
  satisfactionSlices,
  trendSeries,
  type NoShowWindow,
} from '../model/pulse';

/**
 * The Overview over HTTP (FE-10.4).
 *
 * | Section          | Source                                              |
 * | ---------------- | --------------------------------------------------- |
 * | KPIs             | `GET /appointments/summary` + the patient directory |
 * | Today's schedule | `GET /appointments?from=…&to=…` (today, local)      |
 * | Decision list    | `GET /dashboard/doctor/action-queue` (API §16.2)    |
 * | Trend            | `GET /dashboard/doctor/trends` (M27.2, `backend` only) |
 * | Satisfaction     | `GET /dashboard/doctor/satisfaction` (M27.2, `backend` only) |
 * | Recent activity  | `GET /dashboard/doctor/recent-activity` (M27.2, `backend` only) |
 * | Practice pulse   | no-show rate only: four `GET /appointments` counts   |
 * | Critical alerts  | `GET /dashboard/doctor/critical-alerts` (M27.3, `backend` only), read by `getCriticalAlerts` |
 *
 * Practice pulse reads `totalItems` from the doctor's own book
 * (`GET /appointments?from=…&to=…[&status=no-show]&pageSize=1`) for the last
 * 30 days and the 30 before — exact counts, no rows. Consultation length and
 * request response time have no source on any branch (the appointment view
 * carries the booked duration, not the visit's), so they are never drawn.
 *
 * The first four are the core and fail together: an Overview with today's
 * schedule but no KPIs would be a page that cannot say which half is wrong.
 * The three M27 widgets and practice pulse are loaded beside them but
 * **apart** — the server built the M27 routes as independent routes for
 * exactly that reason, and the pulse follows the same rule. A 404 is what an
 * API built from `main` answers for a route it does not have, so it reads as
 * "no source" (`null`, "Not available yet"); any other failure is a failure
 * of that widget alone (`failedSections`), and the rest of the page renders.
 *
 * The KPIs carry no sparkline: a trend line drawn without a series behind
 * it would be decoration pretending to be data. One carries a delta —
 * "Completed this week" against last week, which its catalogue entry
 * promises — and only when `GET /dashboard/doctor/kpis` (M27.2, `backend`
 * only) answers: then the value *and* the delta are that route's, so they
 * come from one computation and one week. Otherwise (a 404 from `main`, or a
 * failure) the tile keeps the summary's figure and draws no comparison —
 * the figure is still true, and a delta is never invented beside it. Every
 * figure shown is one the server returned or one counted from rows it
 * returned.
 */

type QueueKind = 'appointment-request' | 'critical-lab' | 'unsigned-note' | 'stale-message';
type QueueUrgency = 'critical' | 'high' | 'normal';

const QUEUE_KINDS: readonly QueueKind[] = [
  'appointment-request',
  'critical-lab',
  'unsigned-note',
  'stale-message',
];
const URGENCIES: readonly QueueUrgency[] = ['critical', 'high', 'normal'];

const QUEUE_PRESENTATION: Readonly<
  Record<QueueKind, { readonly label: string; readonly href: (id: string) => string }>
> = {
  'appointment-request': { label: 'Request', href: (id) => routes.doctor.appointment(id) },
  'critical-lab': { label: 'Critical', href: (id) => routes.doctor.labReport(id) },
  'unsigned-note': { label: 'Unsigned', href: (id) => routes.doctor.medicalRecord(id) },
  'stale-message': { label: 'Message', href: () => routes.doctor.messages },
};

const URGENCY_STATUS: Readonly<Record<QueueUrgency, StatusKind>> = {
  critical: 'critical',
  high: 'pending',
  normal: 'info',
};

/** Appointment statuses that are still going to happen. */
const LIVE_STATUSES = new Set([
  'scheduled',
  'confirmed',
  'pending',
  'rescheduled',
  'awaiting-patient',
]);

const SCHEDULE_STATUS: Readonly<Record<string, { kind: StatusKind; label: string }>> = {
  scheduled: { kind: 'scheduled', label: 'Scheduled' },
  confirmed: { kind: 'confirmed', label: 'Confirmed' },
  pending: { kind: 'pending', label: 'Pending' },
  rescheduled: { kind: 'scheduled', label: 'Rescheduled' },
  'awaiting-patient': { kind: 'awaiting', label: 'Awaiting patient' },
  completed: { kind: 'completed', label: 'Completed' },
  cancelled: { kind: 'cancelled', label: 'Cancelled' },
  'no-show': { kind: 'rejected', label: 'No-show' },
};

function todayRange(now = new Date()): { from: string; to: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setMilliseconds(-1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function toAlert(value: unknown): OverviewNotification {
  const what = 'actionQueue.item';
  const dto = asRecord(value, what);
  const kind = readEnum(dto, 'kind', QUEUE_KINDS, what);
  const id = readString(dto, 'id', what);
  const label = readString(dto, 'label', what);
  const patient = dto.patient === null ? null : asRecord(dto.patient, `${what}.patient`);
  const presentation = QUEUE_PRESENTATION[kind];
  return {
    id,
    status: URGENCY_STATUS[readEnum(dto, 'urgency', URGENCIES, what)],
    statusLabel: presentation.label,
    text: patient === null ? label : `${label} — ${readString(patient, 'name', what)}`,
    time: waitedFor(readString(dto, 'waitingSince', what)),
    href: presentation.href(id),
  };
}

interface TodayRow {
  readonly entry: ScheduleEntry;
  readonly startsAt: number;
  readonly status: string;
}

function toScheduleRows(items: readonly unknown[]): readonly TodayRow[] {
  return items
    .map((value) => {
      const what = 'appointment';
      const dto = asRecord(value, what);
      const patient = asRecord(dto.patient, `${what}.patient`);
      const status = readString(dto, 'status', what);
      const dateTime = readString(dto, 'dateTime', what);
      const meta = SCHEDULE_STATUS[status] ?? { kind: 'info' as const, label: status };
      return {
        startsAt: new Date(dateTime).getTime(),
        status,
        entry: {
          id: readString(dto, 'id', what),
          time: formatTime(dateTime),
          patientName: readString(patient, 'name', what),
          patientAge: readNumber(patient, 'age', what),
          visitType: readString(dto, 'visitType', what),
          status: meta.kind,
          statusLabel: meta.label,
        },
      };
    })
    .sort((a, b) => a.startsAt - b.startsAt);
}

function toTrend(body: unknown): readonly NamedSeries[] {
  const what = 'trends';
  return trendSeries(
    (readData(body, what) as unknown[]).map((value) => {
      const dto = asRecord(value, `${what}.day`);
      return {
        day: readString(dto, 'day', what),
        completed: readNumber(dto, 'completed', what),
        cancelled: readNumber(dto, 'cancelled', what),
      };
    }),
  );
}

function toSatisfaction(body: unknown): readonly Slice[] {
  const what = 'satisfaction';
  const dto = asRecord(readData(body, what), what);
  return satisfactionSlices(
    readArray(dto, 'buckets', what).map((value) => {
      const bucket = asRecord(value, `${what}.bucket`);
      return {
        rating: readNumber(bucket, 'rating', what),
        count: readNumber(bucket, 'count', what),
      };
    }),
  );
}

function toActivity(body: unknown): readonly ActivityEntry[] {
  const what = 'recentActivity';
  return (readData(body, what) as unknown[]).map((value) => {
    const dto = asRecord(value, `${what}.entry`);
    const presentation = ACTIVITY_PRESENTATION[readEnum(dto, 'kind', ACTIVITY_KINDS, what)];
    return {
      id: readString(dto, 'id', what),
      icon: presentation.icon,
      text: readString(dto, 'text', what),
      time: waitedFor(readString(dto, 'at', what)),
      href: presentation.href,
    };
  });
}

interface WeekCompletion {
  readonly completedWeek: number;
  /** Signed: this week minus last week. */
  readonly completedWeekDelta: number;
}

function toWeekCompletion(body: unknown): WeekCompletion {
  const what = 'kpis';
  const dto = asRecord(readData(body, what), what);
  return {
    completedWeek: readNumber(dto, 'completedWeek', what),
    completedWeekDelta: readNumber(dto, 'completedWeekDelta', what),
  };
}

/** The tile's comparison, worded as the demo's: "2" up/down "vs last week". */
export function weekDelta(delta: number): StatisticDelta {
  if (delta === 0) {
    return { direction: 'flat', label: '0', tone: 'neutral', comparison: 'vs last week' };
  }
  return {
    direction: delta > 0 ? 'up' : 'down',
    label: String(Math.abs(delta)),
    // More completed visits is the good direction for this tile.
    tone: delta > 0 ? 'positive' : 'negative',
    comparison: 'vs last week',
  };
}

/** An ISO instant the client will do arithmetic on — unparseable is malformed. */
function readInstant(record: Record<string, unknown>, key: string, what: string): string {
  const value = readString(record, key, what);
  if (Number.isNaN(Date.parse(value))) throw malformedResponse(`${what}.${key}`);
  return value;
}

/**
 * The banner's body (`{ alerts, generatedAt }`), read strictly: an alert of
 * a kind this client does not know fails the whole answer rather than being
 * dropped, because a banner that quietly omits one is the failure it exists
 * to prevent.
 */
function toCriticalAlerts(body: unknown): readonly CriticalAlert[] {
  const what = 'criticalAlerts';
  const dto = asRecord(readData(body, what), what);
  const now = Date.now();
  return readArray(dto, 'alerts', what).map((value) => {
    const alert = asRecord(value, `${what}.alert`);
    const kind = readEnum(alert, 'kind', CRITICAL_ALERT_KINDS, what);
    return {
      id: readString(alert, 'id', what),
      kind,
      patientName: readString(alert, 'patientName', what),
      message: readString(alert, 'message', what),
      detail: alertDetail(kind, readInstant(alert, 'since', what), now),
      href: alertHref(kind, readString(alert, 'path', what)),
    };
  });
}

interface SectionResult<T> {
  readonly value: T | null;
  readonly failed: boolean;
}

/**
 * One independent widget. Never rejects: a 404 (the route is not served) is
 * no source, anything else — including a body that does not parse — is a
 * failure of this section alone.
 */
async function settleSection<T>(load: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    return { value: await load(), failed: false };
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') return { value: null, failed: false };
    return { value: null, failed: true };
  }
}

function loadSection<T>(path: string, parse: (body: unknown) => T): Promise<SectionResult<T>> {
  return settleSection(async () => parse(await apiClient.get(path)));
}

const DAY_MS = 86_400_000;

/** How many of the doctor's appointments started in `[from, to)` — the server's count. */
async function countAppointments(from: Date, to: Date, status?: 'no-show'): Promise<number> {
  const what = 'appointments count';
  const body = await apiClient.get('/appointments', {
    from: from.toISOString(),
    to: to.toISOString(),
    ...(status === undefined ? {} : { status }),
    page: 1,
    pageSize: 1,
  });
  return readNumber(asRecord(readData(body, what), what), 'totalItems', what);
}

async function noShowWindow(from: Date, to: Date): Promise<NoShowWindow> {
  const [noShows, appointments] = await Promise.all([
    countAppointments(from, to, 'no-show'),
    countAppointments(from, to),
  ]);
  return { noShows, appointments };
}

/** Practice pulse: the no-show rate, this window against the one before it. */
async function loadPulse(now: Date): Promise<readonly OverviewStatistic[]> {
  const span = PULSE_WINDOW_DAYS * DAY_MS;
  const start = new Date(now.getTime() - span);
  const [current, prior] = await Promise.all([
    noShowWindow(start, now),
    noShowWindow(new Date(start.getTime() - span), start),
  ]);
  return [noShowRateStatistic(current, prior)];
}

export const httpDashboardService: DashboardService = {
  async getOverview(): Promise<DashboardOverview> {
    const range = todayRange();
    // Started first and awaited last: they never reject, and they run in
    // parallel with the core rather than after it.
    const sections = Promise.all([
      loadSection('/dashboard/doctor/trends', toTrend),
      loadSection('/dashboard/doctor/satisfaction', toSatisfaction),
      loadSection('/dashboard/doctor/recent-activity', toActivity),
      loadSection('/dashboard/doctor/kpis', toWeekCompletion),
      settleSection(() => loadPulse(new Date())),
    ]);
    const [summaryBody, todayItems, queueBody, patients] = await Promise.all([
      apiClient.get('/appointments/summary'),
      fetchAllPages(
        (page, pageSize) =>
          apiClient.get('/appointments', { ...range, page, pageSize, sort: 'startsAt:asc' }),
        'appointments today',
      ),
      apiClient.get('/dashboard/doctor/action-queue'),
      httpPatientDirectory.listPatients(),
    ]);

    const summary = asRecord(readData(summaryBody, 'appointments summary'), 'summary');
    const queue = asRecord(readData(queueBody, 'action queue'), 'actionQueue');

    const now = Date.now();
    const rows = toScheduleRows(todayItems);
    const nextIndex = rows.findIndex((row) => row.startsAt >= now && LIVE_STATUSES.has(row.status));
    const schedule = rows.map((row, index) =>
      index === nextIndex ? { ...row.entry, isNext: true } : row.entry,
    );
    const next = rows[nextIndex];
    const completedToday = rows.filter((row) => row.status === 'completed').length;

    // One figure for "requests awaiting you", so the greeting and the KPI
    // beneath it cannot disagree.
    const pendingRequests = readNumber(summary, 'pending', 'summary');
    const alerts = readArray(queue, 'items', 'actionQueue').map(toAlert);
    const firstRequest = alerts.find((alert) => alert.statusLabel === 'Request');

    const active = patients.filter((patient) => patient.status !== 'discharged');
    const critical = active.filter((patient) => patient.status === 'critical').length;
    const highRisk = active.filter((patient) => patient.riskLevel === 'high').length;

    const kpis: readonly OverviewKpi[] = [
      {
        id: 'appointments-today',
        label: "Today's appointments",
        value: String(readNumber(summary, 'today', 'summary')),
        icon: Calendar,
        tone: 'primary',
        caption: `${next === undefined ? 'None still ahead' : `Next at ${next.entry.time}`} · ${String(completedToday)} completed`,
        href: routes.doctor.appointments,
      },
      {
        id: 'pending-requests',
        label: 'Pending requests',
        value: String(pendingRequests),
        icon: ClipboardList,
        tone: 'warning',
        ...(firstRequest === undefined ? {} : { caption: firstRequest.text }),
        href: routes.doctor.appointments,
      },
      {
        id: 'total-patients',
        label: 'Active patients',
        value: String(active.length),
        icon: Users,
        tone: 'info',
        caption: `${String(critical)} critical · ${String(highRisk)} high risk`,
        href: routes.doctor.patients,
      },
      {
        id: 'completed-week',
        label: 'Completed this week',
        value: String(readNumber(summary, 'completedThisWeek', 'summary')),
        icon: CalendarCheck,
        tone: 'success',
        href: routes.doctor.reports,
      },
    ];

    const [trend, satisfaction, activity, week, pulse] = await sections;
    const completion = week.value;
    const kpisWithWeek =
      completion === null
        ? kpis
        : kpis.map((kpi) =>
            kpi.id === 'completed-week'
              ? {
                  ...kpi,
                  value: String(completion.completedWeek),
                  delta: weekDelta(completion.completedWeekDelta),
                }
              : kpi,
          );
    const failedSections: DashboardSection[] = [];
    if (trend.failed) failedSections.push('trend');
    if (satisfaction.failed) failedSections.push('satisfaction');
    if (activity.failed) failedSections.push('activity');
    if (pulse.failed) failedSections.push('pulse');

    return {
      kpis: kpisWithWeek,
      schedule,
      pendingRequests,
      alerts,
      statistics: pulse.value,
      trend: trend.value,
      satisfaction: satisfaction.value,
      activity: activity.value,
      failedSections,
    };
  },

  async getCriticalAlerts(): Promise<CriticalAlertsAnswer> {
    let body: unknown;
    try {
      body = await apiClient.get('/dashboard/doctor/critical-alerts');
    } catch (error) {
      // The route takes no parameters, so a 404 can only mean it is not
      // served — an API built from `main`. Nothing was checked; anything
      // else is a failure and propagates.
      if (isApiError(error) && error.kind === 'not_found') return { served: false };
      throw error;
    }
    return { served: true, alerts: toCriticalAlerts(body) };
  },
};
