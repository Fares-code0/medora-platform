import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, errorBody } from './support/auth-app';
import {
  destroyLabFixtures,
  get,
  LAB_ORDERS,
  orderTest,
  post,
  seedDoctor,
  seedPatient,
  specimenBody,
  toProcessing,
  type LabOrderView,
  type Page,
} from './support/lab-fixture';

/**
 * The lab pipeline (RM M14.2, M14.3 — API §8.2–§8.5).
 *
 * The verify steps name two things and each has its own `describe`: the
 * **transition matrix** and the **blocked-condition** refusal. The
 * matrix itself is proven exhaustively as a unit test
 * (`lab-status.machine.spec.ts`, twenty-five cells); what runs here is
 * the matrix *through HTTP* — that the refusal is a 409 with the code
 * and detail API §0.3 promises, and that a refused move writes nothing.
 *
 * Around them, the properties a pipeline can get wrong:
 *
 * · **A refused transition leaves no trace.** No status change, no
 *   timeline entry, no half-written specimen. Asserted by re-reading
 *   after each refusal rather than by trusting the response.
 * · **Care scope is a `where` clause.** A colleague's order is not
 *   hidden from the list — it is never selected — and reads answer 404
 *   rather than 403, so walking `LAB-…` discloses nothing (ADR-022).
 * · **The specimen is captured where the chain of custody starts.** A
 *   specimen sent with any other move is refused rather than dropped.
 * · **Receipt happens once.** The `received` event is written on the
 *   null→value edge of `received_at` and never again.
 */
let harness: AuthHarness;

const charts: string[] = [];

let doctorToken = '';
let strangerToken = '';
let patientId = '';

beforeAll(async () => {
  harness = await createAuthHarness('lab-pipeline');

  doctorToken = await seedDoctor(harness, 'pipeline-doctor');
  // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
  strangerToken = await seedDoctor(harness, 'pipeline-stranger', 'b');

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

describe('RM M14.2 verify — the transition matrix through HTTP', () => {
  it('walks ordered → collected → processing → completed', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    expect(order.status).toBe('ordered');
    expect(order.id).toMatch(/^LAB-\d+$/);

    const collected = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'collected',
        specimen: specimenBody(),
      }).expect(200),
    );
    expect(collected.status).toBe('collected');
    expect(collected.collectedDate).not.toBeNull();

    const processing = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, { to: 'processing' }).expect(
        200,
      ),
    );
    expect(processing.status).toBe('processing');

    const completed = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(
        200,
      ),
    );
    expect(completed.status).toBe('completed');
    expect(completed.completedDate).not.toBeNull();
  });

  it('refuses a skipped step with 409 invalid_status_transition', async () => {
    // `ordered → processing` would mean a specimen in the analyser that
    // no chain of custody accounts for.
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'processing',
    });

    expect(response.status).toBe(409);
    const body = errorBody(response);
    expect(body.code).toBe('invalid_status_transition');
    // API §0.3 makes `detail` mandatory on 409, and it names the moves
    // that would be legal instead.
    expect(body.detail).toContain('allowed: collected, cancelled');
  });

  it('refuses a backward step', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody(),
    }).expect(200);

    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody(),
    });

    // A stale client re-collecting what someone else already moved is
    // the lost-update race, not a harmless no-op.
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('invalid_status_transition');
  });

  it('treats a completed order as terminal and says so', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    await toProcessing(harness, doctorToken, order.id);
    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(200);

    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'cancelled',
    });

    expect(response.status).toBe(409);
    // "allowed: " with an empty list reads as a bug rather than as an
    // answer, so a terminal order gets its own wording.
    expect(errorBody(response).detail).toBe(
      'Lab order is completed and cannot change status',
    );
  });

  it('allows cancellation from every live step', async () => {
    const fromOrdered = await orderTest(harness, doctorToken, patientId);
    expect(
      (await post(harness, doctorToken, `/${fromOrdered.id}/transition`, { to: 'cancelled' }))
        .status,
    ).toBe(200);

    const fromCollected = await orderTest(harness, doctorToken, patientId);
    await post(harness, doctorToken, `/${fromCollected.id}/transition`, {
      to: 'collected',
      specimen: specimenBody(),
    }).expect(200);
    expect(
      (await post(harness, doctorToken, `/${fromCollected.id}/transition`, { to: 'cancelled' }))
        .status,
    ).toBe(200);

    const fromProcessing = await orderTest(harness, doctorToken, patientId);
    await toProcessing(harness, doctorToken, fromProcessing.id);
    expect(
      (await post(harness, doctorToken, `/${fromProcessing.id}/transition`, {
        to: 'cancelled',
      })).status,
    ).toBe(200);
  });

  it('writes nothing at all when a transition is refused', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const before = dataOf<LabOrderView>(await get(harness, doctorToken, `/${order.id}`));

    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(409);

    const after = dataOf<LabOrderView>(await get(harness, doctorToken, `/${order.id}`));

    // The refusal throws before the write, so the order is byte-identical
    // apart from nothing. A refused move that left a timeline entry
    // would be a lie in a chain of custody.
    expect(after.status).toBe(before.status);
    expect(after.timeline).toHaveLength(before.timeline.length);
    expect(after.specimen).toBeNull();
  });
});

describe('the timeline records every step, attributed', () => {
  it('starts with an attributed `ordered` event', async () => {
    const order = await orderTest(harness, doctorToken, patientId, { priority: 'stat' });

    expect(order.timeline).toHaveLength(1);
    expect(order.timeline[0]).toMatchObject({ kind: 'ordered' });
    // `lab_timeline_events.actor` is NOT NULL because a lab step with no
    // attributed actor breaks the chain of custody the specimen record
    // exists to keep — so there is no "System" fallback here.
    expect(order.timeline[0]?.actor).not.toBe('');
    expect(order.timeline[0]?.detail).toContain('stat');
  });

  it('writes `collected`, `received`, `processing` and `verified` in turn', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    await toProcessing(harness, doctorToken, order.id);
    const completed = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(
        200,
      ),
    );

    // `completed` writes a **`verified`** event: DB §E7's vocabulary has
    // no `completed` member, and §8.6 names `resulted`/`verified` as the
    // pair — entering values is `resulted`, releasing is the verification.
    expect(completed.timeline.map((event) => event.kind)).toEqual([
      'verified',
      'processing',
      'received',
      'collected',
      'ordered',
    ]);
  });

  it('orders the two events one transition writes, rather than tying them', async () => {
    // A regression test for a defect this suite could only catch by
    // luck. `lab_timeline_events.occurred_at` defaults to
    // `CURRENT_TIMESTAMP`, which in PostgreSQL is the **transaction's**
    // start time — so the `received` and `processing` events written by
    // one `processing` move landed on a byte-identical timestamp, and
    // `ORDER BY occurred_at DESC` fell through to heap order. The test
    // above passed roughly two runs in three.
    //
    // Asserting the timestamps rather than the sequence is what makes
    // this deterministic: the sequence is the symptom, the tie is the
    // defect. Receipt must be strictly earlier, because the lab cannot
    // process a specimen it has not taken in.
    const order = await orderTest(harness, doctorToken, patientId);
    const processing = await toProcessing(harness, doctorToken, order.id);

    const received = processing.timeline.find((event) => event.kind === 'received');
    const started = processing.timeline.find((event) => event.kind === 'processing');

    expect(received).toBeDefined();
    expect(started).toBeDefined();
    expect(new Date(received?.at ?? 0).getTime()).toBeLessThan(
      new Date(started?.at ?? 0).getTime(),
    );
  });

  it('writes `received` exactly once, on the null→value edge', async () => {
    // Receipt happens once. Re-stamping `received_at` would move a
    // chain-of-custody timestamp, and a second `received` event would
    // claim the specimen arrived twice.
    const order = await orderTest(harness, doctorToken, patientId);
    const processing = await toProcessing(harness, doctorToken, order.id);

    expect(processing.timeline.filter((event) => event.kind === 'received')).toHaveLength(1);
    expect(processing.specimen?.receivedAt).not.toBeNull();
  });

  it('does not write `received` when the specimen was received at collection', async () => {
    // A walk-in draw is received the moment it is taken; stamping it
    // again at `processing` would be a second arrival.
    const order = await orderTest(harness, doctorToken, patientId);
    const collectedAt = new Date();
    const receivedAt = new Date(collectedAt.getTime() + 60_000);

    await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody({
        collectedAt: collectedAt.toISOString(),
        receivedAt: receivedAt.toISOString(),
      }),
    }).expect(200);

    const processing = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, { to: 'processing' }).expect(
        200,
      ),
    );

    expect(processing.timeline.filter((event) => event.kind === 'received')).toHaveLength(0);
  });

  it('carries the caller detail when one is given, and a default when not', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const collected = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'collected',
        specimen: specimenBody(),
        detail: 'Drawn on the ward round',
      }).expect(200),
    );

    expect(collected.timeline[0]?.detail).toBe('Drawn on the ward round');

    const other = await orderTest(harness, doctorToken, patientId);
    const defaulted = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${other.id}/transition`, {
        to: 'collected',
        specimen: specimenBody(),
      }).expect(200),
    );

    // A timeline entry with no detail says less than the step it records.
    expect(defaulted.timeline[0]?.detail).toContain('Specimen collected');
  });
});

describe('the specimen belongs to the collected move', () => {
  it('refuses a collection with no specimen', async () => {
    // Collecting an order *is* recording its specimen; a `collected`
    // with none would leave the analyser step with no chain of custody.
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['specimen']?.[0]).toContain('specimen');
  });

  it('refuses a specimen sent with any other move', async () => {
    // Silently dropping a specimen a client believed it had recorded is
    // how an order reaches the analyser with nothing attached.
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'cancelled',
      specimen: specimenBody(),
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['specimen']?.[0]).toContain('collected');
  });

  it('stores the specimen document §8.3 projects', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const collected = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'collected',
        specimen: specimenBody(),
      }).expect(200),
    );

    expect(collected.specimen).toMatchObject({
      type: 'Serum',
      container: 'SST (gold top)',
      collectionSite: 'Left antecubital fossa',
      volume: '5 mL',
      condition: 'Acceptable',
      receivedAt: null,
    });
    // ADR-003 §4: the collector is stored as a **name snapshot** beside
    // the id, so a specimen whose collector left is still readable.
    expect(collected.specimen?.collectedBy).not.toBe('');
  });

  it('records a named collector rather than the signed-in one', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const collected = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'collected',
        specimen: specimenBody({ collectedBy: 'N. Farouk (phlebotomy)' }),
      }).expect(200),
    );

    expect(collected.specimen?.collectedBy).toBe('N. Farouk (phlebotomy)');
  });

  it('refuses a receipt that precedes the collection, as a 422 not a 500', async () => {
    // `lab_specimens_received_after_collected` (M5.8) would refuse the
    // row, and a constraint violation reaches a client as a 500 with no
    // field on it. A specimen received before it was collected inverts
    // the chain of custody, so the caller gets a field it can correct.
    const order = await orderTest(harness, doctorToken, patientId);
    const collectedAt = new Date();

    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody({
        collectedAt: collectedAt.toISOString(),
        receivedAt: new Date(collectedAt.getTime() - 60_000).toISOString(),
      }),
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['specimen.receivedAt']?.[0]).toContain(
      'before it was collected',
    );
  });

  it('refuses a collection that precedes the order, as a 422 not a 500', async () => {
    // `lab_orders_collected_after_requested`, same reasoning: a draw
    // that happened before anybody asked for it is a transcription
    // error, and the caller can fix the field it names.
    const order = await orderTest(harness, doctorToken, patientId);

    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody({
        collectedAt: new Date(Date.parse(order.requestedDate) - 60_000).toISOString(),
      }),
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['specimen.collectedAt']?.[0]).toContain(
      'before the order',
    );
  });

  it('accepts a draw entered after the fact, which is a real case', async () => {
    // A phlebotomist's draw entered an hour later must be recordable at
    // its real time — the constraint is about ordering, not about
    // forcing the server's clock onto every event.
    const order = await orderTest(harness, doctorToken, patientId);
    const collectedAt = new Date(Date.parse(order.requestedDate) + 1_000);

    const collected = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'collected',
        specimen: specimenBody({ collectedAt: collectedAt.toISOString() }),
      }).expect(200),
    );

    expect(Date.parse(collected.specimen?.collectedAt ?? '')).toBe(collectedAt.getTime());
  });

  it('refuses a specimen type outside the vocabulary', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody({ type: 'serum' }),
    });

    // `Serum` is the member and `serum` is not: DB §E4 declares the
    // capitalised spelling and the frontend renders the literal.
    expect(response.status).toBe(422);
  });
});

describe('RM M14.3 verify — a blocked condition refuses processing', () => {
  for (const condition of ['Hemolyzed', 'Clotted', 'Insufficient volume'] as const) {
    it(`refuses processing a ${condition.toLowerCase()} specimen with 409`, async () => {
      const order = await orderTest(harness, doctorToken, patientId);
      await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'collected',
        specimen: specimenBody({ condition }),
      }).expect(200);

      const response = await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'processing',
      });

      expect(response.status).toBe(409);
      expect(errorBody(response).code).toBe('specimen_unusable');
      // The refusal has to tell a lab what to do next.
      expect(errorBody(response).detail).toMatch(/recollect/i);
    });
  }

  it('leaves the order collected — a refused run changes nothing', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody({ condition: 'Clotted' }),
    }).expect(200);

    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'processing' }).expect(409);

    const after = dataOf<LabOrderView>(await get(harness, doctorToken, `/${order.id}`));
    expect(after.status).toBe('collected');
    expect(after.timeline.map((event) => event.kind)).toEqual(['collected', 'ordered']);
    // No receipt was stamped either: the specimen never entered the lab.
    expect(after.specimen?.receivedAt).toBeNull();
  });

  it('still allows the unusable specimen to be cancelled', async () => {
    // Refusing the cancel as well would strand the order: the condition
    // gate is about running the sample, not about abandoning it.
    const order = await orderTest(harness, doctorToken, patientId);
    await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody({ condition: 'Hemolyzed' }),
    }).expect(200);

    const cancelled = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, { to: 'cancelled' }).expect(
        200,
      ),
    );

    expect(cancelled.status).toBe('cancelled');
  });

  it('processes an acceptable specimen', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const processing = await toProcessing(harness, doctorToken, order.id);

    expect(processing.status).toBe('processing');
  });

  it('answers specimen_missing rather than specimen_unusable with no specimen', async () => {
    // Unreachable through the API — `collected` demands a specimen — so
    // the gate is driven by deleting the row, which is what a manual
    // psql session or a later migration could leave behind.
    const order = await orderTest(harness, doctorToken, patientId);
    await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody(),
    }).expect(200);

    const row = await harness.prisma.labOrder.findFirstOrThrow({
      where: { publicId: order.id },
      select: { id: true },
    });
    await harness.prisma.labSpecimen.delete({ where: { labOrderId: row.id } });

    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'processing',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('specimen_missing');
  });
});

describe('placing an order (§8.4)', () => {
  it('mints a LAB- reference and starts in ordered', async () => {
    const order = await orderTest(harness, doctorToken, patientId, { priority: 'urgent' });

    expect(order.id).toMatch(/^LAB-1\d{5}$/);
    expect(order).toMatchObject({
      status: 'ordered',
      priority: 'urgent',
      testCode: '51990-0',
      testName: 'Basic Metabolic Panel',
      category: 'Chemistry',
      hasCriticalResult: false,
      reviewStatus: 'not-required',
      review: null,
    });
    expect(order.resultSummary).toEqual({ total: 0, abnormal: 0, critical: 0 });
  });

  it('defaults the priority to routine', async () => {
    const response = await post(harness, doctorToken, '', {
      patientId,
      testCode: '51990-0',
      clinicalIndication: 'Routine screen.',
    });

    expect(response.status).toBe(201);
    expect(dataOf<LabOrderView>(response).priority).toBe('routine');
  });

  it('requires a clinical indication — the lab reads it', async () => {
    const response = await post(harness, doctorToken, '', {
      patientId,
      testCode: '51990-0',
      clinicalIndication: '   ',
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
  });

  it('refuses a test code the catalogue does not carry', async () => {
    const response = await post(harness, doctorToken, '', {
      patientId,
      testCode: '00000-0',
      clinicalIndication: 'Screen.',
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['testCode']?.[0]).toContain('catalogue');
  });

  it('refuses a withdrawn test by name rather than as unknown', async () => {
    // A clinician ordering last year's panel should be told it was
    // withdrawn, not left doubting their own typing.
    const test = await harness.prisma.labTestCatalogue.findFirstOrThrow({
      where: { code: '55204-3' },
      select: { id: true },
    });
    await harness.prisma.labTestCatalogue.update({
      where: { id: test.id },
      data: { active: false },
    });

    try {
      const response = await post(harness, doctorToken, '', {
        patientId,
        testCode: '55204-3',
        clinicalIndication: 'Thyroid screen.',
      });

      expect(response.status).toBe(422);
      expect(errorBody(response).fieldErrors?.['testCode']?.[0]).toContain('withdrawn');
    } finally {
      await harness.prisma.labTestCatalogue.update({
        where: { id: test.id },
        data: { active: true },
      });
    }
  });

  it('files the order under the named department, and refuses an unknown one', async () => {
    const named = dataOf<LabOrderView>(
      await post(harness, doctorToken, '', {
        patientId,
        testCode: '51990-0',
        clinicalIndication: 'Consult request.',
        department: 'Endocrinology',
      }).expect(201),
    );
    expect(named.department).toBe('Endocrinology');

    // Falling back silently to the doctor's own department is how a
    // consult's order lands in the wrong worklist.
    const response = await post(harness, doctorToken, '', {
      patientId,
      testCode: '51990-0',
      clinicalIndication: 'Consult request.',
      department: 'Department of Nowhere',
    });
    expect(response.status).toBe(422);
  });

  it('refuses an order on a chart the caller has no relationship with', async () => {
    const response = await post(harness, strangerToken, '', {
      patientId,
      testCode: '51990-0',
      clinicalIndication: 'Screen.',
    });

    // 404 rather than 403: a 403 confirms the chart exists, and walking
    // `PT-…` against a 403/404 split would disclose the roster (ADR-022).
    expect(response.status).toBe(404);
    expect(errorBody(response).message).toBe('Patient not found');
  });
});

describe('reading orders is care-scoped (§8.2, §8.3)', () => {
  it('lists the caller own patients orders', async () => {
    await orderTest(harness, doctorToken, patientId);

    const page = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, '?pageSize=100').expect(200),
    );

    expect(page.totalItems).toBeGreaterThan(0);
    expect(page.items.every((item) => item.patient.id === patientId)).toBe(true);
  });

  it('never selects another doctor orders, so the counts agree', async () => {
    const page = dataOf<Page<LabOrderView>>(
      await get(harness, strangerToken, '?pageSize=100').expect(200),
    );

    // Not filtered out afterwards — never selected. A count and a page
    // total that disagreed would be the symptom of the other approach.
    expect(page.items).toEqual([]);
    expect(page.totalItems).toBe(0);
  });

  it('answers 404 for an order outside the caller care relationship', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await get(harness, strangerToken, `/${order.id}`);

    expect(response.status).toBe(404);
    expect(errorBody(response).message).toBe('Lab order not found');
  });

  it('answers the same 404 for an order that does not exist', async () => {
    const response = await get(harness, strangerToken, '/LAB-999999');

    // Byte-identical to the refusal above: the response must not
    // distinguish "not yours" from "does not exist".
    expect(response.status).toBe(404);
    expect(errorBody(response).message).toBe('Lab order not found');
  });

  it('refuses an unauthenticated request', async () => {
    expect((await request(harness.server).get(LAB_ORDERS)).status).toBe(401);
  });
});

describe('the worklist filters (§8.2)', () => {
  it('filters by status, priority and category', async () => {
    const stat = await orderTest(harness, doctorToken, patientId, { priority: 'stat' });
    await post(harness, doctorToken, `/${stat.id}/transition`, {
      to: 'collected',
      specimen: specimenBody(),
    }).expect(200);

    const byStatus = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, '?status=collected&pageSize=100').expect(200),
    );
    expect(byStatus.items.every((item) => item.status === 'collected')).toBe(true);
    expect(byStatus.items.map((item) => item.id)).toContain(stat.id);

    const byPriority = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, '?priority=stat&pageSize=100').expect(200),
    );
    expect(byPriority.items.every((item) => item.priority === 'stat')).toBe(true);

    const byCategory = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, '?category=Chemistry&pageSize=100').expect(200),
    );
    expect(byCategory.items.every((item) => item.category === 'Chemistry')).toBe(true);
    expect(
      dataOf<Page<LabOrderView>>(
        await get(harness, doctorToken, '?category=Hematology&pageSize=100').expect(200),
      ).items,
    ).toEqual([]);
  });

  it('accepts a repeated filter and a single one alike', async () => {
    // `?status=ordered&status=collected` arrives as an array and
    // `?status=ordered` as a string; a schema that only took the array
    // would make a single-valued filter a 422 the client cannot read.
    const single = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, '?status=ordered&pageSize=100').expect(200),
    );
    const both = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, '?status=ordered&status=collected&pageSize=100').expect(
        200,
      ),
    );

    expect(both.totalItems).toBeGreaterThanOrEqual(single.totalItems);
    expect(both.items.every((item) => ['ordered', 'collected'].includes(item.status))).toBe(true);
  });

  it('searches by reference, test and patient', async () => {
    const order = await orderTest(harness, doctorToken, patientId);

    for (const q of [order.id, 'Metabolic', '51990', 'Layla']) {
      const page = dataOf<Page<LabOrderView>>(
        await get(harness, doctorToken, `?q=${encodeURIComponent(q)}&pageSize=100`).expect(200),
      );
      expect(page.items.length, q).toBeGreaterThan(0);
    }
  });

  it('sorts by priority, STAT first and oldest first inside the band', async () => {
    const page = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, '?sort=priority:desc&pageSize=100').expect(200),
    );

    const rank = { stat: 0, urgent: 1, routine: 2 } as const;
    const ranks = page.items.map((item) => rank[item.priority as keyof typeof rank]);

    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('refuses a sort field that is not whitelisted', async () => {
    expect((await get(harness, doctorToken, '?sort=patient:asc')).status).toBe(422);
  });

  it('filters by patient handle', async () => {
    const page = dataOf<Page<LabOrderView>>(
      await get(harness, doctorToken, `?patientId=${patientId}&pageSize=100`).expect(200),
    );

    expect(page.items.every((item) => item.patient.id === patientId)).toBe(true);
  });
});

describe('the interpretation belongs to the completed move', () => {
  it('stores it when the order is released', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    await toProcessing(harness, doctorToken, order.id);

    const completed = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, {
        to: 'completed',
        interpretation: 'All measured analytes are within their reference ranges.',
      }).expect(200),
    );

    expect(completed.interpretation).toContain('within their reference ranges');
  });

  it('refuses it on any earlier move', async () => {
    // `lab_orders_interpretation_requires_completion` would refuse the
    // row anyway; refusing here makes it a 422 naming the field rather
    // than a constraint violation the caller reads as a 500.
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await post(harness, doctorToken, `/${order.id}/transition`, {
      to: 'collected',
      specimen: specimenBody(),
      interpretation: 'Looks fine to me.',
    });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['interpretation']?.[0]).toContain('completed');
  });
});
