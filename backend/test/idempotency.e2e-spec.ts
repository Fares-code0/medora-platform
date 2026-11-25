import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { IdempotencyStore } from '../src/shared/idempotency';
import {
  asJob,
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  makeClinicalDoctor,
  markVerified,
  purgeHospitalRecords,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * `Idempotency-Key` — ADR-014, API §0.5 ("replays return the original
 * result"), MG §8.4 ("prescription send, appointment create, message
 * send").
 *
 * ADR-014's own testing line is the spine of this file: "A replayed POST
 * with the same key returns the original result and does not create a
 * second row. Two different users using the same key string get their own
 * results." Every replay is asserted against the **table**, not only the
 * response — a replay that answered correctly while writing a second
 * signed prescription would be the defect this exists to prevent.
 */
let harness: AuthHarness;
let store: IdempotencyStore;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const PRESCRIPTIONS = '/api/v1/prescriptions';
const CONVERSATIONS = '/api/v1/conversations';
const PASSWORD = 'Medora123!';

interface Account {
  readonly token: string;
  readonly userId: string;
}

let doctor: Account;
let colleague: Account;
let patientId = '';
let amoxilId = '';
const charts: string[] = [];

async function signIn(local: string): Promise<Account> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return { token, userId: user.id };
}

async function createPatient(token: string): Promise<string> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Rana Retry',
      dateOfBirth: '1990-06-01',
      gender: 'female',
      bloodType: 'B+',
      phone: '+20 100 222 3344',
      allergies: [],
      chronicConditions: [],
    });
  expect(response.status).toBe(201);
  const id = dataOf<{ id: string }>(response).id;
  charts.push(id);

  return id;
}

function draftBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    patientId,
    medicationId: amoxilId,
    strength: '500 mg',
    dosage: '1 capsule',
    frequency: 'Three times daily',
    durationDays: 7,
    quantity: 21,
    refillsAllowed: 0,
    instructions: 'Take with food.',
    startDate: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

function postDraft(account: Account, key: string | undefined, body = draftBody()) {
  const call = request(harness.server)
    .post(PRESCRIPTIONS)
    .set('Authorization', `Bearer ${account.token}`);

  return (key === undefined ? call : call.set('Idempotency-Key', key)).send(body);
}

function prescriptionCount(): Promise<number> {
  return harness.prisma.prescription.count({ where: { patient: { publicId: patientId } } });
}

function uniqueKey(label: string): string {
  return `${label}-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

beforeAll(async () => {
  harness = await createAuthHarness('idempotency');
  store = harness.app.get(IdempotencyStore);

  doctor = await signIn('idem-doctor');
  colleague = await signIn('idem-colleague');
  patientId = await createPatient(doctor.token);

  amoxilId = (
    await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Amoxil' },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (charts.length > 0) {
    const owned = { patient: { publicId: { in: charts } } };
    await harness.prisma.patientMedication.deleteMany({ where: owned });
    await harness.prisma.prescription.deleteMany({ where: owned });
    const rows = await harness.prisma.patient.findMany({
      where: { publicId: { in: charts } },
      select: { id: true },
    });
    await purgeHospitalRecords(
      harness.prisma,
      rows.map((row) => row.id),
    );
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: charts } } });
  }

  // `idempotency_records` cascades from `users`, which `reset` removes.
  await harness.reset();
  await harness.close();
});

describe('a replayed POST returns the original result and writes nothing', () => {
  it('creates one draft for two requests with one key', async () => {
    const key = uniqueKey('draft');
    const before = await prescriptionCount();

    const first = await postDraft(doctor, key);
    const second = await postDraft(doctor, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(first.headers['idempotency-replayed']).toBeUndefined();
    expect(dataOf<{ id: string }>(second).id).toBe(dataOf<{ id: string }>(first).id);
    expect(second.body).toEqual(first.body);
    expect(await prescriptionCount()).toBe(before + 1);
  });

  it('signs once: a replayed /sign returns the signature instead of a 409', async () => {
    const draft = dataOf<{ id: string }>(await postDraft(doctor, undefined));
    const key = uniqueKey('sign');

    const sign = () =>
      request(harness.server)
        .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .set('Idempotency-Key', key)
        .send({});

    const first = await sign();
    const second = await sign();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(dataOf<{ signedAt: string }>(second).signedAt).toBe(
      dataOf<{ signedAt: string }>(first).signedAt,
    );

    // Without the key, the same retry is the double-submit the machine refuses.
    const unkeyed = await request(harness.server)
      .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({});
    expect(unkeyed.status).toBe(409);
  });

  it('sends one message for two requests with one key', async () => {
    const thread = await request(harness.server)
      .post(CONVERSATIONS)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ participantIds: [colleague.userId], topic: 'Retry safety' });
    expect(thread.status).toBe(201);
    const conversationId = dataOf<{ id: string }>(thread).id;
    const key = uniqueKey('message');

    const send = () =>
      request(harness.server)
        .post(`${CONVERSATIONS}/${conversationId}/messages`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .set('Idempotency-Key', key)
        .send({ body: 'Please review the new results.' });

    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);

    expect(await harness.prisma.message.count({ where: { conversationId } })).toBe(1);
  });

  it('leaves the default path alone: no header, two drafts', async () => {
    const before = await prescriptionCount();

    expect((await postDraft(doctor, undefined)).status).toBe(201);
    expect((await postDraft(doctor, undefined)).status).toBe(201);

    expect(await prescriptionCount()).toBe(before + 2);
  });
});

describe('a key is one request, for one user', () => {
  it('refuses the same key with a different body: 422 idempotency_key_reused', async () => {
    const key = uniqueKey('mismatch');
    await postDraft(doctor, key);

    const reused = await postDraft(doctor, key, draftBody({ quantity: 42 }));

    expect(reused.status).toBe(422);
    expect(errorBody(reused).code).toBe('idempotency_key_reused');
  });

  it('refuses the same key on another endpoint', async () => {
    const key = uniqueKey('endpoint');
    const draft = dataOf<{ id: string }>(await postDraft(doctor, key));

    const elsewhere = await request(harness.server)
      .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .set('Idempotency-Key', key)
      .send(draftBody());

    expect(elsewhere.status).toBe(422);
    expect(errorBody(elsewhere).code).toBe('idempotency_key_reused');
  });

  it('treats a reordered body as the same request', async () => {
    const key = uniqueKey('order');
    const body = draftBody();
    const reversed = Object.fromEntries(Object.entries(body).reverse());

    const first = await postDraft(doctor, key, body);
    const second = await postDraft(doctor, key, reversed);

    expect(second.status).toBe(201);
    expect(dataOf<{ id: string }>(second).id).toBe(dataOf<{ id: string }>(first).id);
  });

  it('never returns one user’s result to another user holding the same key', async () => {
    const key = uniqueKey('shared');
    const colleaguePatient = await createPatient(colleague.token);

    const mine = await postDraft(doctor, key);
    const theirs = await postDraft(colleague, key, draftBody({ patientId: colleaguePatient }));

    expect(theirs.status).toBe(201);
    expect(theirs.headers['idempotency-replayed']).toBeUndefined();
    expect(dataOf<{ id: string }>(theirs).id).not.toBe(dataOf<{ id: string }>(mine).id);
  });

  it('refuses a malformed key with 422 naming the header', async () => {
    const response = await postDraft(doctor, 'x'.repeat(129));

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors).toHaveProperty('Idempotency-Key');
  });
});

describe('failures, concurrency and expiry', () => {
  it('releases the key when the request fails, so the corrected retry executes', async () => {
    const key = uniqueKey('release');

    const failed = await postDraft(doctor, key, draftBody({ quantity: 0 }));
    expect(failed.status).toBe(422);

    const retried = await postDraft(doctor, key);
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotency-replayed']).toBeUndefined();
  });

  it('lets one of two concurrent first requests execute', async () => {
    const key = uniqueKey('race');
    const before = await prescriptionCount();

    const responses = await Promise.all([postDraft(doctor, key), postDraft(doctor, key)]);
    const statuses = responses.map((response) => response.status);

    expect(await prescriptionCount()).toBe(before + 1);
    expect(statuses).toContain(201);
    for (const status of statuses) expect([201, 409]).toContain(status);

    const loser = responses.find((response) => response.status === 409);
    if (loser !== undefined) {
      expect(errorBody(loser).code).toBe('idempotency_request_in_progress');
    }
  });

  it('executes again once the 24 h window has passed', async () => {
    const key = uniqueKey('expired');
    const first = await postDraft(doctor, key);

    await harness.prisma.idempotencyRecord.updateMany({
      where: { userId: doctor.userId, key },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const second = await postDraft(doctor, key);

    expect(second.status).toBe(201);
    expect(dataOf<{ id: string }>(second).id).not.toBe(dataOf<{ id: string }>(first).id);
  });

  it('purges expired records and keeps live ones', async () => {
    const live = uniqueKey('live');
    const stale = uniqueKey('stale');
    await postDraft(doctor, live);
    await postDraft(doctor, stale);
    await harness.prisma.idempotencyRecord.updateMany({
      where: { userId: doctor.userId, key: stale },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    // As JobRunnerService runs the sweep: under explicit `system` scope
    // (idempotency_records is owner-scoped under RLS, M1).
    expect(await asJob(store).purgeExpired()).toBeGreaterThanOrEqual(1);

    const keys = (
      await harness.prisma.idempotencyRecord.findMany({
        where: { userId: doctor.userId, key: { in: [live, stale] } },
        select: { key: true },
      })
    ).map((row) => row.key);
    expect(keys).toEqual([live]);
  });
});
