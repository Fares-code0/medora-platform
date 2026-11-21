import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, pageOf, stubApi, json, type StubbedRequest } from '@/test/api-stub';

import type { DashboardOverview } from '../model/dashboard-service';
import { waitedFor } from '../model/elapsed';

import { httpDashboardService, weekDelta } from './http-dashboard-service';

/**
 * The Overview over HTTP (FE-10.4). The property that matters most: every
 * figure on the page is one the server returned or one counted from rows it
 * returned, and the sections it has no source for are `null` — never the
 * mock's seeded numbers.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const NOW = new Date('2026-10-04T10:00:00');

function todayAppointment(id: string, time: string, status: string) {
  return {
    id,
    patient: {
      id: 'PT-1003',
      name: `Patient ${id}`,
      mrn: 'm',
      phone: 'p',
      age: 40,
      gender: 'female',
    },
    dateTime: new Date(`2026-10-04T${time}:00`).toISOString(),
    durationMin: 30,
    visitType: 'Follow-up',
    department: null,
    doctorId: 'd',
    doctor: 'Dr. Amelia Chen',
    status,
    priority: 'normal',
    isNewPatient: false,
    isFollowUp: false,
    reason: 'r',
    notes: null,
    availableActions: [],
  };
}

function patientView(id: string, status: string, riskLevel: string) {
  return {
    id,
    mrn: 'm',
    fullName: id,
    dateOfBirth: '1980-01-01',
    age: 46,
    gender: 'male',
    bloodType: 'O+',
    phone: 'p',
    email: null,
    address: null,
    photoUrl: null,
    status,
    riskLevel,
    registeredAt: '2026-01-01T00:00:00Z',
    lastVisit: null,
    nextAppointment: null,
    assignedDoctor: null,
    allergies: [],
    hasSevereAllergy: false,
    hasPortalAccount: false,
  };
}

function routes(queueItems: unknown[] = []) {
  return {
    'GET /appointments/summary': () =>
      envelope({ today: 3, pending: 1, upcoming: 4, completedThisWeek: 7 }),
    'GET /appointments': () =>
      pageOf([
        todayAppointment('APT-2', '11:00', 'scheduled'),
        todayAppointment('APT-1', '09:00', 'completed'),
        todayAppointment('APT-3', '14:30', 'confirmed'),
      ]),
    'GET /dashboard/doctor/action-queue': () =>
      envelope({
        items: queueItems,
        counts: { appointmentRequests: 1, criticalLabs: 0, unsignedNotes: 0, staleMessages: 0 },
        totalItems: queueItems.length,
        truncated: false,
      }),
    'GET /patients': () =>
      pageOf([
        patientView('PT-1', 'critical', 'high'),
        patientView('PT-2', 'active', 'low'),
        patientView('PT-3', 'discharged', 'high'),
      ]),
    // What an API built from `main` answers: the M27 widget routes do not
    // exist there.
    ...M27_UNSERVED,
  };
}

const NOT_FOUND = () => json({ message: 'Cannot GET', code: 'not_found' }, 404);

const M27_UNSERVED = {
  'GET /dashboard/doctor/trends': NOT_FOUND,
  'GET /dashboard/doctor/satisfaction': NOT_FOUND,
  'GET /dashboard/doctor/recent-activity': NOT_FOUND,
  'GET /dashboard/doctor/kpis': NOT_FOUND,
};

/** The M27.2 bodies as `backend`'s `DashboardService` builds them. */
const TREND_DAYS = Array.from({ length: 14 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 8, 21 + index)).toISOString().slice(0, 10),
  completed: index % 3,
  cancelled: index === 4 ? 2 : 0,
}));

function m27Served(overrides: Record<string, () => unknown> = {}) {
  return {
    'GET /dashboard/doctor/trends': () => envelope(TREND_DAYS),
    'GET /dashboard/doctor/satisfaction': () =>
      envelope({
        total: 12,
        average: 4.3,
        buckets: [
          { rating: 1, count: 0 },
          { rating: 2, count: 1 },
          { rating: 3, count: 1 },
          { rating: 4, count: 3 },
          { rating: 5, count: 7 },
        ],
      }),
    'GET /dashboard/doctor/recent-activity': () =>
      envelope([
        {
          id: 'rx-9f1',
          kind: 'prescription-issued',
          at: new Date(NOW.getTime() - 20 * 60_000).toISOString(),
          text: 'Prescription issued — Metformin — Khaled Nassar',
        },
        {
          id: 'note-77a',
          kind: 'note-signed',
          at: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
          text: 'Consultation note signed — Mona Adel',
        },
        {
          id: 'lab-3c0',
          kind: 'lab-released',
          at: new Date(NOW.getTime() - 3 * 86_400_000).toISOString(),
          text: 'Lab result released — Lipid panel — Omar Farouk',
        },
      ]),
    ...overrides,
  };
}

describe('httpDashboardService.getOverview', () => {
  it('fills the KPIs from the summary and counts drawn from real rows', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { unmatched } = stubApi(routes());

    const overview = await httpDashboardService.getOverview();

    expect(unmatched).toEqual([]);
    expect(overview.kpis.map((kpi) => [kpi.id, kpi.value])).toEqual([
      ['appointments-today', '3'],
      ['pending-requests', '1'],
      ['total-patients', '2'],
      ['completed-week', '7'],
    ]);
    expect(overview.kpis.find((kpi) => kpi.id === 'total-patients')?.caption).toBe(
      '1 critical · 1 high risk',
    );
    expect(overview.pendingRequests).toBe(1);
  });

  it('draws no delta and no sparkline it has no series for (an API built from `main`)', async () => {
    stubApi(routes());

    const overview = await httpDashboardService.getOverview();

    for (const kpi of overview.kpis) {
      expect(kpi.delta).toBeUndefined();
      expect(kpi.sparkline).toBeUndefined();
    }
  });

  it('orders today’s schedule by time and marks the next live appointment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    stubApi(routes());

    const { schedule, kpis } = await httpDashboardService.getOverview();

    expect(schedule.map((entry) => [entry.id, entry.statusLabel, entry.isNext ?? false])).toEqual([
      ['APT-1', 'Completed', false],
      ['APT-2', 'Scheduled', true],
      ['APT-3', 'Confirmed', false],
    ]);
    expect(kpis[0]?.caption).toBe(`Next at ${schedule[1]?.time ?? '?'} · 1 completed`);
  });

  it('turns the action queue into decision rows that link where the decision is made', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    stubApi(
      routes([
        {
          id: 'LAB-9',
          kind: 'critical-lab',
          urgency: 'critical',
          label: 'Potassium 6.1 mmol/L awaiting review',
          patient: { id: 'PT-1004', name: 'Omar Farouk' },
          waitingSince: new Date(NOW.getTime() - 12 * 60_000).toISOString(),
          ageHours: 0,
        },
        {
          id: 'APT-7',
          kind: 'appointment-request',
          urgency: 'high',
          label: 'Requested Thu 10:30',
          patient: { id: 'PT-1005', name: 'Layla Mansour' },
          waitingSince: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
          ageHours: 3,
        },
      ]),
    );

    const { alerts, kpis } = await httpDashboardService.getOverview();

    expect(alerts).toEqual([
      {
        id: 'LAB-9',
        status: 'critical',
        statusLabel: 'Critical',
        text: 'Potassium 6.1 mmol/L awaiting review — Omar Farouk',
        time: '12 min ago',
        href: '/doctor/labs/LAB-9',
      },
      {
        id: 'APT-7',
        status: 'pending',
        statusLabel: 'Request',
        text: 'Requested Thu 10:30 — Layla Mansour',
        time: '3 h ago',
        href: '/doctor/appointments/APT-7',
      },
    ]);
    expect(kpis[1]?.caption).toBe('Requested Thu 10:30 — Layla Mansour');
  });

  it('leaves every section the server has no source for empty-handed, not seeded', async () => {
    stubApi(routes());

    const overview = await httpDashboardService.getOverview();

    // Practice pulse carries only what the server's counts give — the
    // no-show rate — and never the fixture's consultation length or
    // response time, which nothing serves.
    expect(overview.statistics?.map((stat) => stat.id)).toEqual(['no-show-rate']);
    expect(overview.trend).toBeNull();
    expect(overview.satisfaction).toBeNull();
    expect(overview.activity).toBeNull();
    // A 404 is "not served", not a failure: the widgets say "Not available
    // yet", and none offers a Retry that could never succeed.
    expect(overview.failedSections).toEqual([]);
  });

  it('fails as a whole when one source fails, rather than half-rendering', async () => {
    stubApi({
      ...routes(),
      'GET /dashboard/doctor/action-queue': () => json({ message: 'boom' }, 500),
    });

    await expect(httpDashboardService.getOverview()).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('httpDashboardService.getOverview · the M27 widget routes', () => {
  it('asks each widget route once, with no parameters', async () => {
    const { requests, unmatched } = stubApi({ ...routes(), ...m27Served() });

    await httpDashboardService.getOverview();

    expect(unmatched).toEqual([]);
    const m27 = requests.filter((request) => request.path.startsWith('/dashboard/doctor/'));
    expect(m27.map((request) => `${request.method} ${request.path}`).sort()).toEqual([
      'GET /dashboard/doctor/action-queue',
      'GET /dashboard/doctor/kpis',
      'GET /dashboard/doctor/recent-activity',
      'GET /dashboard/doctor/satisfaction',
      'GET /dashboard/doctor/trends',
    ]);
    for (const request of m27) expect([...request.query.keys()]).toEqual([]);
  });

  it('draws the trend from every day the server sent, labelled by day of month', async () => {
    stubApi({ ...routes(), ...m27Served() });

    const { trend } = await httpDashboardService.getOverview();

    expect(trend?.map((series) => series.name)).toEqual(['Completed', 'Cancelled']);
    expect(trend?.[0]?.points).toHaveLength(14);
    expect(trend?.[0]?.points[0]).toEqual({ label: '21', value: 0 });
    expect(trend?.[0]?.points[13]).toEqual({ label: '4', value: 13 % 3 });
    expect(trend?.[1]?.points[4]).toEqual({ label: '25', value: 2 });
  });

  it('keeps all five rating buckets, five stars first', async () => {
    stubApi({ ...routes(), ...m27Served() });

    const { satisfaction } = await httpDashboardService.getOverview();

    expect(satisfaction).toEqual([
      { label: '5 stars', value: 7, tone: 'success' },
      { label: '4 stars', value: 3, tone: 'primary' },
      { label: '3 stars', value: 1, tone: 'info' },
      { label: '2 stars', value: 1, tone: 'warning' },
      { label: '1 star', value: 0, tone: 'error' },
    ]);
  });

  it('reads a month with no responses as none, not as a donut of zeros', async () => {
    stubApi({
      ...routes(),
      ...m27Served({
        'GET /dashboard/doctor/satisfaction': () =>
          envelope({
            total: 0,
            average: 0,
            buckets: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: 0 })),
          }),
      }),
    });

    const { satisfaction, failedSections } = await httpDashboardService.getOverview();

    expect(satisfaction).toEqual([]);
    expect(failedSections).toEqual([]);
  });

  it('formats each activity instant on the client and links the module that owns its kind', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    stubApi({ ...routes(), ...m27Served() });

    const { activity } = await httpDashboardService.getOverview();

    expect(
      activity?.map((entry) => ({
        id: entry.id,
        text: entry.text,
        time: entry.time,
        href: entry.href,
      })),
    ).toEqual([
      {
        id: 'rx-9f1',
        text: 'Prescription issued — Metformin — Khaled Nassar',
        time: '20 min ago',
        href: '/doctor/pharmacy',
      },
      {
        id: 'note-77a',
        text: 'Consultation note signed — Mona Adel',
        time: '3 h ago',
        href: '/doctor/medical-records',
      },
      {
        id: 'lab-3c0',
        text: 'Lab result released — Lipid panel — Omar Farouk',
        time: '3 d ago',
        href: '/doctor/labs',
      },
    ]);
  });

  it('fails one widget alone: the core and the other widgets still answer', async () => {
    stubApi({
      ...routes(),
      ...m27Served({
        'GET /dashboard/doctor/satisfaction': () => json({ message: 'boom' }, 500),
      }),
    });

    const overview = await httpDashboardService.getOverview();

    expect(overview.failedSections).toEqual(['satisfaction']);
    expect(overview.satisfaction).toBeNull();
    expect(overview.trend).not.toBeNull();
    expect(overview.activity).toHaveLength(3);
    expect(overview.kpis).toHaveLength(4);
  });

  it('treats a body it cannot read as a failure of that widget, never as data', async () => {
    stubApi({
      ...routes(),
      ...m27Served({
        'GET /dashboard/doctor/recent-activity': () =>
          envelope([{ id: 'x', kind: 'message-received', at: NOW.toISOString(), text: 't' }]),
      }),
    });

    const overview = await httpDashboardService.getOverview();

    expect(overview.failedSections).toEqual(['activity']);
    expect(overview.activity).toBeNull();
  });

  it('still fails as a whole when a core source fails, whatever the widgets answer', async () => {
    stubApi({
      ...routes(),
      ...m27Served(),
      'GET /appointments/summary': () => json({ message: 'boom' }, 500),
    });

    await expect(httpDashboardService.getOverview()).rejects.toMatchObject({ kind: 'server' });
  });
});

/** `GET /dashboard/doctor/kpis` as `backend`'s `DashboardService.kpisFor` builds it. */
function kpisBody(completedWeek: number, completedWeekDelta: number) {
  return envelope({
    todayCount: 3,
    todayCompleted: 1,
    nextAt: null,
    pendingRequests: 1,
    totalPatients: 2,
    completedWeek,
    completedWeekDelta,
  });
}

describe('httpDashboardService.getOverview · completed this week against last week (M27 /kpis)', () => {
  const completedWeek = (overview: Awaited<ReturnType<typeof httpDashboardService.getOverview>>) =>
    overview.kpis.find((kpi) => kpi.id === 'completed-week');

  it('takes the value and the delta from one route, so they describe one week', async () => {
    stubApi({ ...routes(), 'GET /dashboard/doctor/kpis': () => kpisBody(9, 2) });

    const tile = completedWeek(await httpDashboardService.getOverview());

    // 9 from /kpis, not the summary's 7: never a value from one week and a
    // delta from another.
    expect(tile?.value).toBe('9');
    expect(tile?.delta).toEqual({
      direction: 'up',
      label: '2',
      tone: 'positive',
      comparison: 'vs last week',
    });
  });

  it('keeps the summary figure and draws no comparison when /kpis fails', async () => {
    stubApi({ ...routes(), 'GET /dashboard/doctor/kpis': () => json({ message: 'boom' }, 500) });

    const overview = await httpDashboardService.getOverview();

    expect(completedWeek(overview)?.value).toBe('7');
    expect(completedWeek(overview)?.delta).toBeUndefined();
    // Not a failed widget: the tile's figure is still the server's.
    expect(overview.failedSections).toEqual([]);
  });

  it('keeps the summary figure when /kpis answers something it cannot read', async () => {
    stubApi({
      ...routes(),
      'GET /dashboard/doctor/kpis': () => envelope({ completedWeek: 'many' }),
    });

    const tile = completedWeek(await httpDashboardService.getOverview());

    expect(tile?.value).toBe('7');
    expect(tile?.delta).toBeUndefined();
  });

  it.each([
    [3, { direction: 'up', label: '3', tone: 'positive' }],
    [-2, { direction: 'down', label: '2', tone: 'negative' }],
    [0, { direction: 'flat', label: '0', tone: 'neutral' }],
  ] as const)('words a change of %i as %o', (delta, expected) => {
    expect(weekDelta(delta)).toEqual({ ...expected, comparison: 'vs last week' });
  });
});

/**
 * Practice pulse's no-show rate, counted from the doctor's own book. The
 * stub answers the count calls (`pageSize=1`) by window and status, and the
 * schedule call (every other page size) with today's three rows.
 */
describe('httpDashboardService.getOverview · practice pulse (no-show rate)', () => {
  const DAY = 86_400_000;
  const CURRENT_FROM = new Date(NOW.getTime() - 30 * DAY).toISOString();
  const PRIOR_FROM = new Date(NOW.getTime() - 60 * DAY).toISOString();

  interface Counts {
    readonly current: { readonly noShows: number; readonly appointments: number };
    readonly prior: { readonly noShows: number; readonly appointments: number };
  }

  function countBody(totalItems: number) {
    return envelope({
      items: [],
      page: 1,
      pageSize: 1,
      totalItems,
      totalPages: totalItems,
    });
  }

  function pulseRoutes(counts: Counts) {
    const base = routes();
    const schedule = base['GET /appointments'];
    return {
      ...base,
      'GET /appointments': (request: StubbedRequest) => {
        if (request.query.get('pageSize') !== '1') return schedule();
        const window = request.query.get('from') === CURRENT_FROM ? counts.current : counts.prior;
        return countBody(
          request.query.get('status') === 'no-show' ? window.noShows : window.appointments,
        );
      },
    };
  }

  function pulseOf(overview: DashboardOverview) {
    return overview.statistics?.find((stat) => stat.id === 'no-show-rate');
  }

  function useFixedClock() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  }

  it('asks for exact counts over the last 30 days and the 30 before, never rows', async () => {
    useFixedClock();
    const { requests } = stubApi(
      pulseRoutes({
        current: { noShows: 3, appointments: 72 },
        prior: { noShows: 2, appointments: 64 },
      }),
    );

    await httpDashboardService.getOverview();

    const counts = requests.filter(
      (request) => request.path === '/appointments' && request.query.get('pageSize') === '1',
    );
    expect(
      counts
        .map((request) => ({
          from: request.query.get('from'),
          to: request.query.get('to'),
          status: request.query.get('status'),
          page: request.query.get('page'),
        }))
        .sort((a, b) =>
          `${a.from ?? ''}${a.status ?? ''}`.localeCompare(`${b.from ?? ''}${b.status ?? ''}`),
        ),
    ).toEqual(
      [
        { from: CURRENT_FROM, to: NOW.toISOString(), status: null, page: '1' },
        { from: CURRENT_FROM, to: NOW.toISOString(), status: 'no-show', page: '1' },
        { from: PRIOR_FROM, to: CURRENT_FROM, status: null, page: '1' },
        { from: PRIOR_FROM, to: CURRENT_FROM, status: 'no-show', page: '1' },
      ].sort((a, b) => `${a.from}${a.status ?? ''}`.localeCompare(`${b.from}${b.status ?? ''}`)),
    );
  });

  it('draws the rate from the two counts, with its denominator and a points delta', async () => {
    useFixedClock();
    stubApi(
      pulseRoutes({
        current: { noShows: 3, appointments: 72 },
        prior: { noShows: 2, appointments: 64 },
      }),
    );

    const overview = await httpDashboardService.getOverview();

    // 3 / 72 = 4.17% → 4.2%; 2 / 64 = 3.125% → 3.1%; up 1.1 points, which is bad.
    expect(overview.statistics).toEqual([
      {
        id: 'no-show-rate',
        label: 'No-show rate (30d)',
        value: '4.2%',
        caption: '3 of 72 appointments',
        delta: {
          direction: 'up',
          label: '1.1 pts',
          tone: 'negative',
          comparison: 'vs previous 30 days',
        },
      },
    ]);
    expect(overview.failedSections).toEqual([]);
  });

  it('fails the pulse alone when a count fails, and leaves the core intact', async () => {
    useFixedClock();
    const ok = pulseRoutes({
      current: { noShows: 1, appointments: 20 },
      prior: { noShows: 1, appointments: 20 },
    });
    stubApi({
      ...ok,
      'GET /appointments': (request: StubbedRequest) =>
        request.query.get('status') === 'no-show'
          ? json({ message: 'boom' }, 500)
          : ok['GET /appointments'](request),
    });

    const overview = await httpDashboardService.getOverview();

    expect(overview.statistics).toBeNull();
    expect(overview.failedSections).toEqual(['pulse']);
    expect(overview.schedule).toHaveLength(3);
    expect(overview.kpis).toHaveLength(4);
  });

  it('fails the pulse alone when a count body has no total, rather than guessing one', async () => {
    useFixedClock();
    const ok = pulseRoutes({
      current: { noShows: 1, appointments: 20 },
      prior: { noShows: 1, appointments: 20 },
    });
    stubApi({
      ...ok,
      'GET /appointments': (request: StubbedRequest) =>
        request.query.get('pageSize') === '1'
          ? envelope({ items: [], page: 1, pageSize: 1 })
          : ok['GET /appointments'](request),
    });

    const overview = await httpDashboardService.getOverview();

    expect(pulseOf(overview)).toBeUndefined();
    expect(overview.failedSections).toEqual(['pulse']);
  });

  it('still fails the whole overview when the schedule read fails', async () => {
    useFixedClock();
    stubApi({ ...routes(), 'GET /appointments': () => json({ message: 'boom' }, 500) });

    await expect(httpDashboardService.getOverview()).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('waitedFor', () => {
  const now = new Date('2026-10-04T10:00:00Z').getTime();

  it.each([
    ['2026-10-04T09:48:00Z', '12 min ago'],
    ['2026-10-04T07:00:00Z', '3 h ago'],
    ['2026-10-01T10:00:00Z', '3 d ago'],
    ['2026-10-04T10:05:00Z', '0 min ago'],
  ])('%s → %s', (since, label) => {
    expect(waitedFor(since, now)).toBe(label);
  });
});

/** `GET /dashboard/doctor/critical-alerts` as `backend`'s `CriticalAlertsService` builds it. */
function criticalAlertsBody(alerts: readonly Record<string, unknown>[]) {
  return envelope({ alerts, generatedAt: NOW.toISOString() });
}

const LAB_ALERT = {
  id: 'lab-LAB-7731',
  kind: 'unreviewed-critical-lab',
  patientName: 'Khaled Nassar',
  message: 'Potassium — critical value awaiting review',
  since: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
  path: '/doctor/labs/LAB-7731',
};

const CONFLICT_ALERT = {
  id: 'alert-3f1c',
  kind: 'allergy-conflict',
  patientName: 'Mona Adel',
  message: 'Penicillin allergy — amoxicillin ordered',
  since: NOW.toISOString(),
  path: '/doctor/appointments',
};

const RESCHEDULE_ALERT = {
  id: 'apt-APT-2209',
  kind: 'urgent-reschedule',
  patientName: 'Omar Farouk',
  message: 'Urgent appointment was rescheduled',
  since: new Date('2026-10-04T15:30:00').toISOString(),
  path: '/doctor/appointments/APT-2209',
};

describe('httpDashboardService.getCriticalAlerts (M27.3, `backend` only)', () => {
  it('reads every alert the server sends, worded and linked for its kind', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const { requests, unmatched } = stubApi({
      'GET /dashboard/doctor/critical-alerts': () =>
        criticalAlertsBody([LAB_ALERT, CONFLICT_ALERT, RESCHEDULE_ALERT]),
    });

    const answer = await httpDashboardService.getCriticalAlerts();

    expect(unmatched).toEqual([]);
    expect(requests.map((request) => request.path)).toEqual(['/dashboard/doctor/critical-alerts']);
    expect(answer.served).toBe(true);
    const alerts = answer.served ? answer.alerts : [];
    expect(alerts.map((alert) => [alert.kind, alert.patientName, alert.href])).toEqual([
      ['unreviewed-critical-lab', 'Khaled Nassar', '/doctor/labs/LAB-7731'],
      ['allergy-conflict', 'Mona Adel', '/doctor/appointments'],
      ['urgent-reschedule', 'Omar Farouk', '/doctor/appointments/APT-2209'],
    ]);
    expect(alerts[0]?.message).toBe('Potassium — critical value awaiting review');
    expect(alerts[0]?.detail).toBe('Ordered 3 h ago');
    // The conflict's `since` is only when the answer was generated.
    expect(alerts[1]?.detail).toBeNull();
    // The moved appointment's `since` is when it now starts — ahead, not "ago".
    expect(alerts[2]?.detail).toMatch(/^Now /);
    expect(alerts[2]?.detail).not.toMatch(/ago/);
  });

  it('answers served with no alerts when the server found none', async () => {
    stubApi({ 'GET /dashboard/doctor/critical-alerts': () => criticalAlertsBody([]) });

    await expect(httpDashboardService.getCriticalAlerts()).resolves.toEqual({
      served: true,
      alerts: [],
    });
  });

  it('answers not served on a 404 — an API built from `main`, where nothing was checked', async () => {
    stubApi({ 'GET /dashboard/doctor/critical-alerts': NOT_FOUND });

    await expect(httpDashboardService.getCriticalAlerts()).resolves.toEqual({ served: false });
  });

  it('rejects on a server failure rather than answering an empty banner', async () => {
    stubApi({
      'GET /dashboard/doctor/critical-alerts': () => json({ message: 'boom' }, 500),
    });

    await expect(httpDashboardService.getCriticalAlerts()).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it.each([
    ['a kind it does not know', { ...LAB_ALERT, kind: 'sepsis-score' }],
    ['an instant it cannot read', { ...LAB_ALERT, since: 'yesterday' }],
    ['no patient', { ...LAB_ALERT, patientName: undefined }],
  ])('rejects the whole answer for an alert with %s, never dropping it', async (_, alert) => {
    stubApi({
      'GET /dashboard/doctor/critical-alerts': () => criticalAlertsBody([LAB_ALERT, alert]),
    });

    await expect(httpDashboardService.getCriticalAlerts()).rejects.toThrow();
  });

  it.each([
    ['an absolute URL', 'https://example.org/phish', '/doctor/labs'],
    ['another kind’s page', '/doctor/appointments/APT-1', '/doctor/labs'],
    ['a nested path', '/doctor/labs/LAB-1/../../admin', '/doctor/labs'],
  ])('links a lab alert with %s to the labs list, keeping the alert', async (_, path, href) => {
    stubApi({
      'GET /dashboard/doctor/critical-alerts': () => criticalAlertsBody([{ ...LAB_ALERT, path }]),
    });

    const answer = await httpDashboardService.getCriticalAlerts();

    expect(answer.served ? answer.alerts.map((alert) => alert.href) : null).toEqual([href]);
  });
});
