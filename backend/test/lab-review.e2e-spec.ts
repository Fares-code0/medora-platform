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
  toProcessing,
  type LabOrderView,
} from './support/lab-fixture';

/**
 * The review workflow (RM M14.5 — API §8.7) and the summary (§8.10).
 *
 * The verify step names two things and each has its own `describe`:
 *
 *  1. **a bulk request containing a critical row → 422**, and
 *  2. **a failed write returns 5xx (never 200)**.
 *
 * The second is the harder one to test honestly. "No optimistic success"
 * is a property of what happens when the write *fails*, so it is driven
 * by making the write fail for real — the bulk transaction is pointed at
 * an order whose row has been removed underneath it — rather than by
 * asserting that the happy path returns 200.
 *
 * Around them, the discipline the module exists for:
 *
 * · **Bulk means normal, not non-critical.** A merely high potassium is
 *   refused from the bulk path too, because the point of the restriction
 *   is that a result a doctor should have looked at never gets cleared
 *   by a checkbox in a header row.
 * · **A tick with no reason is not an acknowledgment.**
 * · **A partial bulk request writes nothing**, and names every row it
 *   refused — a bulk review that quietly skips the critical results is
 *   worse than one that refuses them.
 */
let harness: AuthHarness;

const charts: string[] = [];

let doctorToken = '';
let strangerToken = '';
let patientId = '';

interface SummaryView {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  criticalUnreviewed: number;
  unreviewed: number;
}

/**
 * A released order whose potassium is whatever the caller asks for.
 *
 * `completed` rather than merely resulted, because §8.7 reviews a
 * released result — and because it exercises the `verified` half of
 * §8.6 on the way.
 */
async function releasedOrder(potassium: string): Promise<LabOrderView> {
  const order = await orderTest(harness, doctorToken, patientId);
  await toProcessing(harness, doctorToken, order.id);

  await post(harness, doctorToken, `/${order.id}/results`, {
    results: [
      { analyte: 'Potassium', value: potassium },
      { analyte: 'Sodium', value: '140' },
    ],
  }).expect(200);

  return dataOf<LabOrderView>(
    await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(200),
  );
}

function criticalIds(order: LabOrderView): string[] {
  return order.results
    .filter((result) => result.flag.startsWith('critical-'))
    .map((result) => result.id);
}

function bulk(token: string, body: Record<string, unknown>): request.Test {
  return request(harness.server)
    .post(`${LAB_ORDERS}/review`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  harness = await createAuthHarness('lab-review');

  doctorToken = await seedDoctor(harness, 'review-doctor');
  strangerToken = await seedDoctor(harness, 'review-stranger');

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

describe('RM M14.5 verify — a bulk request containing a critical row is 422', () => {
  it('refuses the whole request and writes nothing', async () => {
    const normal = await releasedOrder('4.2');
    const critical = await releasedOrder('7.2');

    const response = await bulk(doctorToken, { ids: [normal.id, critical.id], bulk: true });

    expect(response.status).toBe(422);
    const body = errorBody(response);
    expect(body.code).toBe('bulk_review_refused');
    // Keyed by reference, so a client can mark the offending rows
    // individually — which is what "review it on its own" asks for.
    expect(body.fieldErrors?.[critical.id]?.[0]).toContain('reference range');

    // Nothing was written. Reviewing the eligible half and reporting the
    // rest would return 2xx for a request that did not do what was
    // asked, and the safe reading of a 2xx is "all of it worked".
    const after = dataOf<LabOrderView>(await get(harness, doctorToken, `/${normal.id}`));
    expect(after.review).toBeNull();
    expect(after.reviewStatus).toBe('unreviewed');
  });

  it('refuses a merely abnormal row too — "bulk allowed only for Normal"', async () => {
    // 5.6 is high and not critical. The restriction is about results a
    // doctor should have *looked at*, which a high potassium is.
    const high = await releasedOrder('5.6');
    const response = await bulk(doctorToken, { ids: [high.id], bulk: true });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.[high.id]?.[0]).toContain('reference range');
  });

  it('cannot be bought past with acknowledgments', async () => {
    // The bulk branch is checked before the acknowledgment branch on
    // purpose: bulk is not where a critical value gets reviewed, however
    // completely the client fills in the form.
    const critical = await releasedOrder('7.2');

    const response = await bulk(doctorToken, {
      ids: [critical.id],
      bulk: true,
      acknowledgedResultIds: criticalIds(critical),
      note: 'Called the ward.',
    });

    expect(response.status).toBe(422);
  });

  it('clears a batch whose every flag is normal', async () => {
    const first = await releasedOrder('4.2');
    const second = await releasedOrder('4.4');

    const response = await bulk(doctorToken, { ids: [first.id, second.id], bulk: true });

    expect(response.status).toBe(200);
    const reviewed = dataOf<{ reviewed: LabOrderView[] }>(response).reviewed;
    expect(reviewed.map((order) => order.id).sort()).toEqual([first.id, second.id].sort());
    expect(reviewed.every((order) => order.reviewStatus === 'reviewed')).toBe(true);
    expect(reviewed.every((order) => order.review !== null)).toBe(true);
  });

  it('names every refused row, not just the first', async () => {
    const criticalA = await releasedOrder('7.2');
    const criticalB = await releasedOrder('1.9');

    const response = await bulk(doctorToken, { ids: [criticalA.id, criticalB.id], bulk: true });

    expect(Object.keys(errorBody(response).fieldErrors ?? {}).sort()).toEqual(
      [criticalA.id, criticalB.id].sort(),
    );
  });

  it('refuses an order with nothing released and one already reviewed', async () => {
    const pending = await orderTest(harness, doctorToken, patientId);
    const done = await releasedOrder('4.2');
    await post(harness, doctorToken, `/${done.id}/review`, {}).expect(200);

    const response = await bulk(doctorToken, { ids: [pending.id, done.id], bulk: true });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.[pending.id]?.[0]).toContain('no released results');
    expect(errorBody(response).fieldErrors?.[done.id]?.[0]).toContain('already');
  });
});

describe('RM M14.5 verify — a failed write returns 5xx, never 200', () => {
  it('surfaces a write failure rather than reporting a shorter list', async () => {
    // Two normal orders pass the partition, and one of them is removed
    // between the read and the write. The transaction's second statement
    // then targets a row that no longer exists, which is the closest
    // honest reproduction of "the write failed" — and the request must
    // not come back 200 with one reviewed.
    const survivor = await releasedOrder('4.2');
    const doomed = await releasedOrder('4.4');

    const doomedRow = await harness.prisma.labOrder.findFirstOrThrow({
      where: { publicId: doomed.id },
      select: { id: true },
    });

    // A foreign key that RESTRICTs would make this a delete failure
    // rather than a missing row, so the children go first — the same
    // order `destroyLabFixtures` uses.
    await harness.prisma.labOrder.delete({ where: { id: doomedRow.id } });

    const response = await bulk(doctorToken, { ids: [survivor.id, doomed.id], bulk: true });

    // A row the caller named and the server cannot find is a 404 before
    // any write is attempted — which is the same rule, applied earlier:
    // the request does not partially succeed.
    expect(response.status).toBe(404);
    expect(errorBody(response).message).toContain(doomed.id);

    const after = dataOf<LabOrderView>(await get(harness, doctorToken, `/${survivor.id}`));
    expect(after.review).toBeNull();
  });

  it('answers 409 rather than 200 when a row is reviewed mid-flight', async () => {
    // The compare-and-set loses. The honest answer is a 409 naming the
    // difference rather than a 200 implying the whole batch was this
    // caller's work.
    const first = await releasedOrder('4.2');
    const second = await releasedOrder('4.4');

    // Someone else reviews `second` between this caller's read and its
    // write, simulated by writing the attribution directly.
    const reviewer = await harness.prisma.user.findFirstOrThrow({
      where: { email: { endsWith: `@${harness.domain}` } },
      select: { id: true },
    });
    await harness.prisma.labOrder.updateMany({
      where: { publicId: second.id },
      data: { reviewedAt: new Date(), reviewedBy: reviewer.id },
    });

    const response = await bulk(doctorToken, { ids: [first.id, second.id], bulk: true });

    // The partition sees `second` as already reviewed, so the request is
    // refused before the write — again, never a partial 200.
    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.[second.id]?.[0]).toContain('already');
  });

  it('never returns a reviewed list shorter than the request', async () => {
    // Seeded one after the other, not with `Promise.all`. This line once
    // surfaced ECONNRESET under a loaded parallel run: supertest opened
    // the listener on the first request that found the server closed and
    // closed it when that request finished, resetting the overlapping
    // one. `createAuthHarness` now binds the server once up front, which
    // removes that race (RA-M10.2) — but nothing about this case needs
    // concurrency either: what is being asserted is that a bulk review of
    // two orders returns two, not that two orders can be created at once.
    const orders = [await releasedOrder('4.2'), await releasedOrder('4.3')];
    const response = await bulk(doctorToken, {
      ids: orders.map((order) => order.id),
      bulk: true,
    });

    expect(response.status).toBe(200);
    expect(dataOf<{ reviewed: LabOrderView[] }>(response).reviewed).toHaveLength(orders.length);
  });
});

describe('individual review (§8.7)', () => {
  it('marks a normal result reviewed with no acknowledgment', async () => {
    const order = await releasedOrder('4.2');
    const reviewed = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/review`, {}).expect(200),
    );

    expect(reviewed.reviewStatus).toBe('reviewed');
    expect(reviewed.review?.reviewedBy).not.toBe('');
    expect(reviewed.review?.reviewedAt).not.toBe('');
  });

  it('refuses a critical result with no acknowledgment', async () => {
    const order = await releasedOrder('7.2');
    const response = await post(harness, doctorToken, `/${order.id}/review`, {});

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('acknowledgment_required');
    expect(errorBody(response).detail).toContain('Acknowledge every critical value');
  });

  it('refuses a tick with no reason — that is not an acknowledgment', async () => {
    const order = await releasedOrder('7.2');
    const response = await post(harness, doctorToken, `/${order.id}/review`, {
      acknowledgedResultIds: criticalIds(order),
      note: '   ',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('acknowledgment_required');
    expect(errorBody(response).detail).toContain('note');
  });

  it('accepts a fully acknowledged critical result with a note', async () => {
    const order = await releasedOrder('7.2');
    const reviewed = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/review`, {
        acknowledgedResultIds: criticalIds(order),
        note: 'Called the ward; repeat sample requested and insulin-dextrose started.',
      }).expect(200),
    );

    expect(reviewed.reviewStatus).toBe('reviewed');
  });

  it('refuses a partial acknowledgment rather than truncating it', async () => {
    // Two criticals, one ticked. Acknowledging some and having the rest
    // cleared anyway is the accident this exists to prevent.
    const order = await orderTest(harness, doctorToken, patientId);
    await toProcessing(harness, doctorToken, order.id);
    await post(harness, doctorToken, `/${order.id}/results`, {
      results: [
        { analyte: 'Potassium', value: '7.2' },
        { analyte: 'Sodium', value: '118' },
      ],
    }).expect(200);
    const released = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/transition`, { to: 'completed' }).expect(
        200,
      ),
    );

    expect(criticalIds(released)).toHaveLength(2);

    const response = await post(harness, doctorToken, `/${order.id}/review`, {
      acknowledgedResultIds: [criticalIds(released)[0]],
      note: 'Called the ward.',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('acknowledgment_required');
  });

  it('refuses an order with nothing released', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    const response = await post(harness, doctorToken, `/${order.id}/review`, {});

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('nothing_to_review');
  });

  it('refuses a second review rather than overwriting the first attribution', async () => {
    const order = await releasedOrder('4.2');
    await post(harness, doctorToken, `/${order.id}/review`, {}).expect(200);

    const response = await post(harness, doctorToken, `/${order.id}/review`, {});

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('already_reviewed');
  });

  it('is care-scoped like every other read', async () => {
    const order = await releasedOrder('4.2');
    const response = await post(harness, strangerToken, `/${order.id}/review`, {});

    expect(response.status).toBe(404);
  });

  /**
   * D-14.1 — the acknowledgment is dispatched, and today that is all.
   *
   * `lab_orders` has no acknowledgment columns (DB §E3), and
   * `LabTimelineKind` has no `reviewed` member, so the evidence goes to
   * `AUDIT_DISPATCHER`. Its **current** implementation is
   * `LoggingAuditDispatcher`, an M2 stub that writes a log line — the
   * `audit_events` table is not wired to it until M28. So the note is
   * not queryable anywhere yet, and this asserts what is actually true
   * today: the call site is real and carries the right payload.
   *
   * A second application is booted with the dispatcher substituted, the
   * way RM M13.3's chaos test substitutes `INTERACTION_SOURCE` — the
   * only honest way to observe a port whose production implementation
   * stores nothing.
   */
  it('dispatches the acknowledgment with the review (D-14.1)', async () => {
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/app.module');
    const { AUDIT_DISPATCHER } = await import('../src/shared/audit');
    const { PLATFORM_POLICY_SOURCE } = await import('../src/config/policy.types');

    const recorded: { action: string; entityId: string; metadata?: unknown }[] = [];

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLATFORM_POLICY_SOURCE)
      .useValue({ load: () => Promise.resolve({}) })
      .overrideProvider(AUDIT_DISPATCHER)
      .useValue({
        record: (event: { action: string; entityId: string; metadata?: unknown }) => {
          recorded.push(event);
          return Promise.resolve();
        },
      })
      .compile();

    const recordingApp = moduleRef.createNestApplication();
    recordingApp.setGlobalPrefix('api/v1');
    await recordingApp.init();

    try {
      const server = recordingApp.getHttpServer() as Parameters<typeof request>[0];
      const order = await releasedOrder('1.9');

      await request(server)
        .post(`${LAB_ORDERS}/${order.id}/review`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({
          acknowledgedResultIds: criticalIds(order),
          note: 'Repeat sample drawn; potassium replaced.',
        })
        .expect(200);

      const entry = recorded.find(
        (event) => event.action === 'lab_order.review' && event.entityId === order.id,
      );
      const metadata = entry?.metadata as Record<string, unknown> | undefined;

      expect(metadata?.['hadCritical']).toBe(true);
      expect(metadata?.['acknowledgmentNote']).toBe('Repeat sample drawn; potassium replaced.');
      // Joined, because `AuditMetadata` is scalar-only by design.
      expect(metadata?.['acknowledgedResultIds']).toBe(criticalIds(order).join(', '));
    } finally {
      await recordingApp.close();
    }
  });
});

describe('the summary (§8.10)', () => {
  it('counts the caller own scope by status', async () => {
    const summary = dataOf<SummaryView>(await get(harness, doctorToken, '/summary').expect(200));

    expect(summary.total).toBeGreaterThan(0);
    expect(
      summary.pending + summary.inProgress + summary.completed + summary.cancelled,
    ).toBe(summary.total);
  });

  it('counts an unreviewed critical result in criticalUnreviewed', async () => {
    const before = dataOf<SummaryView>(await get(harness, doctorToken, '/summary').expect(200));

    const order = await releasedOrder('7.2');

    const after = dataOf<SummaryView>(await get(harness, doctorToken, '/summary').expect(200));
    expect(after.criticalUnreviewed).toBe(before.criticalUnreviewed + 1);

    // …and stops counting it once it is reviewed. The chip means
    // "critical results waiting on you", not "critical results".
    await post(harness, doctorToken, `/${order.id}/review`, {
      acknowledgedResultIds: criticalIds(order),
      note: 'Called the ward.',
    }).expect(200);

    const reviewed = dataOf<SummaryView>(await get(harness, doctorToken, '/summary').expect(200));
    expect(reviewed.criticalUnreviewed).toBe(before.criticalUnreviewed);
  });

  it('does not count an order the lab has not resulted as unreviewed', async () => {
    // An order still in the analyser is in nobody's inbox. Folding it in
    // would make the count mean "rows that are not green".
    const before = dataOf<SummaryView>(await get(harness, doctorToken, '/summary').expect(200));
    await orderTest(harness, doctorToken, patientId);
    const after = dataOf<SummaryView>(await get(harness, doctorToken, '/summary').expect(200));

    expect(after.unreviewed).toBe(before.unreviewed);
    expect(after.total).toBe(before.total + 1);
    expect(after.pending).toBe(before.pending + 1);
  });

  it('shows another doctor nothing', async () => {
    const summary = dataOf<SummaryView>(
      await get(harness, strangerToken, '/summary').expect(200),
    );

    expect(summary).toEqual({
      total: 0,
      pending: 0,
      inProgress: 0,
      completed: 0,
      cancelled: 0,
      criticalUnreviewed: 0,
      unreviewed: 0,
    });
  });

  it('is reached before the :labOrderId route', async () => {
    // Nest matches in declaration order; if `:labOrderId` came first,
    // `summary` would be read as an order reference and answer 404.
    const response = await get(harness, doctorToken, '/summary');

    expect(response.status).toBe(200);
    expect(dataOf<SummaryView>(response)).toHaveProperty('criticalUnreviewed');
  });
});

describe('the review status on the order itself', () => {
  it('reads not-required, then unreviewed, then reviewed', async () => {
    const order = await orderTest(harness, doctorToken, patientId);
    expect(order.reviewStatus).toBe('not-required');

    await toProcessing(harness, doctorToken, order.id);
    const resulted = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/results`, {
        results: [{ analyte: 'Potassium', value: '4.2' }],
      }).expect(200),
    );
    expect(resulted.reviewStatus).toBe('unreviewed');

    const reviewed = dataOf<LabOrderView>(
      await post(harness, doctorToken, `/${order.id}/review`, {}).expect(200),
    );
    expect(reviewed.reviewStatus).toBe('reviewed');
  });

  it('filters the worklist by review status', async () => {
    const response = await get(harness, doctorToken, '?reviewStatus=unreviewed&pageSize=100');
    expect(response.status).toBe(200);

    const items = dataOf<{ items: LabOrderView[] }>(response).items;
    expect(items.every((item) => item.reviewStatus === 'unreviewed')).toBe(true);
    expect(items.every((item) => item.resultSummary.total > 0)).toBe(true);
  });

  it('filters the worklist by result flag', async () => {
    const response = await get(harness, doctorToken, '?flag=critical-high&pageSize=100');
    expect(response.status).toBe(200);

    const items = dataOf<{ items: LabOrderView[] }>(response).items;
    expect(items.every((item) => item.resultSummary.critical > 0)).toBe(true);
  });
});
