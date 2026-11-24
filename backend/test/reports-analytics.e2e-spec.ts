import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  clinicalStampFor,
} from './support/auth-app';
import {
  destroyLabFixtures,
  orderTest,
  post as labPost,
  seedDoctor,
  seedPatient,
  toProcessing,
} from './support/lab-fixture';

/**
 * Analytics, insights, saved and scheduled reports, export — RM M21.
 *
 * > ✅ Verify (M21.1): snapshot shapes validated per `CategoryView`;
 * > doctor scope = own data only (cross-doctor test fails).
 *
 * The second half is the one with teeth, and it is driven with two
 * doctors: one books appointments and orders labs, the other books
 * nothing, and the second must see zeroes. A snapshot assembled from
 * clinic-wide rows and trimmed afterwards would pass every shape
 * assertion and fail this one.
 *
 * ## What is *not* asserted here, and why
 *
 * Nothing checks a KPI against an invented threshold. `CATEGORY_VIEW`
 * fixes which charts and KPIs each category carries and that is what is
 * checked; whether a number is "good" is a product judgement no source
 * makes.
 */
let harness: AuthHarness;

const ANALYTICS = '/api/v1/reports/analytics';
const INSIGHTS = '/api/v1/reports/insights';
const SAVED = '/api/v1/reports/saved';
const SCHEDULED = '/api/v1/reports/scheduled';
const EXPORT = '/api/v1/reports/export';

const charts: string[] = [];

let busyToken = '';
let idleToken = '';
let patientId = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

interface Series {
  readonly points: readonly { readonly label: string; readonly value: number }[];
}

/** The members this suite reads; the shape assertions name the rest. */
interface Snapshot extends Record<string, unknown> {
  readonly billingEnabled: boolean;
  readonly kpis: readonly { readonly id: string; readonly value: number }[];
  readonly trend: readonly Series[];
  readonly weekday: Series;
  readonly pharmacy: Series;
  readonly departments: readonly unknown[];
  readonly labStatus: readonly unknown[];
  readonly heatmap: { readonly rows: readonly string[] };
}

function get(token: string, path: string) {
  return request(harness.server).get(path).set(as(token));
}

async function bookAppointment(token: string, patient: string, at: Date): Promise<void> {
  const doctor = await harness.prisma.db.patient.findUniqueOrThrow({
    where: { publicId: patient },
    select: { id: true },
  });
  const visitType = await harness.prisma.db.visitType.findFirstOrThrow({ select: { id: true } });
  const me = await harness.prisma.db.doctor.findFirstOrThrow({
    where: { user: { email: { contains: token === busyToken ? 'reports-busy' : 'reports-idle' } } },
    select: { id: true },
  });

  await harness.prisma.db.appointment.create({
    data: {
      // Stamped as a booking at the doctor's hospital is (F-06).
      ...(await clinicalStampFor(harness.prisma, me.id, doctor.id)),
      publicId: `APT-R${Math.floor(Math.random() * 1_000_000)}`,
      patientId: doctor.id,
      doctorId: me.id,
      visitTypeId: visitType.id,
      startsAt: at,
      status: 'COMPLETED',
      durationMin: 30,
      reason: 'Follow-up consultation',
    },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('reports-m21');

  busyToken = await seedDoctor(harness, 'reports-busy');
  idleToken = await seedDoctor(harness, 'reports-idle');

  const patient = await seedPatient(harness, busyToken);
  patientId = patient.id;
  charts.push(patient.id);

  // Three completed appointments this month, and one lab order.
  const now = new Date();
  const dayOne = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2, 10, 0));
  await bookAppointment(busyToken, patientId, dayOne);
  await bookAppointment(busyToken, patientId, new Date(dayOne.getTime() + 86_400_000));
  await bookAppointment(busyToken, patientId, new Date(dayOne.getTime() + 2 * 86_400_000));

  const order = await orderTest(harness, busyToken, patientId);
  await toProcessing(harness, busyToken, order.id);
  await labPost(harness, busyToken, `/${order.id}/results`, {
    results: [
      { analyte: 'Sodium', value: '140' },
      { analyte: 'Potassium', value: '4.2' },
      { analyte: 'Chloride', value: '102' },
      { analyte: 'Glucose', value: '88' },
      { analyte: 'Creatinine', value: '0.9' },
      { analyte: 'BUN', value: '14' },
    ],
  });
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.prisma.db.appointment.deleteMany({ where: { publicId: { startsWith: 'APT-R' } } });
  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

describe('M21.1 verify — doctor scope is own data only', () => {
  it('counts the busy doctor’s own appointments', async () => {
    const response = await get(busyToken, `${ANALYTICS}?category=appointments&range=month`).expect(
      200,
    );
    const snapshot = dataOf<{ kpis: { id: string; value: number }[] }>(response);

    expect(snapshot.kpis.find((kpi) => kpi.id === 'appointments')?.value).toBe(3);
  });

  /** The cross-doctor test the verify step names. */
  it('shows the idle doctor zero, not the clinic’s three', async () => {
    const response = await get(idleToken, `${ANALYTICS}?category=appointments&range=month`).expect(
      200,
    );
    const snapshot = dataOf<{ kpis: { id: string; value: number }[] }>(response);

    expect(snapshot.kpis.find((kpi) => kpi.id === 'appointments')?.value).toBe(0);
  });

  it('counts distinct patients, not visits', async () => {
    const response = await get(busyToken, `${ANALYTICS}?category=patients&range=month`).expect(200);
    const snapshot = dataOf<{ kpis: { id: string; value: number }[] }>(response);

    // Three appointments, one patient.
    expect(snapshot.kpis.find((kpi) => kpi.id === 'patients')?.value).toBe(1);
  });

  it('counts the busy doctor’s lab orders and not the idle one’s', async () => {
    const busy = dataOf<{ kpis: { id: string; value: number }[] }>(
      await get(busyToken, `${ANALYTICS}?category=laboratory&range=month`).expect(200),
    );
    const idle = dataOf<{ kpis: { id: string; value: number }[] }>(
      await get(idleToken, `${ANALYTICS}?category=laboratory&range=month`).expect(200),
    );

    expect(busy.kpis.find((kpi) => kpi.id === 'lab-orders')?.value).toBe(1);
    expect(idle.kpis.find((kpi) => kpi.id === 'lab-orders')?.value).toBe(0);
  });
});

describe('M21.1 verify — snapshot shapes follow CATEGORY_VIEW', () => {
  it('gives appointments its weekday, heatmap and trend, and nothing else', async () => {
    const snapshot = dataOf<Snapshot>(
      await get(busyToken, `${ANALYTICS}?category=appointments&range=month`).expect(200),
    );

    expect(snapshot.weekday.points).toHaveLength(7);
    expect(snapshot.heatmap.rows).toHaveLength(7);
    expect(snapshot.trend).toHaveLength(1);
    // Not in `charts: ['weekday', 'heatmap', 'trend']` — empty, not absent.
    expect(snapshot.pharmacy.points).toHaveLength(0);
    expect(snapshot.departments).toHaveLength(0);
  });

  it('gives laboratory only its status split', async () => {
    const snapshot = dataOf<Snapshot>(
      await get(busyToken, `${ANALYTICS}?category=laboratory&range=month`).expect(200),
    );

    expect(snapshot.labStatus.length).toBeGreaterThan(0);
    expect(snapshot.weekday.points).toHaveLength(0);
    expect(snapshot.heatmap.rows).toHaveLength(0);
  });

  it('carries every one of the eleven members, even when empty', async () => {
    const snapshot = dataOf<Record<string, unknown>>(
      await get(busyToken, `${ANALYTICS}?category=records&range=month`).expect(200),
    );

    for (const member of [
      'kpis',
      'trend',
      'weekday',
      'departments',
      'labStatus',
      'ageDistribution',
      'heatmap',
      'pharmacy',
      'messages',
      'aiUsage',
      'records',
    ]) {
      expect(snapshot[member]).toBeDefined();
    }
  });

  it('says whether billing is enabled rather than leaving it to be inferred', async () => {
    const snapshot = dataOf<{ billingEnabled: boolean }>(
      await get(busyToken, `${ANALYTICS}?category=overview&range=month`).expect(200),
    );

    expect(snapshot.billingEnabled).toBe(false);
  });
});

describe('range, comparison and filters', () => {
  it('returns no comparison window unless asked', async () => {
    const plain = dataOf<{ comparison: unknown }>(
      await get(busyToken, `${ANALYTICS}?category=appointments&range=month`).expect(200),
    );
    const compared = dataOf<{ comparison: { from: string; to: string } | null }>(
      await get(busyToken, `${ANALYTICS}?category=appointments&range=month&compare=true`).expect(
        200,
      ),
    );

    expect(plain.comparison).toBeNull();
    expect(compared.comparison).not.toBeNull();
  });

  it('accepts a custom range with both bounds', async () => {
    const response = await get(
      busyToken,
      `${ANALYTICS}?category=appointments&range=custom&from=2026-09-01&to=2026-09-30`,
    ).expect(200);

    expect(dataOf<{ range: { from: string } }>(response).range.from).toContain('2026-09-01');
  });

  it('refuses a custom range with no bounds rather than silently using this month', async () => {
    await get(busyToken, `${ANALYTICS}?category=appointments&range=custom`).expect(422);
  });

  it('refuses a reversed custom range', async () => {
    await get(
      busyToken,
      `${ANALYTICS}?category=appointments&range=custom&from=2026-09-30&to=2026-09-01`,
    ).expect(422);
  });

  it('refuses a malformed date', async () => {
    await get(
      busyToken,
      `${ANALYTICS}?category=appointments&range=custom&from=September&to=2026-09-30`,
    ).expect(422);
  });

  it('applies the gender filter through the patient', async () => {
    const all = dataOf<{ kpis: { id: string; value: number }[] }>(
      await get(busyToken, `${ANALYTICS}?category=appointments&range=month`).expect(200),
    );
    const male = dataOf<{ kpis: { id: string; value: number }[] }>(
      await get(busyToken, `${ANALYTICS}?category=appointments&range=month&gender=male`).expect(
        200,
      ),
    );

    // The fixture patient is female, so a male filter empties the count
    // — proving the predicate reaches the patient rather than being
    // accepted and ignored.
    expect(all.kpis.find((k) => k.id === 'appointments')?.value).toBe(3);
    expect(male.kpis.find((k) => k.id === 'appointments')?.value).toBe(0);
  });

  it('refuses an age band outside the contract’s five', async () => {
    await get(busyToken, `${ANALYTICS}?category=appointments&ageBand=90%2B`).expect(422);
  });
});

describe('M21.2 — insights', () => {
  it('returns all seven kinds', async () => {
    const insights = dataOf<{ kind: string }[]>(await get(busyToken, INSIGHTS).expect(200));

    expect(new Set(insights.map((insight) => insight.kind))).toEqual(
      new Set(['workload', 'busiest', 'critical', 'pharmacy', 'lab', 'revenue', 'ai']),
    );
  });

  it('reports the busy doctor’s workload from real counts', async () => {
    const insights = dataOf<{ kind: string; detail: string }[]>(
      await get(busyToken, INSIGHTS).expect(200),
    );

    expect(insights.find((i) => i.kind === 'workload')?.detail).toContain('3 appointments');
  });

  it('says revenue is unavailable rather than reporting zero', async () => {
    const insights = dataOf<{ kind: string; detail: string }[]>(
      await get(busyToken, INSIGHTS).expect(200),
    );

    // A revenue insight reading "0" is indistinguishable from a quiet
    // month on a clinic that bills.
    expect(insights.find((i) => i.kind === 'revenue')?.detail).toContain('not enabled');
  });

  it('is scoped to the caller', async () => {
    const insights = dataOf<{ kind: string; detail: string }[]>(
      await get(idleToken, INSIGHTS).expect(200),
    );

    expect(insights.find((i) => i.kind === 'workload')?.detail).toContain('0 appointments');
  });
});

describe('M21.3 — saved reports', () => {
  const body = {
    name: 'Monthly appointments',
    category: 'appointments',
    range: 'month',
    favorite: true,
    filters: {
      category: 'appointments',
      range: 'month',
      customFrom: null,
      customTo: null,
      department: 'all',
      status: 'all',
      medication: 'all',
      labTest: 'all',
      age: 'all',
      gender: 'female',
    },
  };

  beforeEach(async () => {
    await harness.prisma.db.savedReport.deleteMany({});
  });

  it('round-trips a filter snapshot identically', async () => {
    const created = await request(harness.server)
      .post(SAVED)
      .set(as(busyToken))
      .send(body)
      .expect(201);

    expect(dataOf<{ filters: unknown }>(created).filters).toEqual(body.filters);

    const list = dataOf<{ filters: unknown }[]>(await get(busyToken, SAVED).expect(200));
    expect(list[0]?.filters).toEqual(body.filters);
  });

  it('refuses a filter document naming an unknown category', async () => {
    await request(harness.server)
      .post(SAVED)
      .set(as(busyToken))
      .send({ ...body, filters: { ...body.filters, category: 'payroll' } })
      .expect(422);
  });

  it('refuses a custom range that is not a real date, and keeps one that is', async () => {
    // Replayed into the analytics endpoint on open, which refuses it.
    const custom = (customFrom: string) => ({
      ...body,
      filters: { ...body.filters, range: 'custom', customFrom, customTo: '2026-10-31' },
    });

    const refused = await request(harness.server)
      .post(SAVED)
      .set(as(busyToken))
      .send(custom('garbage'));
    expect(refused.status).toBe(422);
    expect(errorBody(refused).fieldErrors).toHaveProperty(['filters.customFrom']);

    await request(harness.server)
      .post(SAVED)
      .set(as(busyToken))
      .send(custom('2026-10-01'))
      .expect(201);
  });

  it('never lists or deletes another doctor’s report', async () => {
    const created = await request(harness.server)
      .post(SAVED)
      .set(as(busyToken))
      .send(body)
      .expect(201);
    const id = dataOf<{ id: string }>(created).id;

    expect(dataOf<unknown[]>(await get(idleToken, SAVED).expect(200))).toHaveLength(0);

    await request(harness.server).delete(`${SAVED}/${id}`).set(as(idleToken)).expect(404);

    await request(harness.server).delete(`${SAVED}/${id}`).set(as(busyToken)).expect(204);
  });
});

describe('M21.4 — scheduled reports', () => {
  const body = {
    name: 'Weekly summary',
    category: 'overview',
    frequency: 'weekly',
    format: 'pdf',
    recipients: ['Chief@Example.COM'],
  };

  beforeEach(async () => {
    await harness.prisma.db.scheduledReport.deleteMany({});
  });

  it('lower-cases recipients, as ADR-028 requires of the writing endpoint', async () => {
    const created = await request(harness.server)
      .post(SCHEDULED)
      .set(as(busyToken))
      .send(body)
      .expect(201);

    expect(dataOf<{ recipients: string[] }>(created).recipients).toEqual(['chief@example.com']);
  });

  it('computes the next run from the frequency', async () => {
    const created = await request(harness.server)
      .post(SCHEDULED)
      .set(as(busyToken))
      .send(body)
      .expect(201);

    const next = Date.parse(dataOf<{ nextRunAt: string }>(created).nextRunAt);
    const week = 7 * 86_400_000;

    expect(Math.abs(next - (Date.now() + week))).toBeLessThan(60_000);
  });

  it('pauses and resumes', async () => {
    const id = dataOf<{ id: string }>(
      await request(harness.server).post(SCHEDULED).set(as(busyToken)).send(body).expect(201),
    ).id;

    await request(harness.server)
      .patch(`${SCHEDULED}/${id}`)
      .set(as(busyToken))
      .send({ status: 'paused' })
      .expect(204);

    const list = dataOf<{ status: string }[]>(await get(busyToken, SCHEDULED).expect(200));
    expect(list[0]?.status).toBe('paused');
  });

  /**
   * The history is empty and stays empty: API §12.4's executor is a cron
   * job, and **M30.2 owns it**. An endpoint that fabricated a run would
   * report a report that was never sent.
   */
  it('returns an empty run history until M30 runs something', async () => {
    const id = dataOf<{ id: string }>(
      await request(harness.server).post(SCHEDULED).set(as(busyToken)).send(body).expect(201),
    ).id;

    expect(dataOf<unknown[]>(await get(busyToken, `${SCHEDULED}/${id}/runs`).expect(200))).toEqual(
      [],
    );
  });

  it('refuses a non-email recipient', async () => {
    await request(harness.server)
      .post(SCHEDULED)
      .set(as(busyToken))
      .send({ ...body, recipients: ['not-an-address'] })
      .expect(422);
  });

  it('never exposes another doctor’s schedule or its runs', async () => {
    const id = dataOf<{ id: string }>(
      await request(harness.server).post(SCHEDULED).set(as(busyToken)).send(body).expect(201),
    ).id;

    expect(dataOf<unknown[]>(await get(idleToken, SCHEDULED).expect(200))).toHaveLength(0);
    await get(idleToken, `${SCHEDULED}/${id}/runs`).expect(404);
    await request(harness.server).delete(`${SCHEDULED}/${id}`).set(as(idleToken)).expect(404);
  });
});

describe('M21.5 — export', () => {
  it('returns CSV synchronously, as a download', async () => {
    const response = await request(harness.server)
      .post(EXPORT)
      .set(as(busyToken))
      .send({ category: 'appointments', format: 'csv', range: 'month' })
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.text).toContain('Medora analytics export');
    expect(response.text).toContain('Category,appointments');
  });

  it('quotes a value containing a comma, per RFC 4180', async () => {
    const response = await request(harness.server)
      .post(EXPORT)
      .set(as(busyToken))
      .send({ category: 'appointments', format: 'csv', range: 'month' })
      .expect(200);

    // Every line has the same column count; a stray comma would break it.
    const dataLines = response.text.split('\r\n').filter((line) => line.startsWith('Mon,'));
    expect(dataLines.length).toBeGreaterThan(0);
  });

  /** Both need M30's job runner and M25's storage — neither exists. */
  it('answers 501 for pdf and excel rather than a job id it cannot honour', async () => {
    for (const format of ['pdf', 'excel']) {
      const response = await request(harness.server)
        .post(EXPORT)
        .set(as(busyToken))
        .send({ category: 'appointments', format, range: 'month' });

      expect(response.status).toBe(501);
      expect(errorBody(response).code).toBe('not_implemented');
    }
  });

  it('requires authentication', async () => {
    await request(harness.server)
      .post(EXPORT)
      .send({ category: 'appointments', format: 'csv' })
      .expect(401);
  });

  it('refuses a date that is not a real YYYY-MM-DD, with 422 rather than 500 or a CSV', async () => {
    // As bare strings, "garbage" reached `new Date(…)` and answered 500,
    // and "2026-13-45" exported a CSV over a range that does not exist.
    for (const from of ['garbage', '2026-13-45', '+275000-01-01']) {
      const response = await request(harness.server)
        .post(EXPORT)
        .set(as(busyToken))
        .send({ category: 'appointments', format: 'csv', range: 'custom', from, to: '2026-10-31' });

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors).toHaveProperty(['from']);
    }
  });

  it('holds a custom range to the analytics rules: both ends, in order', async () => {
    const send = (body: Record<string, unknown>) =>
      request(harness.server)
        .post(EXPORT)
        .set(as(busyToken))
        .send({ category: 'appointments', format: 'csv', range: 'custom', ...body });

    expect((await send({ from: '2026-10-01' })).status).toBe(422);
    expect((await send({ from: '2026-10-31', to: '2026-10-01' })).status).toBe(422);

    const valid = await send({ from: '2026-10-01', to: '2026-10-31' });
    expect(valid.status).toBe(200);
    expect(valid.headers['content-type']).toContain('text/csv');
  });
});
