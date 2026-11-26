/**
 * XH-10 / checklist BG3: the target Hospital Admin is notified at the start
 * of a Break-Glass (Emergency Override), over HTTP with real tokens.
 *
 * The notification is a `user_activity_log` row (kind SECURITY) written
 * synchronously by `ControlledAccessService.requestExceptional` for every
 * active Hospital Admin assignment of the target hospital — not an outbox
 * event, so there is no job to drive. The patient is recorded at B; the
 * requesting doctor is employed at A.
 */

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
const REASON = 'Patient arrived unconscious, allergic history unknown SECRETREASONTEXT';
const SUMMARY = 'An Emergency Override was used at your hospital and needs review';

let harness: AuthHarness;
let hospitalA: string;
let hospitalB: string;
let patient: { id: string; uuid: string };
const patients: string[] = [];

interface Staff {
  readonly userId: string;
  readonly token: string;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function userId(email: string): Promise<string> {
  return (await harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } }))
    .id;
}

async function doctorAt(local: string, hospitalId: string): Promise<Staff> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  await makeClinicalDoctor(harness.prisma, email, hospitalId);
  return { userId: await userId(email), token: await login(email) };
}

async function admin(
  local: string,
  scope: { platform: true } | { hospitalId: string; revoked?: boolean },
): Promise<Staff> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const bootstrap = await login(email);
  const secret = dataOf<{ secret: string }>(
    await request(harness.server)
      .post('/api/v1/me/2fa/setup')
      .set(as(bootstrap))
      .send({ password: PASSWORD }),
  ).secret;
  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });
  const role = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const user = await harness.prisma.user.update({
    where: { email },
    data: { roleId: role.id },
    select: { id: true },
  });
  if ('platform' in scope) await grantPlatformAdmin(harness.prisma, email);
  else {
    await harness.prisma.hospitalRoleAssignment.create({
      data: {
        userId: user.id,
        hospitalId: scope.hospitalId,
        roleId: role.id,
        ...(scope.revoked === true ? { revokedAt: new Date() } : {}),
      },
    });
  }
  const otp = dataOf<{ otpToken: string }>(
    await request(harness.server).post('/api/v1/auth/login').send({ email, password: PASSWORD }),
  ).otpToken;
  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken: otp, code: currentCode(secret) }),
  ).accessToken;
  return { userId: user.id, token };
}

function requestGrant(token: string, body: Record<string, unknown> = {}) {
  return request(harness.server)
    .post('/api/v1/exceptional-access')
    .set(as(token))
    .send({
      kind: 'EMERGENCY',
      patientId: patient.id,
      hospitalId: hospitalB,
      categories: ['allergies'],
      reason: REASON,
      durationMinutes: 60,
      password: PASSWORD,
      ...body,
    });
}

const securityRows = (ids: string[]) =>
  harness.prisma.userActivityLog.findMany({
    where: { userId: { in: ids }, kind: 'SECURITY', summary: SUMMARY },
  });

let doctorA: Staff;
let adminB1: Staff;
let adminB2: Staff;
let formerAdminB: Staff;
let adminA: Staff;
let platform: Staff;

beforeAll(async () => {
  harness = await createAuthHarness('controlled-access-notification');
  hospitalA = await fixtureHospital(harness.prisma, 'can_a');
  hospitalB = await fixtureHospital(harness.prisma, 'can_b');
  const doctorB = await doctorAt('can-doctor-b', hospitalB);
  doctorA = await doctorAt('can-doctor-a', hospitalA);
  adminB1 = await admin('can-admin-b1', { hospitalId: hospitalB });
  adminB2 = await admin('can-admin-b2', { hospitalId: hospitalB });
  formerAdminB = await admin('can-admin-b-former', { hospitalId: hospitalB, revoked: true });
  adminA = await admin('can-admin-a', { hospitalId: hospitalA });
  platform = await admin('can-platform', { platform: true });

  const created = await request(harness.server)
    .post('/api/v1/patients')
    .set(as(doctorB.token))
    .send({
      fullName: 'Notification Patient',
      dateOfBirth: '1980-04-05',
      gender: 'male',
      bloodType: 'O+',
      phone: '+20 100 555 0303',
      allergies: [{ allergen: 'Latex', severity: 'moderate', reaction: 'Rash' }],
      chronicConditions: [],
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const publicId = dataOf<{ id: string }>(created).id;
  const row = await harness.prisma.patient.findUniqueOrThrow({
    where: { publicId },
    select: { id: true },
  });
  patients.push(row.id);
  patient = { id: publicId, uuid: row.id };
}, 180_000);

afterAll(async () => {
  if (harness === undefined) return;
  const users = await harness.prisma.user.findMany({
    where: { email: { endsWith: `@${harness.domain}` } },
    select: { id: true },
  });
  const ids = users.map((row) => row.id);
  await harness.prisma.exceptionalAccessGrant.deleteMany({
    where: { OR: [{ patientId: { in: patients } }, { requesterUserId: { in: ids } }] },
  });
  await harness.prisma.userActivityLog.deleteMany({ where: { userId: { in: ids } } });
  await harness.reset();
  await purgeHospitalRecords(harness.prisma, patients);
  await harness.prisma.patient.deleteMany({ where: { id: { in: patients } } });
  await harness.close();
});

describe('XH-10 / BG3: Emergency Override notifies the target hospital’s administrators', () => {
  it('every active Hospital Admin of B gets one security entry carrying only the grant id', async () => {
    const response = await requestGrant(doctorA.token);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const grant = dataOf<{ id: string; kind: string; status: string }>(response);
    expect([grant.kind, grant.status]).toEqual(['EMERGENCY', 'ACTIVE']);

    for (const staff of [adminB1, adminB2]) {
      const rows = await securityRows([staff.userId]);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ summary: SUMMARY, detail: grant.id });
      // Ids only: no reason text, no patient, no clinical content.
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toContain('SECRETREASONTEXT');
      expect(serialised).not.toMatch(/Notification Patient|Latex|allerg|Rash/i);
      expect(serialised).not.toContain(patient.id);
      expect(serialised).not.toContain(patient.uuid);
    }

    // The same entry is what the admin reads on their own activity feed.
    const feed = await request(harness.server).get('/api/v1/me/activity').set(as(adminB1.token));
    expect(feed.status, JSON.stringify(feed.body)).toBe(200);
    const items = dataOf<{ items: { kind: string; summary: string; detail?: string | null }[] }>(
      feed,
    ).items;
    expect(items.filter((item) => item.summary === SUMMARY)).toHaveLength(1);
    expect(items.find((item) => item.summary === SUMMARY)).toMatchObject({
      kind: 'security',
      detail: grant.id,
    });
  });

  it('nobody else is notified: A’s admin, a Platform Admin, a revoked B admin, the requester', async () => {
    for (const staff of [adminA, platform, formerAdminB, doctorA]) {
      await expect(securityRows([staff.userId])).resolves.toEqual([]);
    }
    // And no other table row carries a notification for them.
    await expect(
      harness.prisma.userActivityLog.count({
        where: {
          userId: { in: [adminA.userId, platform.userId, formerAdminB.userId, doctorA.userId] },
          summary: SUMMARY,
        },
      }),
    ).resolves.toBe(0);
  });

  it('a refused Emergency Override (no record at B) notifies nobody', async () => {
    const before = await harness.prisma.userActivityLog.count({
      where: { userId: { in: [adminB1.userId, adminB2.userId] }, summary: SUMMARY },
    });
    const refused = await requestGrant(doctorA.token, { patientId: 'PT-999999999' });
    expect(refused.status).toBe(404);
    await expect(
      harness.prisma.userActivityLog.count({
        where: { userId: { in: [adminB1.userId, adminB2.userId] }, summary: SUMMARY },
      }),
    ).resolves.toBe(before);
  });

  it('an EXCEPTIONAL request (pending approval) emits no start notification; the admin sees it in the queue', async () => {
    const before = await harness.prisma.userActivityLog.count({
      where: { userId: { in: [adminB1.userId, adminB2.userId] }, summary: SUMMARY },
    });
    const response = await requestGrant(doctorA.token, { kind: 'EXCEPTIONAL' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const grant = dataOf<{ id: string; status: string }>(response);
    expect(grant.status).toBe('PENDING');
    // Contract (§2.11 / SECURITY §4): only Break-Glass notifies at start.
    await expect(
      harness.prisma.userActivityLog.count({
        where: { userId: { in: [adminB1.userId, adminB2.userId] }, summary: SUMMARY },
      }),
    ).resolves.toBe(before);

    const queue = await request(harness.server)
      .get('/api/v1/exceptional-access/queue?view=pending&pageSize=100')
      .set(as(adminB1.token));
    expect(queue.status, JSON.stringify(queue.body)).toBe(200);
    expect(dataOf<{ items: { id: string }[] }>(queue).items.map((row) => row.id)).toContain(
      grant.id,
    );
  });
});
