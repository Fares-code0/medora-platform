/**
 * Staff-mediated patient account linking (ADR-048, contract §1).
 *
 * The patient issues a code; Hospital Admin staff, after an in-person
 * identity document check, enter it against a record their hospital holds.
 * Covers: code issue / expiry / reuse / invalidation, the happy path,
 * every refusal the contract names, hospital reach (404 across hospitals),
 * and unlink revoking the account's sessions.
 */

import { createHash } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  grantPlatformAdmin,
  makeClinicalDoctor,
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
const PASSWORD = 'Medora123!';
const TAG = 'lnk';
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/;
const VERIFICATION = { method: 'in_person_id_document', documentType: 'national_id' } as const;

let harness: AuthHarness;
let records: PatientRecord[];
let hospitalA: string;
let hospitalB: string;
let adminA: string;
let adminB: string;
let platformAdmin: string;
let doctor: string;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function currentCode(secret: string): string {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();
}

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(`${PREFIX}/auth/login`)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function patientAccount(local: string): Promise<{ token: string; userId: string }> {
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
  return { token: await login(email), userId: user.id };
}

async function admin(local: string, scope: { platform: true } | { hospitalId: string }): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const bootstrap = await login(email);
  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post(`${PREFIX}/me/2fa/setup`).set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;
  await request(harness.server).post(`${PREFIX}/me/2fa/enable`).set(as(bootstrap)).send({ code: currentCode(secret) });
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const user = await harness.prisma.user.update({ where: { email }, data: { roleId: role.id }, select: { id: true } });
  if ('platform' in scope) await grantPlatformAdmin(harness.prisma, email);
  else {
    await harness.prisma.hospitalRoleAssignment.create({
      data: { userId: user.id, hospitalId: scope.hospitalId, roleId: role.id },
    });
  }
  const otp = dataOf<{ otpToken: string }>(
    await request(harness.server).post(`${PREFIX}/auth/login`).send({ email, password: PASSWORD }),
  ).otpToken;
  return dataOf<{ accessToken: string }>(
    await request(harness.server).post(`${PREFIX}/auth/otp/verify`).send({ otpToken: otp, code: currentCode(secret) }),
  ).accessToken;
}

async function issue(token: string): Promise<{ code: string; expiresAt: string }> {
  const response = await request(harness.server).post(`${PREFIX}/me/patient-link/code`).set(as(token));
  expect(response.status).toBe(201);
  return dataOf<{ code: string; expiresAt: string }>(response);
}

function link(token: string, patientPublicId: string, code: string, verification: object = VERIFICATION) {
  return request(harness.server)
    .post(`${PREFIX}/patients/${patientPublicId}/account-link`)
    .set(as(token))
    .send({ code, verification });
}

async function unlinkAll(): Promise<void> {
  await harness.prisma.patient.updateMany({
    where: { id: { in: records.map((record) => record.id) } },
    data: { userId: null },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-account-link');
  records = await createPatientRecords(harness.prisma, TAG, 3);
  hospitalA = await fixtureHospital(harness.prisma, 'lnka');
  hospitalB = await fixtureHospital(harness.prisma, 'lnkb');
  await recordPatientAt(harness.prisma, records[0]!.id, hospitalA);
  await recordPatientAt(harness.prisma, records[1]!.id, hospitalA);
  await recordPatientAt(harness.prisma, records[2]!.id, hospitalB);

  adminA = await admin('admin-a', { hospitalId: hospitalA });
  adminB = await admin('admin-b', { hospitalId: hospitalB });
  platformAdmin = await admin('admin-p', { platform: true });

  const doctorEmail = testEmail('doctor');
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email: doctorEmail }));
  await markVerified(harness.prisma, doctorEmail);
  await makeClinicalDoctor(harness.prisma, doctorEmail, hospitalA);
  doctor = await login(doctorEmail);
}, 120_000);

afterAll(async () => {
  await unlinkAll();
  await harness.prisma.patientAccountLinkCode.deleteMany({
    where: { user: { is: { email: { endsWith: `@${harness.domain}` } } } },
  });
  await harness.reset();
  await destroyPatientRecords(harness.prisma, TAG);
  await harness.close();
});

describe('GET /me/patient-link', () => {
  it('answers 403 patient_only to a non-patient', async () => {
    const response = await request(harness.server).get(`${PREFIX}/me/patient-link`).set(as(doctor));
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('patient_only');
  });

  it('answers linked: false for a fresh patient account', async () => {
    const alice = await patientAccount('status-alice');
    const response = await request(harness.server).get(`${PREFIX}/me/patient-link`).set(as(alice.token));
    expect(response.status).toBe(200);
    expect(dataOf(response)).toEqual({ linked: false, patient: null });
  });
});

describe('POST /me/patient-link/code', () => {
  it('refuses a non-patient with 403 patient_only', async () => {
    const response = await request(harness.server).post(`${PREFIX}/me/patient-link/code`).set(as(doctor));
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('patient_only');
  });

  it('issues an 8-character code valid for 15 minutes and stores only its digest', async () => {
    const pat = await patientAccount('issue');
    const before = Date.now();
    const { code, expiresAt } = await issue(pat.token);
    expect(code).toMatch(CODE_RE);
    const ttl = new Date(expiresAt).getTime() - before;
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 5_000);

    const rows = await harness.prisma.patientAccountLinkCode.findMany({ where: { userId: pat.userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).toBe(sha256(code));
    expect(JSON.stringify(rows)).not.toContain(code);
  });

  it('invalidates the previous code when a new one is issued', async () => {
    await unlinkAll();
    const pat = await patientAccount('reissue');
    const first = await issue(pat.token);
    const second = await issue(pat.token);
    expect(second.code).not.toBe(first.code);
    expect(await harness.prisma.patientAccountLinkCode.count({ where: { userId: pat.userId } })).toBe(1);

    const stale = await link(adminA, records[0]!.publicId, first.code);
    expect(stale.status).toBe(422);
    expect(errorBody(stale).code).toBe('link_code_invalid');

    const fresh = await link(adminA, records[0]!.publicId, second.code);
    expect(fresh.status).toBe(200);
  });
});

describe('staff link (POST /patients/:patientId/account-link)', () => {
  it('links after an in-person check, audits method and document type only, and the code is single-use', async () => {
    await unlinkAll();
    const pat = await patientAccount('happy');
    const { code } = await issue(pat.token);
    const grouped = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();

    const response = await link(adminA, records[0]!.publicId, grouped, {
      method: 'in_person_id_document',
      documentType: 'passport',
    });
    expect(response.status).toBe(200);
    const body = dataOf<{ patient: { id: string }; linkedAt: string }>(response);
    expect(body.patient).toEqual({ id: records[0]!.publicId });
    expect(Number.isNaN(Date.parse(body.linkedAt))).toBe(false);

    const status = await request(harness.server).get(`${PREFIX}/me/patient-link`).set(as(pat.token));
    expect(dataOf(status)).toEqual({
      linked: true,
      patient: { id: records[0]!.publicId, fullName: 'Test Patient 1' },
    });

    const audit = await harness.prisma.auditEvent.findFirst({
      where: { eventType: 'patient.account.link', target: `patient:${records[0]!.publicId}` },
      orderBy: { occurredAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.hospitalId).toBe(hospitalA);
    const payload = JSON.stringify(audit!.payload);
    expect(payload).toContain('in_person_id_document');
    expect(payload).toContain('passport');
    expect(payload).not.toContain(code);

    // Linked: the patient cannot issue another code.
    const again = await request(harness.server).post(`${PREFIX}/me/patient-link/code`).set(as(pat.token));
    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('already_linked');

    // Used: the same code cannot link a second record.
    const reuse = await link(adminA, records[1]!.publicId, code);
    expect(reuse.status).toBe(422);
    expect(errorBody(reuse).code).toBe('link_code_invalid');
  });

  it('refuses an expired code with 422 link_code_invalid', async () => {
    await unlinkAll();
    const pat = await patientAccount('expired');
    const { code } = await issue(pat.token);
    await harness.prisma.patientAccountLinkCode.updateMany({
      where: { userId: pat.userId },
      data: { createdAt: new Date(Date.now() - 20 * 60_000), expiresAt: new Date(Date.now() - 5 * 60_000) },
    });
    const response = await link(adminA, records[0]!.publicId, code);
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('link_code_invalid');
    expect((await harness.prisma.patient.findUniqueOrThrow({ where: { id: records[0]!.id } })).userId).toBeNull();
  });

  it('refuses unknown and malformed codes alike', async () => {
    for (const code of ['ABCDEFGH', 'nope', '0000-0000']) {
      const response = await link(adminA, records[0]!.publicId, code);
      expect(response.status).toBe(422);
      expect(errorBody(response).code).toBe('link_code_invalid');
    }
  });

  it('refuses a document number or an unknown verification method', async () => {
    const pat = await patientAccount('docnum');
    const { code } = await issue(pat.token);
    const withNumber = await link(adminA, records[0]!.publicId, code, {
      ...VERIFICATION,
      documentNumber: '29001011234567',
    });
    expect(withNumber.status).toBe(422);
    const remote = await link(adminA, records[0]!.publicId, code, { method: 'email', documentType: 'passport' });
    expect(remote.status).toBe(422);
  });

  it('answers 409 patient_already_linked for a record that already has an account', async () => {
    await unlinkAll();
    const first = await patientAccount('owner');
    await link(adminA, records[0]!.publicId, (await issue(first.token)).code).expect(200);

    const second = await patientAccount('claimant');
    const response = await link(adminA, records[0]!.publicId, (await issue(second.token)).code);
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('patient_already_linked');
  });

  it('answers 409 account_already_linked for an account linked to another record', async () => {
    await unlinkAll();
    const pat = await patientAccount('twice');
    await link(adminA, records[0]!.publicId, (await issue(pat.token)).code).expect(200);
    // A linked account cannot issue a code through the API; plant one to
    // prove the server's own check.
    await harness.prisma.patientAccountLinkCode.create({
      data: { userId: pat.userId, codeHash: sha256('QRSTUVWX'), expiresAt: new Date(Date.now() + 600_000) },
    });
    const response = await link(adminA, records[1]!.publicId, 'QRSTUVWX');
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('account_already_linked');
  });

  it('answers 422 account_not_patient for a code held by a non-patient account', async () => {
    await unlinkAll();
    const doctorRow = await harness.prisma.user.findUniqueOrThrow({ where: { email: testEmail('doctor') } });
    await harness.prisma.patientAccountLinkCode.create({
      data: { userId: doctorRow.id, codeHash: sha256('MNPQRSTU'), expiresAt: new Date(Date.now() + 600_000) },
    });
    const response = await link(adminA, records[0]!.publicId, 'MNPQRSTU');
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('account_not_patient');
  });

  it('answers 404 to staff of another hospital, and to a Platform Admin', async () => {
    await unlinkAll();
    const pat = await patientAccount('reach');
    const { code } = await issue(pat.token);

    const other = await link(adminB, records[0]!.publicId, code);
    expect(other.status).toBe(404);
    const platform = await link(platformAdmin, records[0]!.publicId, code);
    expect(platform.status).toBe(404);
    const unknown = await link(adminA, 'PT-TNOSUCH', code);
    expect(unknown.status).toBe(404);

    // Nothing was consumed: the right hospital can still use the code.
    await link(adminB, records[2]!.publicId, code).expect(200);
  });

  it('answers 403 to a role without patients.manageAccounts', async () => {
    const response = await link(doctor, records[0]!.publicId, 'ABCDEFGH');
    expect(response.status).toBe(403);
  });
});

describe('staff unlink (DELETE /patients/:patientId/account-link)', () => {
  it('unlinks, audits, and revokes the account sessions so the old token is refused', async () => {
    await unlinkAll();
    const pat = await patientAccount('unlink');
    await link(adminA, records[1]!.publicId, (await issue(pat.token)).code).expect(200);
    await request(harness.server).get(`${PREFIX}/me/patient-link`).set(as(pat.token)).expect(200);

    const other = await request(harness.server)
      .delete(`${PREFIX}/patients/${records[1]!.publicId}/account-link`)
      .set(as(adminB));
    expect(other.status).toBe(404);

    const response = await request(harness.server)
      .delete(`${PREFIX}/patients/${records[1]!.publicId}/account-link`)
      .set(as(adminA));
    expect(response.status).toBe(200);
    const body = dataOf<{ patient: { id: string }; sessionsRevoked: number }>(response);
    expect(body.patient).toEqual({ id: records[1]!.publicId });
    expect(body.sessionsRevoked).toBeGreaterThanOrEqual(1);

    const stale = await request(harness.server).get(`${PREFIX}/me/patient-link`).set(as(pat.token));
    expect(stale.status).toBe(401);
    expect(
      await harness.prisma.session.count({ where: { userId: pat.userId, revokedAt: null } }),
    ).toBe(0);
    expect((await harness.prisma.patient.findUniqueOrThrow({ where: { id: records[1]!.id } })).userId).toBeNull();
    expect(
      await harness.prisma.auditEvent.count({
        where: { eventType: 'patient.account.unlink', target: `patient:${records[1]!.publicId}` },
      }),
    ).toBeGreaterThanOrEqual(1);

    const again = await request(harness.server)
      .delete(`${PREFIX}/patients/${records[1]!.publicId}/account-link`)
      .set(as(adminA));
    expect(again.status).toBe(409);
  });
});
