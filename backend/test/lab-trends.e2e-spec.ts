import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, errorBody } from './support/auth-app';
import {
  destroyLabFixtures,
  orderTest,
  post,
  seedDoctor,
  seedPatient,
  toProcessing,
  type LabOrderView,
} from './support/lab-fixture';

/**
 * Analyte trends (RM M14.6 — API §8.8).
 *
 * The verify step is "**series shape matches the chart contract**", and
 * the chart contract is `AnalyteTrend` in
 * `features/doctor/labs/model/trends.ts` — the type `AnalyteTrendChart`
 * already plots. So these assert the field names as well as the values:
 * `points[].at`, `points[].value`, `points[].flag`, `points[].labId`,
 * and `referenceLow`/`referenceHigh`/`referenceText` on the series.
 *
 * Two rules that module enforces in the model rather than the view, and
 * which the server has to agree with:
 *
 * · **A trend needs a patient, not a test.** The points come from every
 *   completed order this patient has for that analyte.
 * · **The most recent result's range wins.** A reference interval can be
 *   revised, and the one a reader is comparing against is the current
 *   one — while each point keeps the flag it was given at its own time.
 *
 * And one the schema enforces: **at most three**, as a 422 rather than a
 * silent truncation. A client asking for four series and getting three
 * back, with no indication which was dropped, would chart a patient's
 * potassium and believe it was their sodium.
 */
let harness: AuthHarness;

const charts: string[] = [];

let doctorToken = '';
let strangerToken = '';
let patientId = '';
let otherPatientId = '';

interface TrendPointView {
  labId: string;
  at: string;
  value: number;
  flag: string;
}

interface AnalyteTrendView {
  analyte: string;
  unit: string;
  referenceLow: number | null;
  referenceHigh: number | null;
  referenceText: string;
  points: TrendPointView[];
}

interface LabTrendsView {
  patientId: string;
  series: AnalyteTrendView[];
  empty: string[];
}

function trends(token: string, patient: string, query: string): request.Test {
  return request(harness.server)
    .get(`/api/v1/patients/${patient}/lab-trends${query}`)
    .set('Authorization', `Bearer ${token}`);
}

/**
 * A released order carrying these values, completed so it is plottable.
 *
 * Only completed orders are selected: a value entered while the order is
 * still processing has not been verified or released, and plotting it
 * would put an unreviewed number beside released ones with nothing to
 * tell them apart.
 */
async function releaseValues(
  patient: string,
  values: Record<string, string>,
): Promise<LabOrderView> {
  const order = await orderTest(harness, doctorToken, patient);
  await toProcessing(harness, doctorToken, order.id);

  await post(harness, doctorToken, `/${order.id}/results`, {
    results: Object.entries(values).map(([analyte, value]) => ({ analyte, value })),
  }).expect(200);

  return dataOf<LabOrderView>(
    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(200),
  );
}

beforeAll(async () => {
  harness = await createAuthHarness('lab-trends', { clinicalDoctors: true });

  doctorToken = await seedDoctor(harness, 'trends-doctor');
  strangerToken = await seedDoctor(harness, 'trends-stranger');

  const patient = await seedPatient(harness, doctorToken);
  patientId = patient.id;
  charts.push(patient.id);

  const other = await seedPatient(harness, doctorToken, { fullName: 'Omar Farouk' });
  otherPatientId = other.id;
  charts.push(other.id);

  // Three potassiums and two sodiums for the first patient, released in
  // order so the series has a direction to read.
  await releaseValues(patientId, { Potassium: '4.2', Sodium: '140' });
  await releaseValues(patientId, { Potassium: '5.6', Sodium: '138' });
  await releaseValues(patientId, { Potassium: '7.2' });

  // …and one for the second, so "this patient's history" is a real
  // restriction rather than a vacuous one.
  await releaseValues(otherPatientId, { Potassium: '3.9' });
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

describe('RM M14.6 verify — the series shape matches the chart contract', () => {
  it('serves one series per analyte, oldest first', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium').expect(200),
    );

    expect(view.patientId).toBe(patientId);
    expect(view.series).toHaveLength(1);

    const potassium = view.series[0];
    expect(potassium?.analyte).toBe('Potassium');
    expect(potassium?.unit).toBe('mmol/L');
    expect(potassium?.points).toHaveLength(3);

    // A time series is read left to right.
    const instants = potassium?.points.map((point) => point.at) ?? [];
    expect([...instants].sort()).toEqual(instants);
  });

  it('carries labId, at, value and flag on every point', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium').expect(200),
    );
    const point = view.series[0]?.points[0];

    // The field names `AnalyteTrendChart` plots, verbatim.
    expect(Object.keys(point ?? {}).sort()).toEqual(['at', 'flag', 'labId', 'value']);
    expect(point?.labId).toMatch(/^LAB-\d+$/);
    expect(typeof point?.value).toBe('number');
  });

  it('keeps each point own flag rather than re-grading it', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium').expect(200),
    );

    // 4.2 normal, 5.6 high, 7.2 critical-high — each judged at its own
    // time against the interval snapshotted on its row.
    expect(view.series[0]?.points.map((point) => point.flag)).toEqual([
      'normal',
      'high',
      'critical-high',
    ]);
  });

  it('serves the reference band as flat bounds, not a nested range', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium').expect(200),
    );

    // `AnalyteTrend` carries `referenceLow`/`referenceHigh`/
    // `referenceText`, not the `referenceRange` a result carries: a
    // chart series has one range for the whole series.
    expect(view.series[0]).toMatchObject({
      referenceLow: 3.5,
      referenceHigh: 5.1,
      referenceText: '3.5–5.1',
    });
  });

  it('does not serve a series tone — the palette is the client choice', async () => {
    // `chart1…chart3` ladder by luminance and carry no clinical meaning;
    // the clinical meaning is in the point's own flag. A server that
    // assigned colours would be deciding how a chart looks.
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium').expect(200),
    );

    expect(view.series[0]).not.toHaveProperty('tone');
  });
});

describe('the overlay cap is three', () => {
  it('serves three analytes at once, in the order they were asked for', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium,Sodium,Glucose').expect(200),
    );

    // The client assigns series colours by index (`toneForSeries`), so a
    // response that reordered them would recolour the chart between two
    // identical requests. Glucose has no results and is therefore named
    // in `empty` rather than served as a flat line at zero.
    expect(view.series.map((series) => series.analyte)).toEqual(['Potassium', 'Sodium']);
    expect(view.empty).toEqual(['Glucose']);
  });

  it('refuses a fourth analyte rather than truncating silently', async () => {
    const response = await trends(
      doctorToken,
      patientId,
      '?analytes=Potassium,Sodium,Glucose,Creatinine',
    );

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
  });

  it('refuses an empty analyte list', async () => {
    expect((await trends(doctorToken, patientId, '?analytes=')).status).toBe(422);
    expect((await trends(doctorToken, patientId, '?analytes=,,')).status).toBe(422);
  });

  it('requires the parameter at all', async () => {
    expect((await trends(doctorToken, patientId, '')).status).toBe(422);
  });

  it('tolerates spacing around the commas', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium, Sodium').expect(200),
    );

    expect(view.series.map((series) => series.analyte)).toEqual(['Potassium', 'Sodium']);
  });
});

describe('a trend is one patient history', () => {
  it('never mixes another patient results into the series', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, otherPatientId, '?analytes=Potassium').expect(200),
    );

    expect(view.patientId).toBe(otherPatientId);
    expect(view.series[0]?.points).toHaveLength(1);
    expect(view.series[0]?.points[0]?.value).toBe(3.9);
  });

  it('is care-scoped, and refuses without disclosing the chart exists', async () => {
    const response = await trends(strangerToken, patientId, '?analytes=Potassium');

    // 404 rather than 403: identical to the refusal a genuinely missing
    // patient produces (ADR-022).
    expect(response.status).toBe(404);
    expect(errorBody(response).message).toBe('Patient not found');
  });

  it('refuses an unauthenticated request', async () => {
    expect(
      (
        await request(harness.server).get(
          `/api/v1/patients/${patientId}/lab-trends?analytes=Potassium`,
        )
      ).status,
    ).toBe(401);
  });

  it('names an analyte with nothing to plot rather than dropping it', async () => {
    // A client that asked for two series and received one must be able
    // to say which is missing.
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Creatinine').expect(200),
    );

    expect(view.series).toEqual([]);
    expect(view.empty).toEqual(['Creatinine']);
  });

  it('matches the analyte name case-insensitively', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=potassium').expect(200),
    );

    expect(view.series[0]?.points).toHaveLength(3);
  });

  it('does not fold one analyte into another that shares a prefix', async () => {
    // Equality, not substring: "Free T3" must not match "Free T4".
    const view = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potass').expect(200),
    );

    expect(view.series).toEqual([]);
    expect(view.empty).toEqual(['Potass']);
  });
});

describe('only released, numeric results are plotted', () => {
  it('excludes an order still processing', async () => {
    const before = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Sodium').expect(200),
    );

    const order = await orderTest(harness, doctorToken, patientId);
    await toProcessing(harness, doctorToken, order.id);
    await post(harness, doctorToken, `/${order.id}/results`, {
      results: [{ analyte: 'Sodium', value: '118' }],
    }).expect(200);

    const after = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Sodium').expect(200),
    );

    // Entered but not verified or released: plotting it would put an
    // unreviewed number beside released ones with nothing to tell them
    // apart.
    expect(after.series[0]?.points).toHaveLength(before.series[0]?.points.length ?? 0);

    // …and it appears once the order is released.
    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(200);

    const released = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Sodium').expect(200),
    );
    expect(released.series[0]?.points).toHaveLength((before.series[0]?.points.length ?? 0) + 1);
  });

  it('windows the series by from and to', async () => {
    const all = dataOf<LabTrendsView>(
      await trends(doctorToken, patientId, '?analytes=Potassium').expect(200),
    );
    const newest = all.series[0]?.points.at(-1);

    const windowed = dataOf<LabTrendsView>(
      await trends(
        doctorToken,
        patientId,
        `?analytes=Potassium&from=${encodeURIComponent(newest?.at ?? '')}`,
      ).expect(200),
    );

    expect(windowed.series[0]?.points).toHaveLength(1);
    expect(windowed.series[0]?.points[0]?.value).toBe(newest?.value);
  });

  it('reports an empty window as empty rather than as an empty series', async () => {
    const view = dataOf<LabTrendsView>(
      await trends(
        doctorToken,
        patientId,
        '?analytes=Potassium&from=2099-01-01T00:00:00.000Z',
      ).expect(200),
    );

    // An empty series renders as a flat line at zero in most chart
    // libraries, which is a clinical claim nobody made.
    expect(view.series).toEqual([]);
    expect(view.empty).toEqual(['Potassium']);
  });
});

describe('the newest result range wins', () => {
  it('serves the band from the most recent point, not the oldest', async () => {
    // `buildAnalyteTrend` overwrites the range on each pass through an
    // ascending series, so the last one read wins — a reference interval
    // can be revised, and the current one is what a reader is comparing
    // against. The points keep their own flags, which is the other half.
    const spec = await harness.prisma.labAnalyteSpec.findFirstOrThrow({
      where: { analyte: 'Potassium', test: { code: '51990-0' } },
      select: { id: true, refHigh: true },
    });

    await harness.prisma.labAnalyteSpec.update({
      where: { id: spec.id },
      data: { refHigh: 4.8 },
    });

    try {
      await releaseValues(patientId, { Potassium: '4.5' });

      const view = dataOf<LabTrendsView>(
        await trends(doctorToken, patientId, '?analytes=Potassium').expect(200),
      );

      // The newest point was judged against 3.5–4.8; the band follows it.
      expect(view.series[0]?.referenceHigh).toBe(4.8);
      // …and the older points keep the flags they were given at the time.
      expect(view.series[0]?.points.map((point) => point.flag)).toEqual([
        'normal',
        'high',
        'critical-high',
        'normal',
      ]);
    } finally {
      await harness.prisma.labAnalyteSpec.update({
        where: { id: spec.id },
        data: { refHigh: spec.refHigh },
      });
    }
  });
});
