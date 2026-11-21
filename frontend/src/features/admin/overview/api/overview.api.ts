/**
 * Admin Overview — mock service (ADM-01 · UX §3.1).
 *
 * Deliberately small. Everything an administrator can *act* on is derived in
 * `overview.ts` from the ADM-02/04/05 documents; this file covers only the
 * three things no store holds — platform telemetry, service health, and the
 * live active-user count. Storage and licence are *not* here: they already
 * exist on the `PlatformStatus` record, and the Storage & usage card reads
 * that one rather than a copy (spec §4.5).
 *
 * The series are generated rather than hand-listed so the range switch has
 * something real to switch, and every series shares one x-axis: three lines
 * on different day labels would be three charts stacked on top of each other.
 */

import type { NamedSeries, SeriesPoint } from '@/components/charts';
import { formatDateWith } from '@/i18n';

import type { ActivityRange, OverviewSignals, ServiceHealth } from '../overview.types';

const LATENCY_MS = 260;
const DAY_MS = 86_400_000;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const RANGE_DAYS: Record<ActivityRange, number> = { '7d': 7, '30d': 30 };

function dayLabels(days: number, now: number): readonly string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now - (days - 1 - index) * DAY_MS);
    return formatDateWith(date, { month: 'short', day: 'numeric' });
  });
}

/**
 * A smooth weekly-seasonal series — weekday peaks, weekend troughs — so the
 * chart reads like platform traffic instead of noise. Deterministic in the
 * index, so a re-render never reshuffles the line under the reader.
 */
function seasonal(labels: readonly string[], base: number, amplitude: number): readonly SeriesPoint[] {
  return labels.map((label, index) => {
    const weekly = Math.sin((index / 7) * Math.PI * 2);
    const drift = index * (amplitude / 40);
    return { label, value: Math.max(0, Math.round(base + weekly * amplitude + drift)) };
  });
}

/** Each service and how long before "now" its last check landed. */
const SERVICE_SEEDS: readonly (Omit<ServiceHealth, 'lastCheckedAt'> & {
  readonly checkedAgoMs: number;
})[] = [
  {
    id: 'api',
    name: 'API',
    status: 'operational',
    uptimePercent: 99.98,
    checkedAgoMs: 60_000,
    incidentNote: null,
  },
  {
    id: 'notifications',
    name: 'Notifications',
    status: 'degraded',
    uptimePercent: 99.2,
    checkedAgoMs: 120_000,
    incidentNote: 'SMS provider retries elevated since 09:40. Email unaffected.',
  },
  {
    id: 'ai',
    name: 'AI service',
    status: 'operational',
    uptimePercent: 99.7,
    checkedAgoMs: 90_000,
    incidentNote: null,
  },
  {
    id: 'storage',
    name: 'Storage',
    status: 'operational',
    uptimePercent: 100,
    checkedAgoMs: 45_000,
    incidentNote: null,
  },
];

/**
 * Built per call rather than once at module load. A fixed list would pin every
 * check to the moment the bundle was imported, so an admin who leaves the page
 * open watches System Health drift to "3 h ago" with neither the poll nor
 * Retry able to freshen it — a health check that reads as having stopped
 * running. The offsets are what is seeded; the clock is not.
 */
function servicesAt(now: number): readonly ServiceHealth[] {
  return SERVICE_SEEDS.map(({ checkedAgoMs, ...service }) => ({
    ...service,
    lastCheckedAt: new Date(now - checkedAgoMs).toISOString(),
  }));
}

/**
 * A permutation of -6..6: every value in the jitter range appears exactly
 * once per 13 calls. `activeUsers` walks it call-by-call instead of drawing
 * from `Math.random()`, so "moves between polls" is a guarantee rather than
 * a probability — six back-to-back calls (as the poll test makes, and as
 * `refetchInterval` makes in practice) can never land on six identical
 * values, where six independent random draws from a 13-value range
 * occasionally would.
 */
const JITTER_WALK: readonly number[] = [3, -4, 6, -1, 2, -6, 5, 0, -3, 4, -5, 1, -2];

let jitterIndex = 0;

function nextJitter(): number {
  const jitter = JITTER_WALK[jitterIndex % JITTER_WALK.length];
  jitterIndex += 1;
  return jitter ?? 0;
}

export const overviewApi = {
  signals: (range: ActivityRange): Promise<OverviewSignals> => {
    const now = Date.now();
    const labels = dayLabels(RANGE_DAYS[range], now);
    const activity: readonly NamedSeries[] = [
      // Three unrelated activity counts — categorical, not clinical. Booked
      // appointments were success-green purely from list position.
      { name: 'Daily active users', tone: 'chart1', points: seasonal(labels, 180, 45) },
      { name: 'Appointments booked', tone: 'chart2', points: seasonal(labels, 64, 22) },
      { name: 'Messages sent', tone: 'chart3', points: seasonal(labels, 120, 36) },
    ];
    return delay({ activity, services: servicesAt(now) });
  },

  /**
   * The one polled value on the page. Walks a fixed jitter so the KPI has
   * something to fade between; §3.1 forbids animating it as a count-up.
   *
   * Written as an arrow-function property (not method shorthand) so
   * `overviewApi.activeUsers` can be passed directly as `queryFn` without
   * `@typescript-eslint/unbound-method` flagging a possible `this` rebind —
   * the same reason every other mock service in this codebase does the same.
   */
  activeUsers: (): Promise<number> => {
    const base = 46;
    return delay(Math.max(0, base + nextJitter()));
  },
} as const;
