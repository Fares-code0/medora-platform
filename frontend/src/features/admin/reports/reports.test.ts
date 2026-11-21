import { describe, expect, it } from 'vitest';

import type { SystemHealth } from '../administration.types';
import type { OversightAppointment, PlatformDoctor } from '../appointments/oversight.types';
import type { DoctorRecord } from '../doctors/doctors.types';
import type { LogEvent } from '../logs/logs.types';
import type { ServiceHealth } from '../overview/overview.types';
import type { PatientAccount } from '../patients/patients.types';

import {
  buildReport,
  datasetOf,
  deriveActivation,
  deriveAppointmentVolume,
  deriveBookingFunnel,
  deriveCapacityVsDemand,
  deriveErrorRate,
  deriveNetNew,
  deriveNotificationDelivery,
  deriveOutcomeRates,
  derivePeakHours,
  derivePrescriptionVolume,
  deriveResponseTime,
  deriveRetentionCohorts,
  deriveStorageGrowth,
  deriveUptimeLatency,
  deriveUserGrowth,
  exportSlug,
  formatValue,
  nextRunAfter,
  parseRecipients,
  previousRange,
  resolveRange,
  validateSchedule,
  withComparisons,
  type ReportSources,
} from './reports';
import type { ReportDocument, ReportWidget, WidgetSummary, WidgetVisual } from './reports.types';

/**
 * ADM-08's arithmetic, tested where it lives.
 *
 * Everything on `/admin/reports` is a pure function of the other admin
 * modules' documents, so almost every claim worth making about this feature is
 * makeable here without a DOM, a service or a clock — which is the whole
 * reason the derivation sits in its own module. The claims that matter divide
 * in three: the range arithmetic is right at its boundaries, the chart / table
 * / export projections cannot disagree, and each widget counts the thing it
 * says it counts.
 */

/*
 * A fixed instant. Mid-month, mid-week, mid-afternoon, so no assertion here is
 * accidentally sitting on a month, week or day boundary — the places this
 * file's arithmetic is most likely to be wrong are exactly the places a
 * "today happens to be the 1st" test would stop covering.
 *
 * Local rather than UTC, because every bucket boundary is built from
 * `setHours`/`setDate`/`setMonth`, which walk the local calendar.
 */
const NOW = new Date(2026, 5, 17, 15, 0, 0).getTime(); // Wed 17 June 2026, 15:00

const DAY = 86_400_000;

function isoDaysAgo(days: number, hour = 10): string {
  const date = new Date(NOW - days * DAY);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

/* ── Fixtures ─────────────────────────────────────────────────── */

function doctor(overrides: Partial<DoctorRecord> = {}): DoctorRecord {
  return {
    id: 'doc-1',
    name: 'Amelia Chen',
    title: 'Dr',
    email: 'amelia@medora.health',
    phone: '+1 555 0100',
    specialty: 'Cardiology',
    licenseNumber: 'LIC-1',
    languages: ['English'],
    bio: '',
    joinedAt: isoDaysAgo(10),
    lastActiveAt: isoDaysAgo(1),
    verification: 'verified',
    verificationNote: null,
    account: 'active',
    suspensionReason: null,
    administrative: { roleTemplate: 'Doctor', clinic: 'Main' },
    patientsCount: 12,
    appointments30d: 30,
    rating: null,
    licenseExpiresAt: null,
    documents: [],
    logins: [
      {
        id: 'lg-1',
        at: isoDaysAgo(1),
        ip: '10.0.0.1',
        device: 'Chrome',
        location: 'Berlin',
        result: 'success',
        impossibleTravel: false,
      },
    ],
    activity: {
      recordsEdited: 4,
      prescriptionsIssued: 9,
      labsReviewed: 3,
      messagesSent: 6,
      windowDays: 30,
    },
    statistics: {
      patientsServed: 40,
      rating: 4.6,
      ratingDistribution: [0, 0, 1, 4, 20],
      avgResponseHours: 3,
      monthlyVolume: [],
    },
    audit: [],
    ...overrides,
  };
}

function patient(overrides: Partial<PatientAccount> = {}): PatientAccount {
  return {
    id: 'PT-1000',
    name: 'Jordan Blake',
    mrn: 'MRN-1000',
    email: 'jordan@example.test',
    phone: '+1 555 0200',
    dateOfBirth: '1990-01-01',
    status: 'active',
    lockCause: null,
    registeredAt: isoDaysAgo(20),
    lastActivityAt: isoDaysAgo(2),
    assignedDoctors: [],
    deactivationReason: null,
    grants: [],
    accessRequests: [],
    events: [{ id: 'ev-1', at: isoDaysAgo(2), kind: 'sign-in', detail: 'Signed in' }],
    flags: [],
    ...overrides,
  };
}

function appointment(overrides: Partial<OversightAppointment> = {}): OversightAppointment {
  return {
    id: 'apt-1',
    reference: 'APT-1',
    startsAt: isoDaysAgo(2, 9),
    durationMin: 30,
    visitType: 'Follow-up',
    department: 'Cardiology',
    specialty: 'Cardiology',
    doctorId: 'doc-1',
    doctorName: 'Amelia Chen',
    patientId: 'PT-1000',
    patientName: 'Jordan Blake',
    patientMrn: 'MRN-1000',
    status: 'completed',
    stateSince: isoDaysAgo(2, 10),
    rescheduleCount: 0,
    complaint: null,
    lastNudgedAt: null,
    events: [],
    notifications: [],
    ...overrides,
  };
}

function platformDoctor(overrides: Partial<PlatformDoctor> = {}): PlatformDoctor {
  return {
    id: 'doc-1',
    name: 'Amelia Chen',
    specialty: 'Cardiology',
    department: 'Cardiology',
    availability: 'available',
    openSlotsToday: 4,
    loadPercent: 50,
    note: null,
    ...overrides,
  };
}

function logEvent(overrides: Partial<LogEvent> = {}): LogEvent {
  return {
    id: 'log-1',
    at: isoDaysAgo(2),
    category: 'system',
    type: 'service-degraded',
    severity: 'warning',
    actor: 'Platform monitor',
    actorRole: 'system',
    target: 'svc-scheduling',
    action: 'Service degraded',
    summary: 'Latency elevated',
    ip: null,
    device: null,
    payload: { service: 'api', p95Ms: 800 },
    ...overrides,
  };
}

const SERVICES: readonly ServiceHealth[] = [
  {
    id: 'api',
    name: 'API',
    status: 'operational',
    uptimePercent: 99.9,
    lastCheckedAt: isoDaysAgo(0),
    incidentNote: null,
  },
  {
    id: 'notifications',
    name: 'Notifications',
    status: 'degraded',
    uptimePercent: 98.5,
    lastCheckedAt: isoDaysAgo(0),
    incidentNote: 'Retries elevated.',
  },
];

const SYSTEM: SystemHealth = {
  status: 'operational',
  uptimePercent: 99.9,
  cpuPercent: 30,
  ramPercent: 40,
  storageUsedGb: 120,
  storageTotalGb: 500,
  apiResponseMs: 180,
};

function sources(overrides: Partial<ReportSources> = {}): ReportSources {
  return {
    doctors: [doctor()],
    patients: [patient()],
    appointments: [appointment()],
    platformDoctors: [platformDoctor()],
    logEvents: [logEvent()],
    services: SERVICES,
    system: SYSTEM,
    now: NOW,
    ...overrides,
  };
}

const RANGE_30D = resolveRange('30d', NOW);

/** The visual of a widget the test expects to be `ready`. */
function visualOf(widget: ReportWidget): WidgetVisual {
  if (widget.visual === null) {
    throw new Error(`Expected "${widget.title}" to be ready, got ${widget.availability}`);
  }
  return widget.visual;
}

/* ── Range arithmetic ─────────────────────────────────────────── */

describe('resolveRange', () => {
  it('gives each key the bucket shape it claims', () => {
    expect(resolveRange('7d', NOW).buckets).toHaveLength(7);
    expect(resolveRange('30d', NOW).buckets).toHaveLength(30);
    expect(resolveRange('90d', NOW).buckets).toHaveLength(13);
    expect(resolveRange('12m', NOW).buckets).toHaveLength(12);

    expect(resolveRange('90d', NOW).bucket).toBe('week');
    expect(resolveRange('12m', NOW).bucket).toBe('month');
  });

  it('ends with the bucket that contains now, so today is inside the window', () => {
    for (const key of ['7d', '30d', '90d', '12m'] as const) {
      const range = resolveRange(key, NOW);
      const last = range.buckets.at(-1);
      expect(last).toBeDefined();
      expect(NOW).toBeGreaterThanOrEqual(last?.fromMs ?? 0);
      expect(NOW).toBeLessThan(last?.toMs ?? 0);
    }
  });

  /*
   * The bug this catches is a gap or an overlap between adjacent buckets,
   * which shows up as an appointment counted twice or not at all — and only
   * on the days at a boundary, which is why it survives casual inspection.
   */
  it('leaves no gap and no overlap between adjacent buckets', () => {
    for (const key of ['7d', '30d', '90d', '12m'] as const) {
      const { buckets } = resolveRange(key, NOW);
      for (let index = 1; index < buckets.length; index += 1) {
        expect(buckets[index]?.fromMs).toBe(buckets[index - 1]?.toMs);
      }
    }
  });

  it('cuts 12m into real calendar months rather than 30-day blocks', () => {
    const { buckets } = resolveRange('12m', NOW);
    for (const bucket of buckets) {
      const start = new Date(bucket.fromMs);
      const end = new Date(bucket.toMs);
      expect(start.getDate()).toBe(1);
      expect(end.getDate()).toBe(1);
      expect(start.getHours()).toBe(0);
    }
    // February is shorter than January; a fixed-width bucket would make them equal.
    const widths = new Set(buckets.map((bucket) => bucket.toMs - bucket.fromMs));
    expect(widths.size).toBeGreaterThan(1);
  });
});

describe('previousRange', () => {
  it('abuts the current window without overlapping it', () => {
    for (const key of ['7d', '30d', '90d', '12m'] as const) {
      const range = resolveRange(key, NOW);
      const before = previousRange(range);
      expect(before.toMs).toBe(range.fromMs);
      expect(before.buckets).toHaveLength(range.buckets.length);
    }
  });

  /*
   * `fromMs - (toMs - fromMs)` looks equivalent and is not, and the difference
   * only shows up when exactly one of the two windows contains a leap day.
   * Anchored in March 2024 on purpose: the current window then spans February
   * 2024 (366 days) and the previous one February 2023 (365), so the naive
   * subtraction lands on 31 March rather than 1 April and every monthly bucket
   * in the comparison is a day out. At `NOW` the two happen to coincide, which
   * is exactly why this assertion cannot be made there.
   */
  it('steps the calendar rather than subtracting the window width', () => {
    const inLeapYear = new Date(2024, 2, 15, 12, 0, 0).getTime();
    const range = resolveRange('12m', inLeapYear);
    const before = previousRange(range);
    const naive = range.fromMs - (range.toMs - range.fromMs);

    expect(before.fromMs).not.toBe(naive);
    expect(new Date(before.fromMs).getDate()).toBe(1);
    expect(new Date(before.fromMs).getMonth()).toBe(new Date(range.fromMs).getMonth());
  });
});

/* ── The one projection ───────────────────────────────────────── */

describe('datasetOf', () => {
  it('names a multi-series line’s columns after its series', () => {
    const dataset = datasetOf({
      kind: 'line',
      categoryLabel: 'Period',
      format: 'count',
      series: [
        { name: 'Doctors', tone: 'chart1', points: [{ label: 'Jun 1', value: 2 }] },
        { name: 'Patients', tone: 'chart2', points: [{ label: 'Jun 1', value: 5 }] },
      ],
    });

    expect(dataset.columns).toEqual(['Period', 'Doctors', 'Patients']);
    expect(dataset.rows).toEqual([['Jun 1', '2', '5']]);
  });

  it('carries a bar’s annotations into the table as extra columns', () => {
    const dataset = datasetOf({
      kind: 'bar',
      categoryLabel: 'Specialty',
      valueLabel: 'No-show rate',
      format: 'percent',
      series: { name: 'No-show', tone: 'chart1', points: [{ label: 'Cardiology', value: 12.5 }] },
      annotations: [
        { column: 'Completion', values: ['80%'] },
        { column: 'Concluded', values: [8] },
      ],
    });

    expect(dataset.columns).toEqual(['Specialty', 'No-show rate', 'Completion', 'Concluded']);
    expect(dataset.rows).toEqual([['Cardiology', '12.5%', '80%', 8]]);
  });

  /*
   * The reason `blankValue` exists at all. A future cohort month is not zero
   * retention, and "-1%" in an exported CSV is worse than the blank cell it
   * came from — a reader would take it for a real, negative figure.
   */
  it('writes a heatmap’s blank sentinel as an em dash, not as its number', () => {
    const dataset = datasetOf({
      kind: 'heatmap',
      categoryLabel: 'Cohort',
      format: 'percent',
      blankValue: -1,
      data: { rows: ['Jun 26'], columns: ['M0', 'M1'], cells: [[100, -1]], max: 100 },
    });

    expect(dataset.rows).toEqual([['Jun 26', '100%', '—']]);
  });

  it('keeps a real zero when there is no sentinel', () => {
    const dataset = datasetOf({
      kind: 'heatmap',
      categoryLabel: 'Hour',
      format: 'count',
      blankValue: null,
      data: { rows: ['08:00'], columns: ['Mon'], cells: [[0]], max: 0 },
    });

    expect(dataset.rows).toEqual([['08:00', '0']]);
  });
});

describe('formatValue', () => {
  it('spells each unit the way its axis does', () => {
    // Thin-space thousands, dot decimal (DEC-011).
    expect(formatValue('count', 1234)).toBe('1\u202F234');
    expect(formatValue('percent', 12.34)).toBe('12.3%');
    expect(formatValue('ms', 180.4)).toBe('180 ms');
    expect(formatValue('gb', 120.45)).toBe('120.5 GB');
  });

  /*
   * "0.5 h" is a figure a reader has to convert before it means anything, and
   * a response-time series spends most of its life under an hour.
   */
  it('drops below an hour into minutes', () => {
    expect(formatValue('hours', 0.5)).toBe('30 min');
    expect(formatValue('hours', 2.25)).toBe('2.3 h');
  });
});

/* ── Growth ───────────────────────────────────────────────────── */

describe('growth widgets', () => {
  it('counts user growth cumulatively, so the last point is the platform total', () => {
    const widget = deriveUserGrowth(
      sources({
        doctors: [
          doctor({ id: 'a', joinedAt: isoDaysAgo(400) }),
          doctor({ id: 'b', joinedAt: isoDaysAgo(3) }),
        ],
        patients: [patient({ id: 'PT-1', registeredAt: isoDaysAgo(400) })],
      }),
      RANGE_30D,
    );

    const visual = visualOf(widget);
    if (visual.kind !== 'line') throw new Error('expected a line');

    const doctors = visual.series.find((series) => series.name === 'Doctors');
    // The doctor who joined 400 days ago is outside the window and still
    // counted — a cumulative line that restarts at the range boundary is the
    // classic way to make a healthy platform look like it lost everyone.
    expect(doctors?.points[0]?.value).toBe(1);
    expect(doctors?.points.at(-1)?.value).toBe(2);
    expect(widget.summary?.value).toBe('3');
  });

  it('counts net-new only inside the window', () => {
    const widget = deriveNetNew(
      sources({
        doctors: [
          doctor({ id: 'a', joinedAt: isoDaysAgo(400) }),
          doctor({ id: 'b', joinedAt: isoDaysAgo(3) }),
        ],
        patients: [],
      }),
      RANGE_30D,
    );

    expect(widget.summary?.raw).toBe(1);
  });

  it('reports an empty period rather than a zero line', () => {
    const widget = deriveNetNew(
      sources({ doctors: [doctor({ joinedAt: isoDaysAgo(400) })], patients: [] }),
      RANGE_30D,
    );

    expect(widget.availability).toBe('empty');
    expect(widget.visual).toBeNull();
    expect(widget.note).toContain('Widen the range');
  });

  /*
   * The asymmetry this pins is deliberate: a doctor sitting in the
   * verification queue has signed in and is *not* activated, because they
   * cannot do the job yet. Using "has signed in" for both roles would count
   * them, and the cohort ADM-01's action queue exists to chase would
   * disappear into a healthy-looking number.
   */
  it('does not count an unverified doctor as activated, however often they sign in', () => {
    const widget = deriveActivation(
      sources({
        doctors: [doctor({ joinedAt: isoDaysAgo(3), verification: 'pending' })],
        patients: [],
      }),
      RANGE_30D,
    );

    expect(widget.summary?.raw).toBe(0);
  });

  it('counts a patient who booked but never signed in', () => {
    const widget = deriveActivation(
      sources({
        doctors: [],
        patients: [
          patient({
            registeredAt: isoDaysAgo(3),
            events: [{ id: 'e', at: isoDaysAgo(2), kind: 'booking-made', detail: 'Booked' }],
          }),
        ],
      }),
      RANGE_30D,
    );

    expect(widget.summary?.raw).toBe(100);
  });

  it('says there is no cohort rather than reporting 0% activation', () => {
    const widget = deriveActivation(sources({ doctors: [], patients: [] }), RANGE_30D);

    expect(widget.availability).toBe('empty');
    expect(widget.note).toContain('no cohort');
  });

  it('blanks cohort months that have not happened yet', () => {
    const widget = deriveRetentionCohorts(
      sources({ patients: [patient({ registeredAt: isoDaysAgo(5) })] }),
    );
    const visual = visualOf(widget);
    if (visual.kind !== 'heatmap') throw new Error('expected a heatmap');

    // This month's cohort has five future columns; none of them is 0%.
    const thisMonth = visual.data.cells.at(-1) ?? [];
    expect(thisMonth.slice(1)).toEqual([-1, -1, -1, -1, -1]);
    expect(widget.rangeOverride).toBe('Last 6 months');
  });
});

/* ── Utilization ──────────────────────────────────────────────── */

describe('utilization widgets', () => {
  it('counts cancellations in volume and excludes them from the heatmap', () => {
    const shared = {
      appointments: [
        appointment({ id: 'a', startsAt: isoDaysAgo(2, 9), status: 'completed' }),
        appointment({ id: 'b', startsAt: isoDaysAgo(2, 9), status: 'cancelled' }),
      ],
    };

    // "How much did the book move" includes the cancelled one — it consumed a
    // request, a notification and somebody's attention.
    expect(deriveAppointmentVolume(sources(shared), RANGE_30D).summary?.raw).toBe(2);
    // "Was the slot occupied" does not — it never took the capacity.
    expect(derivePeakHours(sources(shared), RANGE_30D).summary?.raw).toBe(1);
  });

  it('reads funnel stages from the transition history, not the current status', () => {
    const widget = deriveBookingFunnel(
      sources({
        appointments: [
          appointment({
            id: 'a',
            status: 'completed',
            // No `confirmed` in the events, but a completed appointment was
            // confirmed at some point — a status-only reading drops it out of
            // the middle stage and reports a funnel that widens.
            events: [
              {
                id: 'e',
                kind: 'requested',
                at: isoDaysAgo(4),
                actor: 'Jordan',
                actorRole: 'patient',
                detail: '',
              },
            ],
          }),
        ],
      }),
      RANGE_30D,
    );

    const visual = visualOf(widget);
    if (visual.kind !== 'distribution') throw new Error('expected a distribution');
    expect(visual.series.points.map((point) => point.value)).toEqual([1, 1, 1]);
    expect(widget.summary?.value).toBe('100%');
  });

  it('counts unanswered requests as demand, whatever date they were made', () => {
    const widget = deriveCapacityVsDemand(
      sources({
        platformDoctors: [platformDoctor({ openSlotsToday: 2 })],
        appointments: [
          // Not today, and still demand nobody has met.
          appointment({ id: 'p1', status: 'pending', startsAt: isoDaysAgo(-20, 9) }),
          appointment({ id: 'p2', status: 'pending', startsAt: isoDaysAgo(-25, 9) }),
          appointment({ id: 'p3', status: 'pending', startsAt: isoDaysAgo(-30, 9) }),
        ],
      }),
    );

    const visual = visualOf(widget);
    if (visual.kind !== 'bar') throw new Error('expected a bar');
    // capacity 2 (open slots, nothing booked today) against demand 3.
    expect(visual.series.points[0]?.value).toBe(150);
    // Over-subscribed, so the bar is an alarm rather than a category.
    expect(visual.barTones?.[0]).toBe('error');
    expect(widget.rangeOverride).toBe('Today');
  });
});

/* ── Clinical operations ──────────────────────────────────────── */

describe('clinical operations widgets', () => {
  it('averages request-to-confirmation over the bucket the request arrived in', () => {
    const widget = deriveResponseTime(
      sources({
        appointments: [
          appointment({
            id: 'a',
            events: [
              {
                id: 'r',
                kind: 'requested',
                at: isoDaysAgo(5, 9),
                actor: 'Jordan',
                actorRole: 'patient',
                detail: '',
              },
              {
                id: 'c',
                kind: 'confirmed',
                at: isoDaysAgo(5, 13),
                actor: 'Amelia',
                actorRole: 'doctor',
                detail: '',
              },
            ],
          }),
        ],
      }),
      RANGE_30D,
    );

    expect(widget.summary?.raw).toBe(4);
    expect(widget.summary?.direction).toBe('lower-better');
  });

  /*
   * A confirmation stamped before its request is corrupt history, not a
   * negative response time. Averaging it in drags the mean below zero, which
   * renders as a chart with no bars and a headline nobody can explain.
   */
  it('discards a confirmation that predates its request', () => {
    const widget = deriveResponseTime(
      sources({
        appointments: [
          appointment({
            id: 'a',
            events: [
              {
                id: 'r',
                kind: 'requested',
                at: isoDaysAgo(5, 13),
                actor: 'Jordan',
                actorRole: 'patient',
                detail: '',
              },
              {
                id: 'c',
                kind: 'confirmed',
                at: isoDaysAgo(5, 9),
                actor: 'Amelia',
                actorRole: 'doctor',
                detail: '',
              },
            ],
          }),
        ],
      }),
      RANGE_30D,
    );

    expect(widget.availability).toBe('empty');
  });

  it('puts all three outcome rates over one denominator', () => {
    const widget = deriveOutcomeRates(
      sources({
        appointments: [
          appointment({ id: 'a', status: 'completed' }),
          appointment({ id: 'b', status: 'completed' }),
          appointment({ id: 'c', status: 'cancelled' }),
          appointment({ id: 'd', status: 'no-show' }),
          // Still open, so it is not part of any outcome rate.
          appointment({ id: 'e', status: 'pending' }),
        ],
      }),
      RANGE_30D,
    );

    const dataset = datasetOf(visualOf(widget));
    expect(dataset.columns).toEqual([
      'Specialty',
      'No-show rate',
      'Completion',
      'Cancellation',
      'Concluded',
    ]);
    expect(dataset.rows[0]).toEqual(['Cardiology', '25%', '50%', '25%', 4]);
    expect(widget.summary?.value).toBe('25%');
  });

  it('drills a no-show into appointment oversight already filtered', () => {
    const widget = deriveOutcomeRates(sources(), RANGE_30D);
    expect(widget.drillTo).toBe('/admin/appointments?status=no-show');
  });

  it('labels prescription volume with the window its source actually covers', () => {
    const activity = doctor().activity;
    if (activity === null) throw new Error('fixture doctor has activity counts');
    const widget = derivePrescriptionVolume(
      sources({ doctors: [doctor({ activity: { ...activity, windowDays: 45 } })] }),
    );

    expect(widget.rangeOverride).toBe('Last 45 days');
    expect(widget.summary?.raw).toBe(9);
  });

  /*
   * The three-valued availability, at the point it matters. "No data for this
   * period" would tell an operator to widen the range; no range will ever
   * populate this widget, and the note has to say what would.
   */
  it('reports lab turnaround as unavailable, not as empty', () => {
    const report = buildReport('clinical', sources(), RANGE_30D);
    const lab = report.widgets.find((entry) => entry.id === 'lab-turnaround');

    expect(lab?.availability).toBe('unavailable');
    expect(lab?.note).toContain('laboratory service');
    expect(lab?.visual).toBeNull();
  });
});

/* ── System performance ───────────────────────────────────────── */

describe('system performance widgets', () => {
  it('reports the worst logged p95 per service and an em dash where none was logged', () => {
    const widget = deriveUptimeLatency(
      sources({
        logEvents: [
          logEvent({ id: 'l1', payload: { service: 'api', p95Ms: 800 } }),
          logEvent({ id: 'l2', payload: { service: 'api', p95Ms: 950 } }),
        ],
      }),
      RANGE_30D,
    );

    const dataset = datasetOf(visualOf(widget));
    expect(dataset.rows[0]).toEqual(['API', '99.9%', 'operational', '950 ms']);
    expect(dataset.rows[1]).toEqual(['Notifications', '98.5%', 'degraded', '—']);
  });

  it('counts logged failures rather than inventing an error rate', () => {
    const widget = deriveErrorRate(
      sources({
        logEvents: [
          logEvent({ id: 'l1', type: 'service-degraded' }),
          logEvent({ id: 'l2', type: 'integration-failed' }),
          // Not a service failure — a job that finished must not inflate the trend.
          logEvent({ id: 'l3', type: 'job-completed' }),
        ],
      }),
      RANGE_30D,
    );

    expect(widget.summary?.raw).toBe(2);
    expect(visualOf(widget).kind).toBe('line');
  });

  it('counts a pending notification against delivery success', () => {
    const widget = deriveNotificationDelivery(
      sources({
        appointments: [
          appointment({
            id: 'a',
            notifications: [
              {
                id: 'n1',
                party: 'patient',
                recipientLabel: 'Patient · APT-1',
                channel: 'email',
                status: 'delivered',
                at: isoDaysAgo(2),
                subject: 'Confirmed',
              },
              {
                id: 'n2',
                party: 'doctor',
                recipientLabel: 'Doctor · APT-1',
                channel: 'push',
                status: 'sent',
                at: isoDaysAgo(2),
                subject: 'Confirmed',
              },
              {
                id: 'n3',
                party: 'patient',
                recipientLabel: 'Patient · APT-1',
                channel: 'sms',
                status: 'pending',
                at: isoDaysAgo(2),
                subject: 'Reminder',
              },
              {
                id: 'n4',
                party: 'patient',
                recipientLabel: 'Patient · APT-1',
                channel: 'sms',
                status: 'failed',
                at: isoDaysAgo(2),
                subject: 'Reminder',
              },
            ],
          }),
        ],
      }),
      RANGE_30D,
    );

    // Two of four accepted: `sent` counts, `pending` does not.
    expect(widget.summary?.value).toBe('50%');
  });

  it('reports storage as a position and says the range does not apply', () => {
    const widget = deriveStorageGrowth(sources());
    const visual = visualOf(widget);
    if (visual.kind !== 'facts') throw new Error('expected facts');

    expect(visual.facts.map((fact) => fact.value)).toEqual(['120 GB', '380 GB', '500 GB', '24%']);
    expect(widget.rangeOverride).toBe('Current');
  });

  it('marks AI usage unavailable and names what would serve it', () => {
    const report = buildReport('system', sources(), RANGE_30D);
    const ai = report.widgets.find((entry) => entry.id === 'ai-usage');

    expect(ai?.availability).toBe('unavailable');
    expect(ai?.note).toContain('model service');
  });
});

/* ── Comparison ───────────────────────────────────────────────── */

describe('withComparisons', () => {
  const before = buildReport(
    'growth',
    sources({ doctors: [doctor({ id: 'a', joinedAt: isoDaysAgo(45) })], patients: [] }),
    previousRange(RANGE_30D),
  );
  const current = buildReport(
    'growth',
    sources({
      doctors: [
        doctor({ id: 'a', joinedAt: isoDaysAgo(45) }),
        doctor({ id: 'b', joinedAt: isoDaysAgo(3) }),
        doctor({ id: 'c', joinedAt: isoDaysAgo(4) }),
      ],
      patients: [],
    }),
    RANGE_30D,
  );

  it('pairs widgets by id rather than by position', () => {
    const merged = withComparisons(current, {
      ...before,
      // Reversed, so a position-based fold would hand every widget the wrong
      // previous value and still typecheck.
      widgets: [...before.widgets].reverse(),
    });

    const netNew = merged.widgets.find((entry) => entry.id === 'net-new');
    expect(netNew?.summary?.comparison?.previousValue).toBe('1');
  });

  it('reads a rise in a lower-is-better figure as bad news', () => {
    const slow = buildReport(
      'clinical',
      sources({
        appointments: [
          appointment({
            id: 'a',
            events: [
              {
                id: 'r',
                kind: 'requested',
                at: isoDaysAgo(5, 9),
                actor: 'J',
                actorRole: 'patient',
                detail: '',
              },
              {
                id: 'c',
                kind: 'confirmed',
                at: isoDaysAgo(5, 17),
                actor: 'A',
                actorRole: 'doctor',
                detail: '',
              },
            ],
          }),
        ],
      }),
      RANGE_30D,
    );
    const fast = buildReport(
      'clinical',
      sources({
        appointments: [
          appointment({
            id: 'a',
            events: [
              {
                id: 'r',
                kind: 'requested',
                at: isoDaysAgo(40, 9),
                actor: 'J',
                actorRole: 'patient',
                detail: '',
              },
              {
                id: 'c',
                kind: 'confirmed',
                at: isoDaysAgo(40, 11),
                actor: 'A',
                actorRole: 'doctor',
                detail: '',
              },
            ],
          }),
        ],
      }),
      previousRange(RANGE_30D),
    );

    const merged = withComparisons(slow, fast);
    const response = merged.widgets.find((entry) => entry.id === 'response-time');

    // 2h → 8h. Up on the axis, and worse for everybody waiting.
    expect(response?.summary?.comparison?.sentiment).toBe('bad');
    expect(response?.summary?.comparison?.deltaPercent).toBe(300);
  });

  /*
   * A specialty that had no no-shows last month and two this month. The
   * previous figure is a real, reported 0% — not an absent widget — so there
   * is a comparison to make and no ratio to make it with. Built by hand rather
   * than through `buildReport`, because almost every derivation turns an
   * all-zero window into an `empty` widget with no summary at all, and that
   * path is already covered below.
   */
  it('withholds the percentage when the previous window was zero', () => {
    const merged = withComparisons(
      documentWith({
        label: 'No-show rate',
        value: '25%',
        raw: 25,
        direction: 'lower-better',
        comparison: null,
      }),
      documentWith({
        label: 'No-show rate',
        value: '0%',
        raw: 0,
        direction: 'lower-better',
        comparison: null,
      }),
    );
    const comparison = merged.widgets[0]?.summary?.comparison;

    expect(comparison?.deltaPercent).toBeNull();
    expect(comparison?.previousValue).toBe('0%');
    // Still judged: more no-shows than none is bad news, ratio or no ratio.
    expect(comparison?.sentiment).toBe('bad');
  });

  it('reports a flat figure as neutral, whichever direction is better', () => {
    const merged = withComparisons(
      documentWith({
        label: 'No-show rate',
        value: '25%',
        raw: 25,
        direction: 'lower-better',
        comparison: null,
      }),
      documentWith({
        label: 'No-show rate',
        value: '25%',
        raw: 25,
        direction: 'lower-better',
        comparison: null,
      }),
    );

    expect(merged.widgets[0]?.summary?.comparison?.sentiment).toBe('neutral');
    expect(merged.widgets[0]?.summary?.comparison?.deltaPercent).toBe(0);
  });

  it('leaves a widget with no previous summary uncompared', () => {
    const merged = withComparisons(current, { ...before, widgets: [] });
    for (const entry of merged.widgets) {
      expect(entry.summary?.comparison ?? null).toBeNull();
    }
  });

  /*
   * Caught in the browser rather than here: with compare on, Prescription
   * volume showed "0% vs previous period (was 329)" beside its own "Last 30
   * days" chip. The figure is not scoped by the page's range at all, so
   * shifting the range cannot move it and the delta was a confident statement
   * about a number incapable of changing. Every range-free widget has the same
   * shape, so the rule is keyed on `rangeOverride` rather than on a list.
   */
  it('never compares a widget whose window is not the page’s range', () => {
    // Every tab that has one, so the rule is not accidentally satisfied by a
    // single widget that happened to be empty.
    for (const id of ['growth', 'utilization', 'clinical', 'system'] as const) {
      const merged = withComparisons(
        buildReport(id, sources(), RANGE_30D),
        buildReport(id, sources(), previousRange(RANGE_30D)),
      );
      const overridden = merged.widgets.filter((entry) => entry.rangeOverride !== null);
      expect(overridden.length, id).toBeGreaterThan(0);
      for (const entry of overridden) {
        expect(entry.summary?.comparison ?? null, `${id} · ${entry.title}`).toBeNull();
      }
    }
  });

  /*
   * The other half of the same rule: withholding the delta from range-free
   * widgets must not withhold it from the ones the range does scope. Asserted
   * on Growth, where the cumulative line has a figure in both windows.
   */
  it('still compares the widgets the range does scope', () => {
    const merged = withComparisons(current, before);

    expect(
      merged.widgets.find((entry) => entry.id === 'user-growth')?.summary?.comparison,
    ).not.toBeNull();
    expect(
      merged.widgets.find((entry) => entry.id === 'retention-cohorts')?.summary?.comparison ?? null,
    ).toBeNull();
  });
});

/** A one-widget document, for the comparison cases no derivation produces. */
function documentWith(summary: WidgetSummary): ReportDocument {
  return {
    id: 'clinical',
    range: RANGE_30D,
    compare: false,
    notes: [],
    widgets: [
      {
        id: 'outcome-rates',
        title: 'Outcome rates by specialty',
        caption: '',
        availability: 'ready',
        note: null,
        visual: {
          kind: 'bar',
          categoryLabel: 'Specialty',
          valueLabel: 'No-show rate',
          format: 'percent',
          series: { name: 'No-show rate', tone: 'chart1', points: [] },
        },
        summary,
        drillTo: null,
        drillLabel: null,
        rangeOverride: null,
      },
    ],
  };
}

/* ── Schedules ────────────────────────────────────────────────── */

describe('schedule helpers', () => {
  it('splits recipients on commas, semicolons and newlines', () => {
    expect(parseRecipients('a@b.co, c@d.co;\n e@f.co')).toEqual(['a@b.co', 'c@d.co', 'e@f.co']);
    expect(parseRecipients('   ')).toEqual([]);
  });

  it('names the address that is wrong rather than rejecting the list', () => {
    const result = validateSchedule({
      reportId: 'growth',
      name: 'Weekly',
      frequency: 'weekly',
      range: '30d',
      recipients: ['ok@medora.health', 'not-an-address'],
      format: 'pdf',
    });

    expect(result.ok).toBe(false);
    expect(result.recipientsError).toContain('not-an-address');
    expect(result.nameError).toBeNull();
  });

  it('refuses a schedule with no recipients or no name', () => {
    const base = {
      reportId: 'growth' as const,
      frequency: 'weekly' as const,
      range: '30d' as const,
      format: 'pdf' as const,
    };

    expect(validateSchedule({ ...base, name: 'x', recipients: [] }).recipientsError).toBe(
      'Add at least one recipient.',
    );
    expect(validateSchedule({ ...base, name: '  ', recipients: ['a@b.co'] }).nameError).toBe(
      'Give the schedule a name.',
    );
  });

  it('always schedules the next run in the future, at a fixed hour', () => {
    for (const frequency of ['daily', 'weekly', 'monthly'] as const) {
      const next = new Date(nextRunAfter(frequency, NOW));
      expect(next.getTime()).toBeGreaterThan(NOW);
      expect(next.getHours()).toBe(7);
    }
    // Weekly lands on a Monday, so the report covers a whole week.
    expect(new Date(nextRunAfter('weekly', NOW)).getDay()).toBe(1);
    // Monthly lands on the first.
    expect(new Date(nextRunAfter('monthly', NOW)).getDate()).toBe(1);
  });
});

describe('exportSlug', () => {
  it('reduces a title to a filesystem-safe stem', () => {
    expect(exportSlug('Clinical operations')).toBe('clinical-operations');
    expect(exportSlug('API uptime & latency')).toBe('api-uptime-latency');
  });
});

/* ── Report assembly ──────────────────────────────────────────── */

describe('buildReport', () => {
  it('gives every §3.8 tab its widgets', () => {
    expect(buildReport('growth', sources(), RANGE_30D).widgets.map((w) => w.id)).toEqual([
      'user-growth',
      'net-new',
      'activation-rate',
      'retention-cohorts',
    ]);
    expect(buildReport('utilization', sources(), RANGE_30D).widgets).toHaveLength(5);
    expect(buildReport('clinical', sources(), RANGE_30D).widgets).toHaveLength(4);
    expect(buildReport('system', sources(), RANGE_30D).widgets).toHaveLength(5);
  });

  /*
   * §3.8 lists a geographic-distribution widget "if multi-clinic". This
   * deployment models one clinic, so the widget is absent — and the note is
   * what stops that absence reading as an oversight.
   */
  it('says why geographic distribution is absent instead of leaving a hole', () => {
    const report = buildReport('growth', sources(), RANGE_30D);
    expect(report.notes.join(' ')).toContain('multi-clinic');
  });

  it('carries ADM-01’s mock-served caveat onto the performance tab', () => {
    const report = buildReport('system', sources(), RANGE_30D);
    expect(report.notes.join(' ')).toContain('mock-served');
  });

  it('starts uncompared', () => {
    expect(buildReport('growth', sources(), RANGE_30D).compare).toBe(false);
  });

  /*
   * The invariant the whole widget shell rests on: chart, table and export are
   * one projection. If a widget ever supplied a dataset of its own this would
   * be the test that stopped it.
   */
  it('gives every ready widget a dataset whose width matches its columns', () => {
    for (const id of ['growth', 'utilization', 'clinical', 'system'] as const) {
      for (const entry of buildReport(id, sources(), RANGE_30D).widgets) {
        if (entry.visual === null) continue;
        const dataset = datasetOf(entry.visual);
        expect(dataset.columns.length).toBeGreaterThan(0);
        for (const row of dataset.rows) {
          expect(row).toHaveLength(dataset.columns.length);
        }
      }
    }
  });
});
