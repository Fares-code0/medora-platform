/**
 * Exceptional Access / Emergency Override and cross-hospital information
 * requests, over HTTP with real tokens (multi-hospital §2.11, §2.12; audit
 * A-12, A-13).
 *
 * Two hospitals: the patient is recorded at A (by doctor A). Doctor B, at
 * hospital B, has no reach under DR-05; every cross-hospital read below goes
 * through a grant or an approved request, is limited to what was granted,
 * and is audited.
 */

import { randomUUID } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  fixtureHospital,
  grantPlatformAdmin,
  makeClinicalDoctor,
  markVerified,
  purgeHospitalRecords,
  registrationBody,
  testEmail,
} from './support/auth-app';

const PASSWORD = 'Medora123!';
const REASON = 'Patient arrived unconscious at our emergency department';

let harness: AuthHarness;
let hospitalA: string;
let hospitalB: string;
let patient: { id: string; uuid: string };
let doctorA: string;
let doctorB: string;
let hospitalAdminA: string;
let platformAdmin: string;
const patients: string[] = [];

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function currentCode(secret: string): string {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();
}

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function doctor(local: string, hospitalId: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  await makeClinicalDoctor(harness.prisma, email, hospitalId);
  return login(email);
}

async function admin(local: string, scope: { platform: true } | { hospitalId: string }): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const bootstrap = await login(email);
  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post('/api/v1/me/2fa/setup').set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;
  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const user = await harness.prisma.user.update({ where: { email }, data: { roleId: role.id }, select: { id: true } });
  if ('platform' in scope) await grantPlatformAdmin(harness.prisma, email);
  else {
    await harness.prisma.hospitalRoleAssignment.create({
      data: { userId: user.id, hospitalId: scope.hospitalId, roleId: role.id },
    });
  }
  const otp = dataOf<{ otpToken: string }>(
    await request(harness.server).post('/api/v1/auth/login').send({ email, password: PASSWORD }),
  ).otpToken;
  return dataOf<{ accessToken: string }>(
    await request(harness.server).post('/api/v1/auth/otp/verify').send({ otpToken: otp, code: currentCode(secret) }),
  ).accessToken;
}

function breakGlass(token: string, body: Record<string, unknown>) {
  return request(harness.server)
    .post('/api/v1/exceptional-access')
    .set(as(token))
    .send({
      kind: 'EXCEPTIONAL',
      patientId: patient.id,
      hospitalId: hospitalA,
      categories: ['identity', 'allergies'],
      reason: REASON,
      durationMinutes: 30,
      password: PASSWORD,
      ...body,
    });
}

const readGrant = (token: string, grantId: string, category: string) =>
  request(harness.server).get(`/api/v1/exceptional-access/${grantId}/data?category=${category}`).set(as(token));

beforeAll(async () => {
  harness = await createAuthHarness('controlled-access');
  hospitalA = await fixtureHospital(harness.prisma, 'ca_a');
  hospitalB = await fixtureHospital(harness.prisma, 'ca_b');
  await harness.prisma.hospital.update({
    where: { id: hospitalA },
    data: { exceptionalAccessRequiresApproval: false },
  });
  doctorA = await doctor('ca-doctor-a', hospitalA);
  doctorB = await doctor('ca-doctor-b', hospitalB);
  hospitalAdminA = await admin('ca-hadmin-a', { hospitalId: hospitalA });
  platformAdmin = await admin('ca-platform', { platform: true });

  const created = await request(harness.server)
    .post('/api/v1/patients')
    .set(as(doctorA))
    .send({
      fullName: 'Controlled Access Patient',
      dateOfBirth: '1979-02-03',
      gender: 'female',
      bloodType: 'B+',
      phone: '+20 100 555 0101',
      allergies: [{ allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' }],
      chronicConditions: [],
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const publicId = dataOf<{ id: string }>(created).id;
  const row = await harness.prisma.patient.findUniqueOrThrow({ where: { publicId }, select: { id: true } });
  patient = { id: publicId, uuid: row.id };
  patients.push(row.id);
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.prisma.exceptionalAccessGrant.deleteMany({ where: { patientId: { in: patients } } });
  await harness.prisma.informationRequest.deleteMany({ where: { patientId: { in: patients } } });
  await harness.reset();
  await purgeHospitalRecords(harness.prisma, patients);
  await harness.prisma.patient.deleteMany({ where: { id: { in: patients } } });
  await harness.close();
});

describe('baseline: DR-05 isolates hospital B from hospital A’s patient', () => {
  it('answers doctor B as if the patient did not exist', async () => {
    const response = await request(harness.server).get(`/api/v1/patients/${patient.id}`).set(as(doctorB));
    expect(response.status).toBe(404);
  });
});

describe('Exceptional Access (Break-Glass)', () => {
  it('requires re-authentication: a wrong password creates nothing', async () => {
    const before = await harness.prisma.exceptionalAccessGrant.count({ where: { patientId: patient.uuid } });
    const response = await breakGlass(doctorB, { password: 'Wrong-password-1' });
    expect(response.status).toBe(401);
    await expect(harness.prisma.exceptionalAccessGrant.count({ where: { patientId: patient.uuid } })).resolves.toBe(
      before,
    );
  });

  it('requires a reason and a bounded duration', async () => {
    expect((await breakGlass(doctorB, { reason: 'because' })).status).toBe(422);
    expect((await breakGlass(doctorB, { durationMinutes: 2000 })).status).toBe(422);
  });

  it('grants narrowly: only the requester, only the categories, every read audited', async () => {
    const created = await breakGlass(doctorB, {});
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const grant = dataOf<{ id: string; status: string; expiresAt: string }>(created);
    expect(grant.status).toBe('ACTIVE');

    const identity = await readGrant(doctorB, grant.id, 'identity');
    expect(identity.status).toBe(200);
    expect(JSON.stringify(identity.body)).toContain('Controlled Access Patient');
    const allergies = await readGrant(doctorB, grant.id, 'allergies');
    expect(JSON.stringify(allergies.body)).toContain('Penicillin');

    // Outside the granted categories.
    expect((await readGrant(doctorB, grant.id, 'prescriptions')).status).toBe(403);
    // No impersonation: another user cannot read under it.
    expect((await readGrant(doctorA, grant.id, 'identity')).status).toBe(404);

    const reads = await harness.prisma.auditEvent.count({
      where: { eventType: 'exceptional_access.read', target: `exceptional_access_grant:${grant.id}` },
    });
    expect(reads).toBe(2);
    const read = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'exceptional_access.read', target: `exceptional_access_grant:${grant.id}` },
    });
    expect(read.hospitalId).toBe(hospitalA);

    // Revocation ends it at once.
    expect(
      (await request(harness.server).post(`/api/v1/exceptional-access/${grant.id}/revoke`).set(as(doctorB))).status,
    ).toBe(200);
    expect((await readGrant(doctorB, grant.id, 'identity')).status).toBe(403);
  });

  it('expires: a grant past its window reads nothing', async () => {
    const grant = dataOf<{ id: string }>(await breakGlass(doctorB, {}));
    await harness.prisma.exceptionalAccessGrant.update({
      where: { id: grant.id },
      data: { startsAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await readGrant(doctorB, grant.id, 'identity')).status).toBe(403);
  });

  it('waits for an independent approver when the hospital requires one — no data before', async () => {
    await harness.prisma.hospital.update({ where: { id: hospitalA }, data: { exceptionalAccessRequiresApproval: true } });
    try {
      const grant = dataOf<{ id: string; status: string }>(await breakGlass(doctorB, {}));
      expect(grant.status).toBe('PENDING');
      expect((await readGrant(doctorB, grant.id, 'identity')).status).toBe(403);

      // Only hospital A's own Hospital Admin decides: not the requester, not
      // a Platform Admin.
      const approve = (token: string) =>
        request(harness.server).post(`/api/v1/exceptional-access/${grant.id}/approve`).set(as(token)).send({});
      expect((await approve(doctorB)).status).toBe(403);
      expect((await approve(platformAdmin)).status).toBe(403);
      const approved = await approve(hospitalAdminA);
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      expect(dataOf<{ status: string }>(approved).status).toBe('ACTIVE');

      expect((await readGrant(doctorB, grant.id, 'identity')).status).toBe(200);
    } finally {
      await harness.prisma.hospital.update({
        where: { id: hospitalA },
        data: { exceptionalAccessRequiresApproval: false },
      });
    }
  });

  it('Emergency Override: active at once, notifies the hospital, reviewed retrospectively', async () => {
    const created = await breakGlass(doctorB, { kind: 'EMERGENCY' });
    expect(created.status).toBe(201);
    const grant = dataOf<{ id: string; status: string }>(created);
    expect(grant.status).toBe('ACTIVE');

    const audit = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'exceptional_access.emergency_override', target: `exceptional_access_grant:${grant.id}` },
    });
    expect(audit.severity).toBe('CRITICAL');
    const adminUser = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('ca-hadmin-a') },
      select: { id: true },
    });
    await expect(
      harness.prisma.userActivityLog.count({ where: { userId: adminUser.id, detail: grant.id } }),
    ).resolves.toBe(1);

    const review = await request(harness.server)
      .post(`/api/v1/exceptional-access/${grant.id}/review`)
      .set(as(hospitalAdminA))
      .send({ outcome: 'JUSTIFIED' });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    expect(dataOf<{ reviewOutcome: string }>(review).reviewOutcome).toBe('JUSTIFIED');
  });

  it('refuses a doctor without clinical standing', async () => {
    const email = testEmail('ca-unverified');
    await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
    await markVerified(harness.prisma, email);
    const token = await login(email);
    expect((await breakGlass(token, {})).status).toBe(403);
  });
});

describe('cross-hospital information requests', () => {
  function ask(token: string, items: string[] = ['allergies', 'labs']) {
    return request(harness.server)
      .post('/api/v1/information-requests')
      .set(as(token))
      .send({ patientId: patient.id, targetHospitalId: hospitalA, items, reason: 'Continuity of care after transfer' });
  }

  it('shares nothing before approval, then only the approved items until revoked', async () => {
    const created = await ask(doctorB);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = dataOf<{ id: string }>(created).id;
    const shared = (token: string, item: string) =>
      request(harness.server).get(`/api/v1/information-requests/${id}/shared?category=${item}`).set(as(token));

    expect((await shared(doctorB, 'allergies')).status).toBe(403);

    // Only the owning hospital's Hospital Admin: never the requester or a
    // Platform Admin.
    const approve = (token: string, body: Record<string, unknown>) =>
      request(harness.server).post(`/api/v1/information-requests/${id}/approve`).set(as(token)).send(body);
    expect((await approve(platformAdmin, { approvedItems: ['allergies'] })).status).toBe(403);
    expect((await approve(hospitalAdminA, { approvedItems: ['identity'] })).status).toBe(422);
    const approved = await approve(hospitalAdminA, { approvedItems: ['allergies'], shareDays: 3 });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);

    const allergies = await shared(doctorB, 'allergies');
    expect(allergies.status).toBe(200);
    expect(JSON.stringify(allergies.body)).toContain('Penicillin');
    // Requested but not approved.
    expect((await shared(doctorB, 'labs')).status).toBe(403);
    // Not the requester.
    expect((await shared(doctorA, 'allergies')).status).toBe(404);
    await expect(
      harness.prisma.auditEvent.count({ where: { eventType: 'information_request.read', target: `information_request:${id}` } }),
    ).resolves.toBe(1);

    expect(
      (await request(harness.server).post(`/api/v1/information-requests/${id}/revoke`).set(as(doctorB))).status,
    ).toBe(200);
    expect((await shared(doctorB, 'allergies')).status).toBe(403);
  });

  it('never gives an administrator PHI through a request it made', async () => {
    const created = await ask(platformAdmin, ['allergies']);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = dataOf<{ id: string }>(created).id;
    await request(harness.server)
      .post(`/api/v1/information-requests/${id}/approve`)
      .set(as(hospitalAdminA))
      .send({ approvedItems: ['allergies'] });
    const read = await request(harness.server)
      .get(`/api/v1/information-requests/${id}/shared?category=allergies`)
      .set(as(platformAdmin));
    expect(read.status).toBe(403);
  });

  it('refuses a request to the requester’s own hospital', async () => {
    const response = await request(harness.server)
      .post('/api/v1/information-requests')
      .set(as(doctorA))
      .send({ patientId: patient.id, targetHospitalId: hospitalA, items: ['labs'], reason: 'Own hospital request text' });
    expect(response.status).toBe(422);
  });

  it('answers an unknown request as not found', async () => {
    const response = await request(harness.server)
      .post(`/api/v1/information-requests/${randomUUID()}/approve`)
      .set(as(hospitalAdminA))
      .send({ approvedItems: ['labs'] });
    expect(response.status).toBe(404);
  });
});
