import { FileText, FlaskConical, Pill, type LucideIcon } from 'lucide-react';

import type { NamedSeries, SemanticTone, Slice } from '@/components/charts';
import { routes } from '@/routes';

import type { OverviewStatistic } from './mock-data';

/**
 * The analytics and activity widgets' vocabulary (RM M27.2), shared by the
 * demo fixtures and the HTTP adapter so the two cannot draw the same server
 * fact two ways — and the practice pulse's no-show rate, the one pulse
 * metric the API's counts can source.
 *
 * The server sends facts, not presentation (`dashboard.service.ts`: "every
 * entry carries its instant and the client formats it"): a day key, five
 * rating buckets, an activity kind. Labels, tones, icons and links are
 * chosen here.
 */

/* ── Appointments trend ─────────────────────────────────────────── */

export interface TrendDay {
  /** `YYYY-MM-DD`, the server's (UTC) day. */
  readonly day: string;
  readonly completed: number;
  readonly cancelled: number;
}

/**
 * Completed and cancelled per day, labelled by day of the month as the
 * widget always was. Every day the server sent is kept, quiet ones included
 * — it sends all fourteen so a quiet day does not vanish from the axis.
 */
export function trendSeries(days: readonly TrendDay[]): readonly NamedSeries[] {
  const label = (day: string) => String(Number(day.slice(8, 10)));
  return [
    {
      name: 'Completed',
      tone: 'primary',
      points: days.map((entry) => ({ label: label(entry.day), value: entry.completed })),
    },
    {
      name: 'Cancelled',
      tone: 'error',
      points: days.map((entry) => ({ label: label(entry.day), value: entry.cancelled })),
    },
  ];
}

/* ── Patient satisfaction ───────────────────────────────────────── */

export interface RatingBucket {
  /** 1–5. */
  readonly rating: number;
  readonly count: number;
}

/**
 * A satisfaction scale is one of the few charts where the colour *is* the
 * message (`SemanticTone`'s own rule), so the ramp runs from error at one
 * star to success at five.
 */
const RATING_TONES: Readonly<Record<number, SemanticTone>> = {
  5: 'success',
  4: 'primary',
  3: 'info',
  2: 'warning',
  1: 'error',
};

/**
 * Five stars first, every bucket kept — a histogram missing "1 star" because
 * nobody gave one reads as a scale that starts at 2. A month with no
 * responses is `[]`, which the widget shows as "no responses" rather than an
 * empty donut reading "0".
 */
export function satisfactionSlices(buckets: readonly RatingBucket[]): readonly Slice[] {
  if (buckets.every((bucket) => bucket.count === 0)) return [];
  return [...buckets]
    .sort((a, b) => b.rating - a.rating)
    .map((bucket) => ({
      label: `${String(bucket.rating)} ${bucket.rating === 1 ? 'star' : 'stars'}`,
      value: bucket.count,
      tone: RATING_TONES[bucket.rating] ?? 'secondary',
    }));
}

/* ── Recent activity ────────────────────────────────────────────── */

/** The three clinical sources the server's feed reads (`dashboard.repository.ts`). */
export const ACTIVITY_KINDS = ['note-signed', 'prescription-issued', 'lab-released'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/**
 * Where each kind is acted on. The feed's ids are internal row ids
 * (`note-<uuid>`), not the public ids a detail route takes, so a row opens
 * the module that owns its kind rather than guessing at a record.
 */
export const ACTIVITY_PRESENTATION: Readonly<
  Record<ActivityKind, { readonly icon: LucideIcon; readonly href: string }>
> = {
  'note-signed': { icon: FileText, href: routes.doctor.medicalRecords },
  'prescription-issued': { icon: Pill, href: routes.doctor.pharmacy },
  'lab-released': { icon: FlaskConical, href: routes.doctor.labs },
};

/* ── Practice pulse: the no-show rate ───────────────────────────── */

/** The pulse's window — the widget's subtitle promises "last 30 days". */
export const PULSE_WINDOW_DAYS = 30;

/**
 * The fewest appointments a window needs before its rate is compared with
 * another's. A one-in-three no-show rate against last month's one-in-four
 * is a "+8.3 pts" chip drawn from a single missed visit — noise presented as
 * movement. The rate itself is still shown, with its denominator beside it,
 * so a reader can weigh a small window for themselves.
 */
export const MIN_COMPARABLE_APPOINTMENTS = 10;

/** One window's two exact counts, both the server's (`totalItems`). */
export interface NoShowWindow {
  readonly noShows: number;
  /** Every appointment that started in the window, whatever its status. */
  readonly appointments: number;
}

/** Tenths of a percent, as an integer, so two rates subtract exactly. */
function rateInTenths(window: NoShowWindow): number {
  return Math.round((window.noShows / window.appointments) * 1000);
}

function tenthsLabel(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

/**
 * The no-show rate over the last {@link PULSE_WINDOW_DAYS} days, against the
 * window before it.
 *
 * The definition is the administrator's `noShowRate7d` (API §5.11) applied
 * to one doctor's book: no-shows over every appointment that *started* in
 * the window, whatever its status. The two counts are the server's; the
 * division is the only arithmetic done here.
 *
 * - An empty window has no rate: "—", and the caption says why.
 * - The caption always carries the denominator ("3 of 72 appointments").
 * - The comparison is drawn only when both windows hold at least
 *   {@link MIN_COMPARABLE_APPOINTMENTS}, and in percentage points: a rate
 *   going from 4% to 5% is "1.0 pts", not "25%". A rise is the bad direction.
 */
export function noShowRateStatistic(current: NoShowWindow, prior: NoShowWindow): OverviewStatistic {
  const label = `No-show rate (${String(PULSE_WINDOW_DAYS)}d)`;
  if (current.appointments === 0) {
    return {
      id: 'no-show-rate',
      label,
      value: '—',
      caption: `No appointments in the last ${String(PULSE_WINDOW_DAYS)} days`,
    };
  }

  const tenths = rateInTenths(current);
  const statistic: OverviewStatistic = {
    id: 'no-show-rate',
    label,
    value: `${tenthsLabel(tenths)}%`,
    caption: `${String(current.noShows)} of ${String(current.appointments)} ${
      current.appointments === 1 ? 'appointment' : 'appointments'
    }`,
  };

  if (
    current.appointments < MIN_COMPARABLE_APPOINTMENTS ||
    prior.appointments < MIN_COMPARABLE_APPOINTMENTS
  ) {
    return statistic;
  }

  const change = tenths - rateInTenths(prior);
  return {
    ...statistic,
    delta: {
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
      label: `${tenthsLabel(Math.abs(change))} pts`,
      tone: change > 0 ? 'negative' : change < 0 ? 'positive' : 'neutral',
      comparison: `vs previous ${String(PULSE_WINDOW_DAYS)} days`,
    },
  };
}
