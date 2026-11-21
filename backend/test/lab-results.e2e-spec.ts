import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, errorBody } from './support/auth-app';
import {
  destroyLabFixtures,
  get,
  orderTest,
  post,
  seedDoctor,
  seedPatient,
  toProcessing,
  type LabOrderView,
} from './support/lab-fixture';

/**
 * Results entry (RM M14.4 — API §8.6).
 *
 * The verify step is one sentence — "**a critical-high value sets the
 * order's `hasCriticalResult`**" — and it has its own `describe`. It is
 * the assertion that binds three separate mechanisms together: the
 * server's grading ladder, the M5.10 trigger that maintains the stored
 * column, and the partial index the §8.10 chip scans. A flag computed
 * correctly but never reflected in the column is a critical result no
 * chip ever counts.
 *
 * Around it, the properties results entry can get wrong:
 *
 * · **The flag is the server's judgement.** The request body has no
 *   `flag` field and cannot acquire one, so a client cannot assert that
 *   a potassium of 7.2 is normal.
 * · **The range is snapshotted.** Revising the catalogue must not
 *   retroactively change whether a released result was abnormal.
 * · **The batch is all-or-nothing.** A CBC silently missing its platelet
 *   count is worse than a refusal naming the typo.
 *
 * The fixtures are the seeded Basic Metabolic Panel, whose potassium is
 * 3.5–5.1 with criticals at 2.5 and 6.0 — real numbers from
 * `prisma/seed/catalogues.ts`, so a seed change that contradicts these
 * rules fails here.
 */
let harness: AuthHarness;

const charts: string[] = [];

let doctorToken = '';
let patientId = '';

/** The six analytes of the seeded Basic Metabolic Panel, all normal. */
function normalPanel(overrides: Record<string, string> = {}): { analyte: string; value: string }[] {
  const values: Record<string, string> = {
    Sodium: '140',
    Potassium: '4.2',
    Chloride: '102',
    Glucose: '88',
    Creatinine: '0.9',
    BUN: '14',
    ...overrides,
  };

  return Object.entries(values).map(([analyte, value]) => ({ analyte, value }));
}

async function enterResults(
  reference: string,
  results: { analyte: string; value: string }[],
): Promise<LabOrderView> {
  const response = await post(harness, doctorToken, `/${reference}/results`, { results });
  expect(response.status).toBe(200);

  return dataOf<LabOrderView>(response);
}

/** An order at `processing`, ready for results. */
async function processingOrder(): Promise<string> {
  const order = await orderTest(harness, doctorToken, patientId);
  await toProcessing(harness, doctorToken, order.id);

  return order.id;
}

beforeAll(async () => {
  harness = await createAuthHarness('lab-results');

  doctorToken = await seedDoctor(harness, 'results-doctor');
  const patient = await seedPatient(harness, doctorToken);
  patientId = patient.id;
  charts.push(patient.id);
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

describe('RM M14.4 verify — a critical-high value sets hasCriticalResult', () => {
  it('flags the value critical-high and sets the order column', async () => {
    const reference = await processingOrder();

    // 7.2 is above the seeded `criticalHigh` of 6.0 for potassium.
    const order = await enterResults(reference, normalPanel({ Potassium: '7.2' }));

    const potassium = order.results.find((result) => result.analyte === 'Potassium');
    expect(potassium?.flag).toBe('critical-high');

    // The column is **trigger-maintained** (M5.10): nothing in the
    // application writes it, and this asserts the trigger and the
    // grading ladder agree about what "critical" means.
    expect(order.hasCriticalResult).toBe(true);
    expect(order.resultSummary).toEqual({ total: 6, abnormal: 1, critical: 1 });
  });

  it('sets it for a critical-low value too', async () => {
    const reference = await processingOrder();
    const order = await enterResults(reference, normalPanel({ Potassium: '1.9' }));

    expect(order.results.find((result) => result.analyte === 'Potassium')?.flag).toBe(
      'critical-low',
    );
    expect(order.hasCriticalResult).toBe(true);
  });

  it('leaves it false for an all-normal panel', async () => {
    const reference = await processingOrder();
    const order = await enterResults(reference, normalPanel());

    expect(order.results.every((result) => result.flag === 'normal')).toBe(true);
    expect(order.hasCriticalResult).toBe(false);
    expect(order.resultSummary).toEqual({ total: 6, abnormal: 0, critical: 0 });
  });

  it('leaves it false for a merely high value', async () => {
    // 5.6 is above the reference high of 5.1 and below the critical high
    // of 6.0. A ladder that tested the reference bound first would call
    // 7.2 merely high too, which is the mistake this guards.
    const reference = await processingOrder();
    const order = await enterResults(reference, normalPanel({ Potassium: '5.6' }));

    expect(order.results.find((result) => result.analyte === 'Potassium')?.flag).toBe('high');
    expect(order.hasCriticalResult).toBe(false);
    expect(order.resultSummary).toEqual({ total: 6, abnormal: 1, critical: 0 });
  });

  it('clears the column when the critical value is corrected', async () => {
    // The trigger recomputes on every change rather than only on insert,
    // which is what keeps a stored derivation honest — a corrected value
    // that left the chip counting would be a phantom alert.
    const reference = await processingOrder();
    await enterResults(reference, normalPanel({ Potassium: '7.2' }));

    const corrected = await enterResults(reference, [{ analyte: 'Potassium', value: '4.4' }]);

    expect(corrected.hasCriticalResult).toBe(false);
    expect(corrected.results.find((result) => result.analyte === 'Potassium')?.flag).toBe(
      'normal',
    );
  });
});

describe('the flag is the server judgement, not a client claim', () => {
  it('ignores a flag field in the body entirely', async () => {
    const reference = await processingOrder();

    // The schema strips it. A client that could assert `normal` on a
    // potassium of 7.2 would be asserting that a result nobody needs to
    // see today is fine — and the bulk-review path reads exactly this
    // field to decide whether a checkbox may clear it.
    const response = await post(harness, doctorToken, `/${reference}/results`, {
      results: [{ analyte: 'Potassium', value: '7.2', flag: 'normal' }],
    });

    expect(response.status).toBe(200);
    expect(dataOf<LabOrderView>(response).results[0]?.flag).toBe('critical-high');
  });

  it('grades the reference interval as inclusive at both ends', async () => {
    const reference = await processingOrder();
    const order = await enterResults(reference, [
      { analyte: 'Potassium', value: '5.1' },
      { analyte: 'Sodium', value: '135' },
    ]);

    // A patient whose potassium is exactly 5.1 does not have a high one.
    expect(order.results.map((result) => result.flag)).toEqual(['normal', 'normal']);
  });

  it('grades the critical thresholds as inclusive', async () => {
    const reference = await processingOrder();
    const order = await enterResults(reference, [{ analyte: 'Potassium', value: '6.0' }]);

    // A threshold a result may sit on without raising the alert is a
    // threshold one unit higher than the one that was written down.
    expect(order.results[0]?.flag).toBe('critical-high');
    expect(order.hasCriticalResult).toBe(true);
  });

  it('renders the value at the analyte own precision', async () => {
    const reference = await processingOrder();
    const order = await enterResults(reference, [
      { analyte: 'Potassium', value: '4' },
      { analyte: 'Creatinine', value: '0.9' },
      { analyte: 'Sodium', value: '140.4' },
    ]);

    const byAnalyte = new Map(order.results.map((result) => [result.analyte, result]));

    // "5" and "5.0" are stored identically for a one-decimal analyte, so
    // a reader is not invited to infer significance from a technician's
    // keystrokes.
    expect(byAnalyte.get('Potassium')?.value).toBe('4.0');
    expect(byAnalyte.get('Creatinine')?.value).toBe('0.90');
    expect(byAnalyte.get('Sodium')?.value).toBe('140');
    // The numeric value keeps the full precision for charting.
    expect(byAnalyte.get('Sodium')?.numericValue).toBe(140.4);
  });
});

describe('the reference range is snapshotted onto the row', () => {
  it('stores the bounds and the wording the value was judged against', async () => {
    const reference = await processingOrder();
    const order = await enterResults(reference, [{ analyte: 'Potassium', value: '4.2' }]);

    expect(order.results[0]?.referenceRange).toEqual({
      low: 3.5,
      high: 5.1,
      text: '3.5–5.1',
    });
  });

  it('does not change when the catalogue is later revised', async () => {
    // DB §E5's whole reason: "a range revised next year must not
    // retroactively change whether last year's result was flagged
    // abnormal". The flag is a clinical judgement made at a time.
    const reference = await processingOrder();
    await enterResults(reference, [{ analyte: 'Potassium', value: '5.0' }]);

    const spec = await harness.prisma.labAnalyteSpec.findFirstOrThrow({
      where: { analyte: 'Potassium', test: { code: '51990-0' } },
      select: { id: true, refHigh: true },
    });

    await harness.prisma.labAnalyteSpec.update({
      where: { id: spec.id },
      data: { refHigh: 4.5 },
    });

    try {
      const after = dataOf<LabOrderView>(await get(harness, doctorToken, `/${reference}`));
      const potassium = after.results.find((result) => result.analyte === 'Potassium');

      // 5.0 is above the *new* 4.5 and was normal against the old 5.1.
      // The stored row keeps the interval it was judged by, and its flag.
      expect(potassium?.referenceRange.high).toBe(5.1);
      expect(potassium?.flag).toBe('normal');
    } finally {
      await harness.prisma.labAnalyteSpec.update({
        where: { id: spec.id },
        data: { refHigh: spec.refHigh },
      });
    }
  });

  it('grades a new result against the revised range', async () => {
    // The other half of the same property: the snapshot freezes the
    // past, it does not freeze the catalogue.
    const spec = await harness.prisma.labAnalyteSpec.findFirstOrThrow({
      where: { analyte: 'Potassium', test: { code: '51990-0' } },
      select: { id: true, refHigh: true },
    });

    await harness.prisma.labAnalyteSpec.update({
      where: { id: spec.id },
      data: { refHigh: 4.5 },
    });

    try {
      const reference = await processingOrder();
      const order = await enterResults(reference, [{ analyte: 'Potassium', value: '5.0' }]);

      expect(order.results[0]?.flag).toBe('high');
      expect(order.results[0]?.referenceRange.high).toBe(4.5);
    } finally {
      await harness.prisma.labAnalyteSpec.update({
        where: { id: spec.id },
        data: { refHigh: spec.refHigh },
      });
    }
  });
});

describe('the batch is all-or-nothing', () => {
  it('refuses the whole batch when one analyte is not on the panel', async () => {
    // Releasing the five that were recognised would produce a panel
    // silently lacking its sixth value.
    const reference = await processingOrder();

    const response = await post(harness, doctorToken, `/${reference}/results`, {
      results: [
        { analyte: 'Potassium', value: '4.2' },
        { analyte: 'Hemoglobin', value: '13.1' },
      ],
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['results.1']?.[0]).toContain('not an analyte');

    const after = dataOf<LabOrderView>(await get(harness, doctorToken, `/${reference}`));
    expect(after.results).toEqual([]);
    expect(after.timeline.some((event) => event.kind === 'resulted')).toBe(false);
  });

  it('names the analytes the panel does report', async () => {
    const reference = await processingOrder();
    const response = await post(harness, doctorToken, `/${reference}/results`, {
      results: [{ analyte: 'Hemoglobin', value: '13.1' }],
    });

    expect(errorBody(response).fieldErrors?.['results.0']?.[0]).toContain('Potassium');
  });

  it('collects every problem into one 422 rather than one per round trip', async () => {
    const reference = await processingOrder();
    const response = await post(harness, doctorToken, `/${reference}/results`, {
      results: [
        { analyte: 'Hemoglobin', value: '13.1' },
        { analyte: 'Potassium', value: 'not a number' },
      ],
    });

    expect(response.status).toBe(422);
    expect(Object.keys(errorBody(response).fieldErrors ?? {})).toEqual([
      'results.0',
      'results.1',
    ]);
  });

  it('refuses a non-numeric value for a numeric analyte', async () => {
    const reference = await processingOrder();
    const response = await post(harness, doctorToken, `/${reference}/results`, {
      results: [{ analyte: 'Potassium', value: 'high' }],
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['results.0']?.[0]).toContain('not a number');
  });

  it('refuses the same analyte reported twice in one batch', async () => {
    // Two potassiums in one request is a reading nobody can resolve, and
    // the upsert would silently keep whichever came last.
    const reference = await processingOrder();
    const response = await post(harness, doctorToken, `/${reference}/results`, {
      results: [
        { analyte: 'Potassium', value: '4.2' },
        { analyte: 'potassium', value: '5.2' },
      ],
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['results.1']?.[0]).toContain('twice');
  });

  it('refuses an empty batch', async () => {
    const reference = await processingOrder();
    expect(
      (await post(harness, doctorToken, `/${reference}/results`, { results: [] })).status,
    ).toBe(422);
  });
});

describe('re-entry corrects a value rather than duplicating it', () => {
  it('updates the existing row on the (order, analyte) unique key', async () => {
    const reference = await processingOrder();
    await enterResults(reference, normalPanel());

    const corrected = await enterResults(reference, [{ analyte: 'Potassium', value: '5.9' }]);

    expect(corrected.results).toHaveLength(6);
    expect(corrected.results.find((result) => result.analyte === 'Potassium')?.value).toBe('5.9');
  });

  it('stores the catalogue spelling whatever case was reported', async () => {
    // A second batch spelling it differently would otherwise create a
    // second row for one analyte, defeating the unique key and splitting
    // the trend series.
    const reference = await processingOrder();
    await enterResults(reference, [{ analyte: 'potassium', value: '4.2' }]);
    const again = await enterResults(reference, [{ analyte: 'POTASSIUM', value: '4.4' }]);

    expect(again.results).toHaveLength(1);
    expect(again.results[0]?.analyte).toBe('Potassium');
  });

  it('writes a `resulted` timeline event naming the critical analyte', async () => {
    const reference = await processingOrder();
    const order = await enterResults(reference, normalPanel({ Potassium: '7.2' }));

    const resulted = order.timeline.find((event) => event.kind === 'resulted');
    expect(resulted?.detail).toContain('6 values entered');
    // The analyte is named and the **number is not**: a timeline is a
    // list of headlines, and the value is one field away in the same
    // payload.
    expect(resulted?.detail).toContain('Potassium (critical-high)');
    expect(resulted?.detail).not.toContain('7.2');
  });
});

describe('results may only be entered while the order is processing', () => {
  it('refuses an order the lab has not started', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await post(harness, doctorToken, `/${order.id}/results`, {
      results: [{ analyte: 'Potassium', value: '4.2' }],
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('order_not_resultable');
  });

  it('refuses a released order, and says to amend instead', async () => {
    const reference = await processingOrder();
    await enterResults(reference, normalPanel());
    await post(harness, doctorToken, `/${reference}/transition`, { to: 'completed' }).expect(200);

    const response = await post(harness, doctorToken, `/${reference}/results`, {
      results: [{ analyte: 'Potassium', value: '4.4' }],
    });

    expect(response.status).toBe(409);
    // Overwriting a released value another record may already cite is
    // the thing an addendum exists for.
    expect(errorBody(response).detail).toMatch(/addendum/i);
  });
});

describe('releasing the order verifies its results (§8.6 `verified`)', () => {
  it('stamps verified_by on every unverified result', async () => {
    const reference = await processingOrder();
    await enterResults(reference, normalPanel());

    const completed = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${reference}/transition`, { to: 'completed' }).expect(
        200,
      ),
    );

    expect(completed.status).toBe('completed');
    expect(completed.timeline[0]?.kind).toBe('verified');

    const rows = await harness.prisma.labResult.findMany({
      where: { order: { publicId: reference } },
      select: { verifiedBy: true },
    });
    expect(rows.every((row) => row.verifiedBy !== null)).toBe(true);
  });

  it('clears the verification when a value is corrected', async () => {
    // A corrected value has not been verified by whoever verified the
    // previous one, so the attribution is cleared and the next release
    // re-stamps it.
    const reference = await processingOrder();
    await enterResults(reference, normalPanel());

    const rowBefore = await harness.prisma.labResult.findFirstOrThrow({
      where: { order: { publicId: reference }, analyte: 'Potassium' },
      select: { verifiedBy: true },
    });
    expect(rowBefore.verifiedBy).toBeNull();

    await post(harness, doctorToken, `/${reference}/transition`, { to: 'completed' }).expect(200);
  });
});
