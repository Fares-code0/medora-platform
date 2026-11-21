import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import { DEFAULT_FILTERS, type ReportFilters } from '../model/types';

import { httpReportsService } from './http-reports-service';

/**
 * Reports over HTTP (RM M21, served on `backend`), against bodies shaped as
 * `backend`'s `SnapshotService`, `InsightService` and `ReportDocumentService`
 * build them. The properties that matter: only what the server applies is
 * sent, nothing the server did not send is drawn, and an unserved operation
 * sends nothing.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

const series = (name: string, tone: string, points: [string, number][] = []) => ({
  name,
  tone,
  points: points.map(([label, value]) => ({ label, value })),
});

/** An `overview` snapshot: patients and appointments only — no revenue while billing is off. */
function snapshotBody(overrides: Record<string, unknown> = {}) {
  return envelope({
    category: 'overview',
    billingEnabled: false,
    range: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
    comparison: null,
    kpis: [
      {
        id: 'patients',
        label: 'Patients',
        value: 42,
        format: 'number',
        deltaPercent: 5,
        tone: 'primary',
        spark: [],
      },
      {
        id: 'growth',
        label: 'Growth',
        value: 3.2,
        format: 'percent',
        deltaPercent: 0,
        tone: 'success',
        spark: [1, 2],
      },
    ],
    trend: [
      series('Patients', 'primary', [['W1', 10]]),
      series('Appointments', 'info', [['W1', 14]]),
    ],
    weekday: series('Appointments', 'primary', [['Mon', 3]]),
    departments: [{ label: 'Cardiology', value: 12, tone: 'chart1' }],
    labStatus: [],
    ageDistribution: series('Patients', 'info'),
    heatmap: { rows: ['Mon'], columns: ['Morning'], cells: [[2]], max: 2 },
    pharmacy: series('Prescriptions', 'warning'),
    messages: series('Messages', 'info'),
    aiUsage: series('AI threads', 'accent'),
    records: series('Records', 'secondary'),
    ...overrides,
  });
}

const INSIGHTS = envelope([
  {
    id: 'workload',
    kind: 'workload',
    title: 'Workload up',
    detail: '12% more visits than the previous period.',
    trend: 'up',
    tone: 'success',
  },
  {
    id: 'critical',
    kind: 'critical',
    title: 'No critical results waiting',
    detail: 'Every critical result has been reviewed.',
    trend: null,
    tone: 'success',
  },
]);

const FILTERS: ReportFilters = {
  ...DEFAULT_FILTERS,
  department: 'Cardiology',
  labTest: 'CBC',
  gender: 'female',
  age: '40-64',
};

function savedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rep-1',
    name: 'Monthly overview',
    category: 'overview',
    range: 'month',
    favorite: false,
    createdAt: '2026-10-01T09:00:00.000Z',
    lastViewedAt: null,
    filters: { ...DEFAULT_FILTERS, gender: 'female' },
    ...overrides,
  };
}

function scheduledRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sch-1',
    name: 'Weekly summary',
    category: 'overview',
    frequency: 'weekly',
    format: 'pdf',
    recipients: ['doctor@medora.health'],
    status: 'active',
    nextRunAt: '2026-11-01T09:15:00.000Z',
    history: [],
    ...overrides,
  };
}

function documentRoutes(saved = [savedRow()], scheduled = [scheduledRow()]) {
  return {
    'GET /reports/saved': () => envelope(saved),
    'GET /reports/scheduled': () => envelope(scheduled),
  };
}

describe('fetchAnalytics', () => {
  it('sends only what the server applies: category, range and the two demographics', async () => {
    const { requests } = stubApi({
      'GET /reports/analytics': () => snapshotBody(),
      'GET /reports/insights': () => INSIGHTS,
    });

    await httpReportsService.fetchAnalytics(FILTERS);

    const analytics = requests.find((request) => request.path === '/reports/analytics');
    expect(Object.fromEntries(analytics?.query ?? [])).toEqual({
      category: 'overview',
      range: 'month',
      gender: 'female',
      ageBand: '40-64',
    });
    // Insights read the period only.
    const insights = requests.find((request) => request.path === '/reports/insights');
    expect(Object.fromEntries(insights?.query ?? [])).toEqual({ range: 'month' });
  });

  it('sends a custom range with its bounds', async () => {
    const { requests } = stubApi({
      'GET /reports/analytics': () => snapshotBody(),
      'GET /reports/insights': () => INSIGHTS,
    });

    await httpReportsService.fetchAnalytics({
      ...DEFAULT_FILTERS,
      range: 'custom',
      customFrom: '2026-09-01',
      customTo: '2026-09-30',
    });

    for (const path of ['/reports/analytics', '/reports/insights']) {
      const request = requests.find((entry) => entry.path === path);
      expect(request?.query.get('from')).toBe('2026-09-01');
      expect(request?.query.get('to')).toBe('2026-09-30');
    }
  });

  it("draws the server's snapshot, with each KPI's icon chosen by its id", async () => {
    stubApi({
      'GET /reports/analytics': () => snapshotBody(),
      'GET /reports/insights': () => INSIGHTS,
    });

    const { snapshot, insights, revenueAlternate } =
      await httpReportsService.fetchAnalytics(DEFAULT_FILTERS);

    expect(snapshot.kpis.map((kpi) => [kpi.id, kpi.value, kpi.format])).toEqual([
      ['patients', 42, 'number'],
      ['growth', 3.2, 'percent'],
    ]);
    expect(snapshot.kpis.every((kpi) => typeof kpi.icon === 'object')).toBe(true);
    expect(snapshot.trend.map((entry) => entry.name)).toEqual(['Patients', 'Appointments']);
    expect(snapshot.departments).toEqual([{ label: 'Cardiology', value: 12, tone: 'chart1' }]);
    expect(snapshot.heatmap.cells).toEqual([[2]]);
    expect(insights.map((insight) => [insight.kind, insight.trend])).toEqual([
      ['workload', 'up'],
      ['critical', null],
    ]);
    expect(revenueAlternate).toBeNull();
  });

  it('reads revenue without billing as the alternate, never as a snapshot of zeros', async () => {
    stubApi({
      'GET /reports/analytics': () =>
        envelope({
          category: 'revenue',
          billingEnabled: false,
          alternate: 'top-visit-types',
          notice: 'Billing is not enabled for this clinic, so revenue reporting is unavailable.',
          topVisitTypes: [
            { label: 'Follow-up', value: 18 },
            { label: 'Consultation', value: 9 },
          ],
          range: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
        }),
      'GET /reports/insights': () => INSIGHTS,
    });

    const { snapshot, revenueAlternate } = await httpReportsService.fetchAnalytics({
      ...DEFAULT_FILTERS,
      category: 'revenue',
    });

    expect(revenueAlternate).toEqual({
      notice: 'Billing is not enabled for this clinic, so revenue reporting is unavailable.',
      topVisitTypes: [
        { label: 'Follow-up', value: 18 },
        { label: 'Consultation', value: 9 },
      ],
    });
    expect(snapshot.kpis).toEqual([]);
    expect(snapshot.trend).toEqual([]);
  });

  it.each([
    [
      'a tone the chart library does not know',
      { departments: [{ label: 'x', value: 1, tone: 'pink' }] },
    ],
    [
      'a KPI with no format',
      {
        kpis: [
          { id: 'patients', label: 'P', value: 1, tone: 'primary', deltaPercent: 0, spark: [] },
        ],
      },
    ],
    [
      'a heatmap row that is not numbers',
      { heatmap: { rows: [], columns: [], cells: [['x']], max: 0 } },
    ],
  ])('refuses %s rather than drawing it', async (_label, overrides) => {
    stubApi({
      'GET /reports/analytics': () => snapshotBody(overrides),
      'GET /reports/insights': () => INSIGHTS,
    });

    await expect(httpReportsService.fetchAnalytics(DEFAULT_FILTERS)).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('surfaces a 404 — what an API built from `main` answers — as a failure', async () => {
    stubApi({
      'GET /reports/analytics': () => json({ message: 'Cannot GET', code: 'not_found' }, 404),
      'GET /reports/insights': () => json({ message: 'Cannot GET', code: 'not_found' }, 404),
    });

    await expect(httpReportsService.fetchAnalytics(DEFAULT_FILTERS)).rejects.toMatchObject({
      kind: 'not_found',
    });
  });
});

describe('the saved and scheduled document', () => {
  it('reads both lists, a never-opened report dated by its creation', async () => {
    stubApi(
      documentRoutes(
        [savedRow()],
        [
          scheduledRow({
            history: [{ id: 'run-1', at: '2026-10-20T09:15:00.000Z', status: 'failed' }],
          }),
        ],
      ),
    );

    const document = await httpReportsService.fetchReportsDocument('ignored');

    expect(document.saved[0]).toMatchObject({
      id: 'rep-1',
      lastViewedAt: '2026-10-01T09:00:00.000Z',
      filters: { gender: 'female', department: 'all' },
    });
    expect(document.scheduled[0]).toMatchObject({
      frequency: 'weekly',
      format: 'pdf',
      history: [{ status: 'failed' }],
    });
  });

  it('saves the current view whole and answers the re-read document', async () => {
    const { requests } = stubApi({
      ...documentRoutes(),
      'POST /reports/saved': () => envelope(savedRow({ id: 'rep-2' })),
    });

    await httpReportsService.createSavedReport('ignored', { name: 'Cardiology', filters: FILTERS });

    const post = requests.find((request) => request.method === 'POST');
    expect(post?.body).toEqual({
      name: 'Cardiology',
      category: 'overview',
      range: 'month',
      favorite: false,
      filters: FILTERS,
    });
    // No user or owner id on the wire: the server scopes by the session.
    expect(JSON.stringify(post?.body)).not.toContain('ignored');
    expect(requests.filter((request) => request.path === '/reports/saved')).toHaveLength(2);
  });

  it('duplicates as a new report carrying the source’s filters', async () => {
    const { requests } = stubApi({
      ...documentRoutes(),
      'POST /reports/saved': () => envelope(savedRow({ id: 'rep-3' })),
    });

    await httpReportsService.duplicateSavedReport('ignored', 'rep-1');

    expect(requests.find((request) => request.method === 'POST')?.body).toMatchObject({
      name: 'Monthly overview (copy)',
      filters: { gender: 'female' },
    });
  });

  it('deletes a saved report and a schedule by id', async () => {
    const { requests } = stubApi({
      ...documentRoutes(),
      'DELETE /reports/saved/rep-1': () => new Response(null, { status: 204 }),
      'DELETE /reports/scheduled/sch-1': () => new Response(null, { status: 204 }),
    });

    await httpReportsService.deleteSavedReport('ignored', 'rep-1');
    await httpReportsService.deleteSchedule('ignored', 'sch-1');

    expect(
      requests.filter((request) => request.method === 'DELETE').map((request) => request.path),
    ).toEqual(['/reports/saved/rep-1', '/reports/scheduled/sch-1']);
  });

  it('creates a schedule with the server’s fields only', async () => {
    const { requests } = stubApi({
      ...documentRoutes(),
      'POST /reports/scheduled': () => envelope(scheduledRow({ id: 'sch-2' })),
    });

    await httpReportsService.createSchedule('ignored', {
      name: 'Weekly',
      category: 'appointments',
      frequency: 'weekly',
      format: 'csv',
      recipients: ['doctor@medora.health'],
    });

    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      name: 'Weekly',
      category: 'appointments',
      frequency: 'weekly',
      format: 'csv',
      recipients: ['doctor@medora.health'],
    });
  });

  it.each([
    ['active', 'paused'],
    ['paused', 'active'],
  ])('sets a %s schedule to %s — the route sets, it does not flip', async (from, to) => {
    const { requests } = stubApi({
      ...documentRoutes([], [scheduledRow({ status: from })]),
      'PATCH /reports/scheduled/sch-1': () => new Response(null, { status: 204 }),
    });

    await httpReportsService.toggleScheduleStatus('ignored', 'sch-1');

    expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({ status: to });
  });

  it('refuses what no route does, sending nothing', async () => {
    const { requests } = stubApi({});

    await expect(
      httpReportsService.renameSavedReport('ignored', { id: 'rep-1', name: 'x' }),
    ).rejects.toMatchObject({ code: 'not_connected' });
    await expect(httpReportsService.toggleFavorite('ignored', 'rep-1')).rejects.toMatchObject({
      code: 'not_connected',
    });
    expect(requests).toHaveLength(0);
  });

  it('declares what it cannot do', () => {
    expect(httpReportsService.capabilities).toEqual({
      advancedFilters: ['age', 'gender'],
      departmentOptions: [],
      renameSaved: false,
      favorites: false,
      scheduleDelivery: false,
      illustrative: false,
    });
  });
});
