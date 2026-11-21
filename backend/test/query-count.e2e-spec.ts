import pg from 'pg';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import {
  PASSWORD,
  destroyLabFixtures,
  orderTest,
  seedDoctor,
  seedPatient,
} from './support/lab-fixture';

/**
 * RM M32.3 — "no N+1 on the top-10 endpoints (query-count assertions)".
 *
 * An N+1 is a list that issues one more query per row it returns. It
 * passes every functional test, because the answer is right, and it is
 * invisible on a developer's five-row database. So the property asserted
 * here is the definition itself: **the number of SQL statements a list
 * request sends does not depend on how many rows it returns.** Each list
 * is read with `pageSize=1` and `pageSize=5` over the same data, and the
 * two counts must be equal. The row counts are asserted too (1 and 5), so
 * an empty list cannot make the comparison pass by accident.
 *
 * The doctor dashboard is a composite, not a list, so it is compared
 * across data instead: read with one of everything, then with five.
 *
 * ## How statements are counted
 *
 * `pg.Client.prototype.query` is wrapped for this test process. Every
 * statement `@prisma/adapter-pg` sends goes through it, pooled or in a
 * transaction (`Pool.query` delegates to a client), so the count is what
 * PostgreSQL receives, with no change to production code. Vitest runs
 * each file in its own worker, so no other suite is counted.
 *
 * Each request is made once before it is counted. The first request for
 * an account warms its permission cache, and that is a one-off cost, not
 * a per-row one.
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const PER_KIND = 5;
const FUTURE_MONDAY = '2027-03-01';
const SLOTS = ['09:00', '09:30', '10:00', '10:30', '11:00'];

let statements = 0;
const originalQuery = pg.Client.prototype.query;

const charts: string[] = [];
let doctor = '';
let colleague = { token: '', userId: '' };
let doctorUserId = '';
let admin = '';
let amoxilId = '';
let dashboardWithOne = 0;
let dashboardWithMany = 0;

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** Statements sent for one request, after one warm-up request. */
async function statementsFor(
  token: string,
  path: string,
): Promise<{ count: number; body: unknown }> {
  await request(harness.server).get(path).set(auth(token)).expect(200);

  statements = 0;
  const response = await request(harness.server).get(path).set(auth(token)).expect(200);
  return { count: statements, body: response.body as unknown };
}

/** The rows in a list response: `data` itself, or the first array inside it. */
function rowsIn(body: unknown): number {
  const data = (body as { data?: unknown }).data;
  if (Array.isArray(data)) return data.length;
  const list = Object.values((data ?? {}) as Record<string, unknown>).find(Array.isArray);
  return Array.isArray(list) ? list.length : -1;
}

function week(): unknown[] {
  const open = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => ({
    weekday,
    open: open.includes(weekday),
    windows: open.includes(weekday) ? [{ start: '09:00', end: '17:00' }] : [],
    breaks: open.includes(weekday) ? [{ start: '12:00', end: '13:00' }] : [],
  }));
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function login(email: string): Promise<{ accessToken?: string; otpToken?: string }> {
  return dataOf(
    await request(harness.server)
      .post(`${PREFIX}/auth/login`)
      .send({ email, password: PASSWORD, rememberMe: false }),
  );
}

/** ADR-035: an administrator signs in with a second factor. */
async function adminToken(): Promise<string> {
  const email = testEmail('qc-admin');
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = (await login(email)).accessToken ?? '';
  const { secret } = dataOf<{ secret: string }>(
    await request(harness.server).post(`${PREFIX}/me/2fa/setup`).set(auth(bootstrap)).send({ password: PASSWORD }),
  );
  await request(harness.server)
    .post(`${PREFIX}/me/2fa/enable`)
    .set(auth(bootstrap))
    .send({ code: currentCode(secret) });
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: role.id } });

  const { otpToken } = await login(email);
  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(`${PREFIX}/auth/otp/verify`)
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
}

/** One chart with a visit, a lab order, a signed prescription and a booking. */
async function chartWithEverything(index: number): Promise<void> {
  const patient = await seedPatient(harness, doctor, { fullName: `Count Sweep ${index}` });
  charts.push(patient.id);

  await request(harness.server)
    .post(`${PREFIX}/medical-records`)
    .set(auth(doctor))
    .send({
      patientId: patient.id,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Persistent headache for two weeks',
      historyOfPresentIllness: 'Gradual onset, worse in the mornings, no aura.',
      physicalExamination: 'Alert and oriented. No focal neurological deficit.',
    })
    .expect(201);

  await orderTest(harness, doctor, patient.id);

  const draft = dataOf<{ id: string }>(
    await request(harness.server)
      .post(`${PREFIX}/prescriptions`)
      .set(auth(doctor))
      .send({
        patientId: patient.id,
        medicationId: amoxilId,
        strength: '500 mg',
        dosage: '1 capsule',
        frequency: 'Three times daily',
        durationDays: 7,
        quantity: 21,
        refillsAllowed: 0,
        instructions: 'Take with food. Complete the course.',
        startDate: '2026-09-14T00:00:00.000Z',
      })
      .expect(201),
  );
  await request(harness.server)
    .post(`${PREFIX}/prescriptions/${draft.id}/sign`)
    .set(auth(doctor))
    .send({})
    .expect(200);

  await request(harness.server)
    .post(`${PREFIX}/appointments`)
    .set(auth(doctor))
    .send({
      patientId: patient.id,
      dateTime: `${FUTURE_MONDAY}T${SLOTS[index] ?? '11:30'}:00.000Z`,
      visitType: 'Consultation',
      reason: 'Follow-up',
    })
    .expect(201);

  const thread = dataOf<{ id: string }>(
    await request(harness.server)
      .post(`${PREFIX}/conversations`)
      .set(auth(doctor))
      .send({ participantIds: [colleague.userId], topic: `Case ${index}` })
      .expect(201),
  );
  await request(harness.server)
    .post(`${PREFIX}/conversations/${thread.id}/messages`)
    .set(auth(colleague.token))
    .send({ body: 'Reviewed, agreed.' })
    .expect(201);

  await harness.prisma.db.notification.create({
    data: {
      recipientId: doctorUserId,
      title: 'Lab result ready',
      body: 'A result is ready for review.',
      category: 'APPOINTMENTS',
      priority: 'NORMAL',
      kind: 'UPDATE',
      sender: 'Medora Clinic',
    },
  });
}

beforeAll(async () => {
  pg.Client.prototype.query = function counted(this: pg.Client, ...args: unknown[]) {
    statements += 1;
    return (originalQuery as (...params: unknown[]) => unknown).apply(this, args);
  } as typeof originalQuery;

  harness = await createAuthHarness('query-count');

  amoxilId = (
    await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Amoxil' },
      select: { id: true },
    })
  ).id;

  doctor = await seedDoctor(harness, 'qc-doctor');
  doctorUserId = (
    await harness.prisma.user.findUniqueOrThrow({ where: { email: testEmail('qc-doctor') } })
  ).id;
  await request(harness.server)
    .put(`${PREFIX}/me/availability`)
    .set(auth(doctor))
    .send({ week: week(), defaultDurationMin: 30, bufferMin: 0 })
    .expect(200);

  colleague = {
    token: await seedDoctor(harness, 'qc-colleague'),
    userId: (
      await harness.prisma.user.findUniqueOrThrow({ where: { email: testEmail('qc-colleague') } })
    ).id,
  };

  admin = await adminToken();

  await chartWithEverything(0);
  dashboardWithOne = (await statementsFor(doctor, `${PREFIX}/dashboard/doctor`)).count;

  for (let index = 1; index < PER_KIND; index += 1) await chartWithEverything(index);
  dashboardWithMany = (await statementsFor(doctor, `${PREFIX}/dashboard/doctor`)).count;
}, 180_000);

afterAll(async () => {
  pg.Client.prototype.query = originalQuery;
  if (harness === undefined) return;

  const patients = { patient: { publicId: { in: charts } } };
  await harness.prisma.appointment.deleteMany({ where: patients });
  await harness.prisma.patientMedication.deleteMany({ where: patients });
  await harness.prisma.prescription.deleteMany({ where: patients });
  await harness.prisma.db.conversation.deleteMany({
    where: { participants: { some: { userId: { in: [doctorUserId, colleague.userId] } } } },
  });
  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

/** The ten hot reads: the doctor's lists, the badge feed, and two administrator surfaces. */
const LISTS: ReadonlyArray<readonly [string, 'doctor' | 'admin']> = [
  ['/patients', 'doctor'],
  ['/appointments', 'doctor'],
  ['/medical-records', 'doctor'],
  ['/lab-orders', 'doctor'],
  ['/prescriptions', 'doctor'],
  ['/conversations', 'doctor'],
  ['/notifications', 'doctor'],
  ['/audit-events', 'admin'],
  ['/admin/users', 'admin'],
];

describe('M32.3 — a list costs the same number of statements at any page size', () => {
  for (const [path, who] of LISTS) {
    it(`GET ${path}`, async () => {
      const token = who === 'admin' ? admin : doctor;
      const one = await statementsFor(token, `${PREFIX}${path}?pageSize=1`);
      const five = await statementsFor(token, `${PREFIX}${path}?pageSize=${PER_KIND}`);

      // Not vacuous: the second read really returned more rows.
      expect(rowsIn(one.body)).toBe(1);
      expect(rowsIn(five.body)).toBe(PER_KIND);
      expect(five.count).toBe(one.count);
    });
  }

  it('GET /dashboard/doctor costs the same with one of everything and with five', () => {
    expect(dashboardWithOne).toBeGreaterThan(0);
    expect(dashboardWithMany).toBe(dashboardWithOne);
  });
});

describe('the counter itself', () => {
  it('sees statements the application sends', async () => {
    // Without this, a counter that saw nothing would pass every case above.
    statements = 0;
    await request(harness.server).get(`${PREFIX}/patients`).set(auth(doctor)).expect(200);
    expect(statements).toBeGreaterThan(0);
  });
});
