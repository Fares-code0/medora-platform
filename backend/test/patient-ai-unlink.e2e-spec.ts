/**
 * Personal assistant history does not survive an unlink (audit R-04;
 * ADR-048 unlink, ADR-050 personal mode).
 *
 * A personal thread is owned by the account, not the record, and its turns
 * were answered from the record it was linked to. On a staff unlink the
 * account's personal threads and their turns are deleted in the unlink's
 * own transaction, so:
 *
 * - the old thread ids answer 404 and the list no longer shows them;
 * - after a relink to a different record, nothing from the former record
 *   is replayed to the model — the next personal thread starts clean;
 * - general threads (whose prompt carries no record data) and other
 *   patients' threads are untouched;
 * - a repeated unlink is a 409 that deletes nothing further;
 * - a failure anywhere in the unlink rolls the deletes back with it, and
 *   the session revocation still holds on success.
 *
 * Cache evidence: the personal context is re-read from the database on
 * every turn (`PatientAiContextService.load`); the AI module holds no cache,
 * so the relink case below — the new record's data in the prompt, the old
 * record's absent — is the observable proof.
 */

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AI_GATEWAY, type AiDelta, type AiGatewayPort, type AiGenerationRequest } from '../src/shared/ai';
import { TransactionalAuditWriter } from '../src/shared/audit';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  fixtureHospital,
  markVerified,
  recordPatientAt,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

const PREFIX = '/api/v1';
const ME_AI = `${PREFIX}/me/ai/conversations`;
const PASSWORD = 'Medora123!';
const TAG = 'pau';
const VERIFICATION = { method: 'in_person_id_document', documentType: 'national_id' } as const;
const PROVIDER_NAME = 'E2E R04 Insurer';
const OLD_PLAN = 'OLD-RECORD-PLAN-4411';
const NEW_PLAN = 'NEW-RECORD-PLAN-5522';
const OLD_QUESTION = 'OLD-QUESTION-about-my-insurance';
const OLD_DELETED_QUESTION = 'OLD-QUESTION-in-a-soft-deleted-thread';
const GENERAL_QUESTION = 'GENERAL-QUESTION what is HbA1c';
const OTHER_QUESTION = 'OTHER-PATIENT-QUESTION';
const NEW_QUESTION = 'NEW-QUESTION after relink';

let calls: AiGenerationRequest[] = [];

const fakeGateway: AiGatewayPort = {
  async *generate(req: AiGenerationRequest): AsyncIterable<AiDelta> {
    calls.push(req);
    await Promise.resolve();
    yield { text: 'Answer.' };
  },
  describe: () => ({ name: 'Fake', version: 'test', configured: true }),
};

interface Account {
  readonly email: string;
  readonly userId: string;
  token: string;
}

let harness: AuthHarness;
let records: PatientRecord[];
let hospital: string;
let adminToken: string;
let x: Account;
let y: Account;

/** X's threads, created while linked to records[0]. */
let personal = '';
let personalSoftDeleted = '';
let general = '';
/** Y's thread, linked to records[2] throughout. */
let otherPersonal = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function currentCode(secret: string): string {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();
}

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(`${PREFIX}/auth/login`)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function patientAccount(local: string): Promise<Account> {
  const email = testEmail(local);
  await request(harness.server)
    .post(`${PREFIX}/auth/register`)
    .send(registrationBody({ email, role: 'patient' }))
    .expect(201);
  await request(harness.server)
    .post(`${PREFIX}/auth/verify-email`)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { email, userId: user.id, token: await login(email) };
}

async function hospitalAdmin(local: string, hospitalId: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email })).expect(201);
  await markVerified(harness.prisma, email);
  const bootstrap = await login(email);
  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post(`${PREFIX}/me/2fa/setup`).set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;
  await request(harness.server).post(`${PREFIX}/me/2fa/enable`).set(as(bootstrap)).send({ code: currentCode(secret) });
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const user = await harness.prisma.user.update({ where: { email }, data: { roleId: role.id }, select: { id: true } });
  await harness.prisma.hospitalRoleAssignment.create({ data: { userId: user.id, hospitalId, roleId: role.id } });
  const otp = dataOf<{ otpToken: string }>(
    await request(harness.server).post(`${PREFIX}/auth/login`).send({ email, password: PASSWORD }),
  ).otpToken;
  return dataOf<{ accessToken: string }>(
    await request(harness.server).post(`${PREFIX}/auth/otp/verify`).send({ otpToken: otp, code: currentCode(secret) }),
  ).accessToken;
}

async function staffLink(account: Account, record: PatientRecord): Promise<void> {
  const issued = await request(harness.server).post(`${PREFIX}/me/patient-link/code`).set(as(account.token));
  expect(issued.status).toBe(201);
  const { code } = dataOf<{ code: string }>(issued);
  await request(harness.server)
    .post(`${PREFIX}/patients/${record.publicId}/account-link`)
    .set(as(adminToken))
    .send({ code, verification: VERIFICATION })
    .expect(200);
}

function staffUnlink(record: PatientRecord): request.Test {
  return request(harness.server).delete(`${PREFIX}/patients/${record.publicId}/account-link`).set(as(adminToken));
}

async function thread(token: string, mode: 'general' | 'personal'): Promise<string> {
  const response = await request(harness.server).post(ME_AI).set(as(token)).send({ mode });
  expect(response.status).toBe(201);
  return dataOf<{ id: string }>(response).id;
}

async function send(token: string, id: string, content: string): Promise<number> {
  const response = await request(harness.server)
    .post(`${ME_AI}/${id}/messages`)
    .set(as(token))
    .send({ content })
    .buffer(true)
    .parse((res, callback) => {
      res.on('data', () => undefined);
      res.on('end', () => callback(null, null));
    });
  return response.status;
}

/** Every patient-assistant row of an account, soft-deleted ones included. */
async function threadsOf(userId: string): Promise<{ id: string; patientMode: string | null; messages: number }[]> {
  const rows = await harness.prisma.aiConversation.findMany({
    where: { ownerId: userId, patientMode: { not: null } },
    select: { id: true, patientMode: true, _count: { select: { messages: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => ({ id: row.id, patientMode: row.patientMode, messages: row._count.messages }));
}

async function insure(record: PatientRecord, plan: string): Promise<void> {
  const provider = await harness.prisma.insuranceProvider.upsert({
    where: { name: PROVIDER_NAME },
    create: { name: PROVIDER_NAME },
    update: {},
  });
  await harness.prisma.patientInsurance.create({
    data: { patientId: record.id, providerId: provider.id, policyNumber: `POL-${plan}`, plan, isActive: true },
  });
}

async function cleanup(): Promise<void> {
  if (records === undefined) return;
  await harness.prisma.patient.updateMany({
    where: { id: { in: records.map((record) => record.id) } },
    data: { userId: null },
  });
  await harness.prisma.patientInsurance.deleteMany({ where: { patientId: { in: records.map((r) => r.id) } } });
  await harness.prisma.insuranceProvider.deleteMany({ where: { name: PROVIDER_NAME } });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-ai-unlink', {
    overrides: [{ token: AI_GATEWAY, value: fakeGateway }],
  });
  records = await createPatientRecords(harness.prisma, TAG, 3);
  await cleanup();
  hospital = await fixtureHospital(harness.prisma, 'pau');
  for (const record of records) await recordPatientAt(harness.prisma, record.id, hospital);
  await insure(records[0]!, OLD_PLAN);
  await insure(records[1]!, NEW_PLAN);

  adminToken = await hospitalAdmin('pau-admin', hospital);
  x = await patientAccount('pau-x');
  y = await patientAccount('pau-y');
  await staffLink(x, records[0]!);
  await staffLink(y, records[2]!);
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  vi.restoreAllMocks();
  await cleanup();
  await harness.prisma.patientAccountLinkCode.deleteMany({
    where: { user: { is: { email: { endsWith: `@${harness.domain}` } } } },
  });
  await harness.reset();
  await destroyPatientRecords(harness.prisma, TAG);
  await harness.close();
});

beforeEach(() => {
  calls = [];
});

describe('R-04: personal assistant history on unlink', () => {
  it('personal turns are answered from the linked record (the history at stake)', async () => {
    personal = await thread(x.token, 'personal');
    expect(await send(x.token, personal, OLD_QUESTION)).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.system).toContain(OLD_PLAN);

    personalSoftDeleted = await thread(x.token, 'personal');
    expect(await send(x.token, personalSoftDeleted, OLD_DELETED_QUESTION)).toBe(200);
    await request(harness.server).delete(`${ME_AI}/${personalSoftDeleted}`).set(as(x.token)).expect(204);

    general = await thread(x.token, 'general');
    expect(await send(x.token, general, GENERAL_QUESTION)).toBe(200);
    // General mode loads no record data: the prompt is built from the locale alone.
    expect(calls.at(-1)!.system).not.toContain(OLD_PLAN);
    expect(calls.at(-1)!.system).not.toContain(PROVIDER_NAME);

    otherPersonal = await thread(y.token, 'personal');
    expect(await send(y.token, otherPersonal, OTHER_QUESTION)).toBe(200);

    expect((await threadsOf(x.userId)).map((t) => t.messages)).toEqual([2, 2, 2]);
  });

  it('a failure inside the unlink rolls everything back: link, sessions and history all intact', async () => {
    const writer = harness.app.get(TransactionalAuditWriter);
    const original = writer.recordWithin.bind(writer);
    const spy = vi.spyOn(writer, 'recordWithin').mockImplementation(async (tx, event) => {
      if (event.action === 'patient.account.unlink') throw new Error('injected audit failure');
      return original(tx, event);
    });
    try {
      const response = await staffUnlink(records[0]!);
      expect(response.status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect((await harness.prisma.patient.findUniqueOrThrow({ where: { id: records[0]!.id } })).userId).toBe(x.userId);
    expect((await threadsOf(x.userId)).map((t) => t.messages)).toEqual([2, 2, 2]);
    await request(harness.server).get(`${ME_AI}/${personal}`).set(as(x.token)).expect(200);
  });

  it('unlink deletes the account’s personal threads and turns (soft-deleted too), keeps general and other patients’, and revokes the sessions', async () => {
    const otherBefore = await threadsOf(y.userId);

    const response = await staffUnlink(records[0]!);
    expect(response.status).toBe(200);
    expect(dataOf<{ sessionsRevoked: number }>(response).sessionsRevoked).toBeGreaterThanOrEqual(1);

    // Personal threads and their turns are gone from the table, not hidden.
    const remaining = await threadsOf(x.userId);
    expect(remaining).toEqual([{ id: general, patientMode: 'general', messages: 2 }]);
    expect(
      await harness.prisma.aiConversation.count({ where: { id: { in: [personal, personalSoftDeleted] } } }),
    ).toBe(0);
    expect(
      await harness.prisma.aiMessage.count({ where: { conversationId: { in: [personal, personalSoftDeleted] } } }),
    ).toBe(0);
    expect(
      await harness.prisma.aiMessage.count({
        where: { content: { in: [OLD_QUESTION, OLD_DELETED_QUESTION] } },
      }),
    ).toBe(0);

    // Another patient's conversation is untouched.
    expect(await threadsOf(y.userId)).toEqual(otherBefore);
    await request(harness.server).get(`${ME_AI}/${otherPersonal}`).set(as(y.token)).expect(200);

    // The session revocation still holds: the old token is refused.
    await request(harness.server).get(`${ME_AI}`).set(as(x.token)).expect(401);
    expect(await harness.prisma.session.count({ where: { userId: x.userId, revokedAt: null } })).toBe(0);

    // The audit row records how many threads went, never their content.
    const audit = await harness.prisma.auditEvent.findFirst({
      where: { eventType: 'patient.account.unlink', target: `patient:${records[0]!.publicId}` },
      orderBy: { occurredAt: 'desc' },
    });
    const payload = JSON.stringify(audit?.payload ?? null);
    expect(payload).toContain('"personalAiThreadsDeleted":2');
    expect(payload).not.toContain(OLD_QUESTION);
  });

  it('a repeated unlink is a 409 and deletes nothing further', async () => {
    const mine = await threadsOf(x.userId);
    // `threadsOf` carries each thread's message count, so equality below
    // also proves no turn was deleted. (Not a table-wide count: other spec
    // files write `ai_messages` concurrently.)
    const theirs = await threadsOf(y.userId);

    const again = await staffUnlink(records[0]!);
    expect(again.status).toBe(409);

    expect(await threadsOf(x.userId)).toEqual(mine);
    expect(await threadsOf(y.userId)).toEqual(theirs);
  });

  it('the old thread ids answer 404 after sign-in, and only the general thread is listed', async () => {
    x.token = await login(x.email);

    for (const id of [personal, personalSoftDeleted]) {
      await request(harness.server).get(`${ME_AI}/${id}`).set(as(x.token)).expect(404);
      expect(await send(x.token, id, 'anyone there?')).toBe(404);
    }
    const listed = await request(harness.server).get(ME_AI).set(as(x.token)).expect(200);
    expect(dataOf<{ id: string; mode: string }[]>(listed).map((t) => [t.id, t.mode])).toEqual([[general, 'general']]);
  });

  it('relinked to a different record, the next personal thread starts clean: no old turns, no old context', async () => {
    await staffLink(x, records[1]!);

    // Old ids stay gone under the new link too.
    await request(harness.server).get(`${ME_AI}/${personal}`).set(as(x.token)).expect(404);

    const fresh = await thread(x.token, 'personal');
    expect(await send(x.token, fresh, NEW_QUESTION)).toBe(200);
    expect(calls).toHaveLength(1);
    const sent = calls[0]!;

    // Context is re-read for the new record; nothing cached from the old one.
    expect(sent.system).toContain(NEW_PLAN);
    expect(sent.system).not.toContain(OLD_PLAN);
    // Only the new question is replayed.
    expect(sent.turns).toEqual([{ role: 'user', content: NEW_QUESTION }]);
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain(OLD_QUESTION);
    expect(wire).not.toContain(OLD_DELETED_QUESTION);

    const listed = await request(harness.server).get(ME_AI).set(as(x.token)).expect(200);
    expect(dataOf<{ id: string }[]>(listed).map((t) => t.id).sort()).toEqual([fresh, general].sort());
  });
});
