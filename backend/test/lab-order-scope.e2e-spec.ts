import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, testEmail } from './support/auth-app';
import { assignOwned } from './support/hospital-fixture';
import {
  destroyLabFixtures,
  get,
  orderTest,
  seedDoctor,
  seedPatient,
  type LabOrderView,
  type Page,
} from './support/lab-fixture';

/**
 * The lab worklist's care scope, checked against an oracle (RM M32.3).
 *
 * API §8.2 scopes the list to "own orders / care-scoped": an order this
 * doctor placed, **or** an order for a patient this doctor has a live
 * assignment to. This spec builds every shape that disjunction has, then
 * compares what the API returns, all pages and every filter path, with
 * what an independent SQL statement says each doctor may see. The oracle
 * is written by hand against the tables, not through Prisma's relation
 * filters, so the two cannot share a mistake.
 *
 * It exists because M32.3 rewrites the scope's SQL for speed, and a scope
 * query that drops a row hides a critical result while one that adds a row
 * leaks a chart. It caught the second before the rewrite was attempted:
 * `q` replaced the scope entirely, so any search returned every order on
 * the platform.
 *
 * The fixture, with A, B, C three doctors and P1–P5 five patients:
 *
 * | Patient | Live care | Orders |
 * |---|---|---|
 * | P1 | A (primary) | 2 by A |
 * | P2 | B (primary) | 2 by B |
 * | P3 | A (primary); B consulting, **revoked** | 1 by A, 1 by B (placed before the revocation) |
 * | P4 | A (primary); B consulting, live | 1 by A, 1 by B |
 * | P5 | B (primary) | 1 by B, **soft-deleted** |
 *
 * C has no patients and no orders.
 */
let harness: AuthHarness;

const charts: string[] = [];
const tokens: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' };
const doctorIds: Record<'A' | 'B' | 'C', string> = { A: '', B: '', C: '' };
const patientIds: string[] = [];
const ordersOn: Record<string, string[]> = {};

type Doctor = 'A' | 'B' | 'C';

async function doctorIdFor(local: string): Promise<string> {
  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email: testEmail(local) },
    select: { id: true },
  });

  return (
    await harness.prisma.doctor.findUniqueOrThrow({
      where: { userId: user.id },
      select: { id: true },
    })
  ).id;
}

async function patientUuid(publicId: string): Promise<string> {
  return (
    await harness.prisma.patient.findUniqueOrThrow({ where: { publicId }, select: { id: true } })
  ).id;
}

/** A consulting assignment, live or already revoked. */
async function consult(patientPublicId: string, doctor: Doctor, revoked: boolean): Promise<string> {
  // Owned by the doctor's employment at the suite's hospital (S3/S4).
  const patientId = await patientUuid(patientPublicId);
  await assignOwned(harness.prisma, { patientId, doctorId: doctorIds[doctor], role: 'consulting' });
  const row = await harness.prisma.patientDoctorAssignment.findFirstOrThrow({
    where: { patientId, doctorId: doctorIds[doctor], revokedAt: null },
    select: { id: true },
  });
  if (revoked) {
    await harness.prisma.patientDoctorAssignment.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
  }

  return row.id;
}

async function order(doctor: Doctor, patientPublicId: string): Promise<string> {
  const created = await orderTest(harness, tokens[doctor], patientPublicId);
  (ordersOn[patientPublicId] ??= []).push(created.id);

  return created.id;
}

/**
 * The oracle: plain SQL over the tables, newest first, limited to this
 * spec's charts so another suite's rows can never satisfy it.
 */
async function visibleTo(doctor: Doctor): Promise<string[]> {
  const rows = await harness.prisma.$queryRaw<{ public_id: string }[]>`
    SELECT lo.public_id
    FROM lab_orders lo
    WHERE lo.deleted_at IS NULL
      AND lo.patient_id = ANY(${patientIds}::uuid[])
      AND (
        lo.ordered_by = ${doctorIds[doctor]}::uuid
        OR EXISTS (
          SELECT 1 FROM patient_doctor_assignments a
          WHERE a.patient_id = lo.patient_id
            AND a.doctor_id = ${doctorIds[doctor]}::uuid
            AND a.revoked_at IS NULL
        )
      )
    ORDER BY lo.requested_at DESC`;

  return rows.map((row) => row.public_id);
}

/** Every page of the worklist for one query, in order, with each page's totals. */
async function walk(
  doctor: Doctor,
  query = '',
  pageSize = 2,
): Promise<{ ids: string[]; totals: number[]; pages: number }> {
  const ids: string[] = [];
  const totals: number[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await get(
      harness,
      tokens[doctor],
      `?pageSize=${String(pageSize)}&page=${String(page)}${query}`,
    ).expect(200);
    const body = dataOf<Page<LabOrderView>>(response);

    ids.push(...body.items.map((item) => item.id));
    totals.push(body.totalItems);
    totalPages = body.totalPages;
    page += 1;
    expect(page).toBeLessThan(50);
  } while (page <= totalPages);

  return { ids, totals, pages: totalPages };
}

beforeAll(async () => {
  harness = await createAuthHarness('lab-scope-m32', { clinicalDoctors: true });

  for (const doctor of ['A', 'B', 'C'] as const) {
    tokens[doctor] = await seedDoctor(harness, `scope-${doctor.toLowerCase()}`);
    doctorIds[doctor] = await doctorIdFor(`scope-${doctor.toLowerCase()}`);
  }

  // The creator of a chart is its primary doctor (M7.2).
  const p1 = (await seedPatient(harness, tokens.A, { fullName: 'Scope One' })).id;
  const p2 = (await seedPatient(harness, tokens.B, { fullName: 'Scope Two' })).id;
  const p3 = (await seedPatient(harness, tokens.A, { fullName: 'Scope Three' })).id;
  const p4 = (await seedPatient(harness, tokens.A, { fullName: 'Scope Four' })).id;
  const p5 = (await seedPatient(harness, tokens.B, { fullName: 'Scope Five' })).id;
  charts.push(p1, p2, p3, p4, p5);
  for (const publicId of charts) patientIds.push(await patientUuid(publicId));

  await order('A', p1);
  await order('A', p1);
  await order('B', p2);
  await order('B', p2);

  // B consults on P3, orders, and is then taken off the case.
  const p3Consult = await consult(p3, 'B', false);
  await order('B', p3);
  await order('A', p3);
  await harness.prisma.patientDoctorAssignment.update({
    where: { id: p3Consult },
    data: { revokedAt: new Date() },
  });

  // B consults on P4 and stays on it.
  await consult(p4, 'B', false);
  await order('A', p4);
  await order('B', p4);

  // An order on P5 that is then soft-deleted.
  const deleted = await order('B', p5);
  await harness.prisma.labOrder.updateMany({
    where: { publicId: deleted },
    data: { deletedAt: new Date() },
  });

  // Distinct, known instants: the worklist sorts by `requested_at` alone,
  // so equal instants would make any two orderings both correct.
  const all = await harness.prisma.labOrder.findMany({
    where: { patientId: { in: patientIds } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  for (const [index, row] of all.entries()) {
    await harness.prisma.labOrder.update({
      where: { id: row.id },
      data: { requestedAt: new Date(Date.UTC(2026, 9, 1, 8, index)) },
    });
  }
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

describe('the fixture is the shape it claims', () => {
  it('gives each doctor the set the scope rule implies', async () => {
    const [p1, p2, p3, p4] = charts as [string, string, string, string, string];
    const on = (publicId: string) => ordersOn[publicId] ?? [];

    // A: P1, P3, P4 by care — including B's orders on P3 and P4.
    expect(new Set(await visibleTo('A'))).toEqual(new Set([...on(p1), ...on(p3), ...on(p4)]));
    // B: P2 and P4 by care, plus B's own order on P3 although the
    // consult was revoked. Not A's order on P3, and not the deleted one.
    const bOwnOnP3 = on(p3)[0] as string;
    expect(new Set(await visibleTo('B'))).toEqual(new Set([...on(p2), bOwnOnP3, ...on(p4)]));
    expect(await visibleTo('C')).toEqual([]);
  });
});

describe('the worklist equals the oracle', () => {
  for (const doctor of ['A', 'B', 'C'] as const) {
    it(`doctor ${doctor}: every page, in order, totals consistent`, async () => {
      const expected = await visibleTo(doctor);
      const { ids, totals, pages } = await walk(doctor);

      expect(ids).toEqual(expected);
      expect(new Set(totals)).toEqual(new Set([expected.length]));
      expect(pages).toBe(Math.ceil(expected.length / 2)); // an empty list has 0 pages
    });
  }

  it('is the same set at every page size, ascending as well as descending', async () => {
    for (const doctor of ['A', 'B'] as const) {
      const expected = await visibleTo(doctor);
      for (const size of [1, 3, 100]) {
        expect((await walk(doctor, '', size)).ids).toEqual(expected);
      }
      expect((await walk(doctor, '&sort=requestedAt:asc', 3)).ids).toEqual([...expected].reverse());
    }
  });

  it('a page beyond the last is empty, with the same total', async () => {
    const expected = await visibleTo('A');
    const body = dataOf<Page<LabOrderView>>(
      await get(harness, tokens.A, '?pageSize=2&page=40').expect(200),
    );

    expect(body.items).toEqual([]);
    expect(body.totalItems).toBe(expected.length);
  });
});

describe('search stays inside the scope', () => {
  it('`q` matching every order returns only the scope (it returned the platform before M32.3)', async () => {
    for (const doctor of ['A', 'B', 'C'] as const) {
      const expected = await visibleTo(doctor);
      const { ids, totals } = await walk(doctor, '&q=LAB-', 100);

      expect(ids).toEqual(expected);
      expect(totals[0]).toBe(expected.length);
    }
  });

  it('searching for a patient outside the scope finds nothing', async () => {
    // P2 is B's; A has no relationship with it.
    const { ids } = await walk('A', '&q=Scope Two', 100);
    expect(ids).toEqual([]);

    // P3 is A's; B's consult on it was revoked, so only B's own order shows.
    const p3Orders = ordersOn[charts[2] as string] ?? [];
    expect((await walk('B', '&q=Scope Three', 100)).ids).toEqual([p3Orders[0]]);
  });

  it('a filter narrows the scope and never widens it', async () => {
    for (const doctor of ['A', 'B'] as const) {
      const expected = await visibleTo(doctor);
      const { ids } = await walk(doctor, '&status=ordered', 100);

      expect(ids).toEqual(expected);
      const { ids: urgent } = await walk(doctor, '&priority=urgent', 100);
      expect(urgent).toEqual([]);
    }
  });
});

describe('the other reads share the scope', () => {
  it('opens an order inside the scope and 404s one outside it', async () => {
    const aSees = new Set(await visibleTo('A'));
    const everything = Object.values(ordersOn).flat();

    for (const id of everything) {
      const status = (await get(harness, tokens.A, `/${id}`)).status;
      expect(status).toBe(aSees.has(id) ? 200 : 404);
    }
  });

  it('the summary total equals the scope', async () => {
    for (const doctor of ['A', 'B', 'C'] as const) {
      const summary = dataOf<{ total: number }>(
        await get(harness, tokens[doctor], '/summary').expect(200),
      );

      expect(summary.total).toBe((await visibleTo(doctor)).length);
    }
  });
});
