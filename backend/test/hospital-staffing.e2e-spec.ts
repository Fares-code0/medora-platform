/**
 * Hospital staffing lifecycle and administrative tiering, over HTTP with
 * real tokens (multi-hospital §2.2–§2.6, OD-07; audit A-10, A-11).
 *
 * The clinical probe is `GET /ai/conversations` (`ai.use`, in the doctor
 * bundle): it answers 200 exactly when the doctor holds clinical standing.
 */

import { randomUUID } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  grantPlatformAdmin,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const SESSION = '/api/v1/auth/session';
const PROFILE = '/api/v1/me/profile';
const CLINICAL = '/api/v1/ai/conversations';
const PASSWORD = 'Medora123!';
const REASON = 'Staffing change recorded by the e2e suite';

let harness: AuthHarness;
const hospitals: string[] = [];

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function currentCode(secret: string): string {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();
}

async function signIn(email: string): Promise<{ status: number; token: string; code: string }> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  return {
    status: response.status,
    token: response.status === 200 ? dataOf<{ accessToken: string }>(response).accessToken : '',
    code: response.status === 200 ? '' : errorBody(response).code,
  };
}

/** A registered, email-verified doctor; verification status as given. */
async function seedDoctor(
  local: string,
  verification: 'VERIFIED' | 'PENDING' = 'VERIFIED',
): Promise<{ email: string; doctorId: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true, userId: true },
  });
  await harness.prisma.doctor.update({
    where: { id: doctor.id },
    data: { verificationStatus: verification },
  });
  return { email, doctorId: doctor.id, userId: doctor.userId };
}

/** An administrator with a second factor; scope as given. */
async function seedAdmin(
  local: string,
  scope: { platform: true } | { hospitalId: string } | 'none',
): Promise<{ email: string; token: string; publicId: string }> {
  const { email } = await seedDoctor(local);
  const bootstrap = (await signIn(email)).token;
  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set(as(bootstrap))
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;
  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const user = await harness.prisma.user.update({
    where: { email },
    data: { roleId: adminRole.id },
    select: { id: true, publicId: true },
  });
  if (scope !== 'none' && 'platform' in scope) await grantPlatformAdmin(harness.prisma, email);
  if (scope !== 'none' && 'hospitalId' in scope) {
    await harness.prisma.hospitalRoleAssignment.create({
      data: { userId: user.id, hospitalId: scope.hospitalId, roleId: adminRole.id },
    });
  }

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });
  return { email, token: dataOf<{ accessToken: string }>(verified).accessToken, publicId: user.publicId };
}

async function hospital(name: string): Promise<string> {
  const row = await harness.prisma.hospital.create({
    data: { publicId: 'hsp_' + randomUUID(), name: `${name} ${randomUUID().slice(0, 8)}` },
    select: { id: true },
  });
  hospitals.push(row.id);
  return row.id;
}

function hire(token: string, hospitalId: string, doctorId: string) {
  return request(harness.server)
    .post(`/api/v1/hospitals/${hospitalId}/doctor-employments`)
    .set(as(token))
    .send({ doctorId, reason: REASON });
}

async function cleanup(): Promise<void> {
  const users = await harness.prisma.user.findMany({
    where: { email: { endsWith: testEmail('x').slice(1) } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  await harness.prisma.hospitalRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await harness.prisma.doctorEmployment.deleteMany({ where: { doctor: { userId: { in: ids } } } });
}

beforeAll(async () => {
  harness = await createAuthHarness('hospital-staffing');
}, 90_000);

beforeEach(async () => {
  await cleanup();
  await harness.reset();
});

afterAll(async () => {
  await cleanup();
  await harness.reset();
  await harness.prisma.hospital.deleteMany({ where: { id: { in: hospitals } } });
  await harness.close();
});

describe('doctor standing (§2.6): login vs clinical access', () => {
  it('lets a never-employed verified doctor sign in with no clinical access (unverified policy)', async () => {
    const doctor = await seedDoctor('neveremployed');
    const signedIn = await signIn(doctor.email);
    expect(signedIn.status).toBe(200);
    expect((await request(harness.server).get(SESSION).set(as(signedIn.token))).status).toBe(200);
    expect((await request(harness.server).get(PROFILE).set(as(signedIn.token))).status).toBe(200);
    expect((await request(harness.server).get(CLINICAL).set(as(signedIn.token))).status).toBe(403);
  });

  it('grants clinical access on the next request after employment starts, same token', async () => {
    const admin = await seedAdmin('platformhire', { platform: true });
    const h = await hospital('Hire');
    const doctor = await seedDoctor('hired');
    const token = (await signIn(doctor.email)).token;
    expect((await request(harness.server).get(CLINICAL).set(as(token))).status).toBe(403);

    const hired = await hire(admin.token, h, doctor.doctorId);
    expect(hired.status, JSON.stringify(hired.body)).toBe(201);

    expect((await request(harness.server).get(CLINICAL).set(as(token))).status).toBe(200);
  });

  it('denies clinical access to an employed but unverified doctor; own profile still works', async () => {
    const admin = await seedAdmin('platformunverified', { platform: true });
    const h = await hospital('Unverified');
    const doctor = await seedDoctor('unverified', 'PENDING');
    expect((await hire(admin.token, h, doctor.doctorId)).status).toBe(201);

    const token = (await signIn(doctor.email)).token;
    expect((await request(harness.server).get(CLINICAL).set(as(token))).status).toBe(403);
    expect((await request(harness.server).get(PROFILE).set(as(token))).status).toBe(200);
  });

  it.each([
    ['SUSPENDED', 403],
    ['VACATION', 200],
  ] as const)('a %s doctor gets clinical status %i; own profile works', async (practice, status) => {
    const admin = await seedAdmin(`platform${practice.toLowerCase()}`, { platform: true });
    const h = await hospital(practice);
    const doctor = await seedDoctor(`practice${practice.toLowerCase()}`);
    expect((await hire(admin.token, h, doctor.doctorId)).status).toBe(201);
    await harness.prisma.doctor.update({
      where: { id: doctor.doctorId },
      data: { practiceStatus: practice },
    });

    const token = (await signIn(doctor.email)).token;
    expect((await request(harness.server).get(CLINICAL).set(as(token))).status).toBe(status);
    expect((await request(harness.server).get(PROFILE).set(as(token))).status).toBe(200);
  });

  it('terminates: revokes every session, refuses login, keeps the employment history', async () => {
    const admin = await seedAdmin('platformterm', { platform: true });
    const h = await hospital('Terminate');
    const doctor = await seedDoctor('terminated');
    const hired = await hire(admin.token, h, doctor.doctorId);
    const employmentId = dataOf<{ id: string }>(hired).id;
    const token = (await signIn(doctor.email)).token;
    expect((await request(harness.server).get(CLINICAL).set(as(token))).status).toBe(200);

    const ended = await request(harness.server)
      .post(`/api/v1/hospitals/${h}/doctor-employments/${employmentId}/end`)
      .set(as(admin.token))
      .send({ reason: REASON });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect(dataOf<{ sessionsRevoked: number }>(ended).sessionsRevoked).toBeGreaterThan(0);

    expect((await request(harness.server).get(SESSION).set(as(token))).status).toBe(401);
    const again = await signIn(doctor.email);
    expect(again.status).toBe(403);
    expect(again.code).toBe('account_inactive');
    await expect(
      harness.prisma.session.count({ where: { userId: doctor.userId, revokedAt: null } }),
    ).resolves.toBe(0);

    const history = await harness.prisma.doctorEmployment.findUniqueOrThrow({
      where: { id: employmentId },
    });
    expect(history.endedAt).not.toBeNull();
    expect(history.hospitalId).toBe(h);
  });

  it('transfers between hospitals atomically, revoking sessions (Platform Admin only)', async () => {
    const admin = await seedAdmin('platformxfer', { platform: true });
    const a = await hospital('From');
    const b = await hospital('To');
    const doctor = await seedDoctor('transferred');
    expect((await hire(admin.token, a, doctor.doctorId)).status).toBe(201);
    const token = (await signIn(doctor.email)).token;

    const moved = await request(harness.server)
      .post(`/api/v1/doctors/${doctor.doctorId}/transfer`)
      .set(as(admin.token))
      .send({ toHospitalId: b, reason: REASON });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    expect((await request(harness.server).get(SESSION).set(as(token))).status).toBe(401);
    const employments = await harness.prisma.doctorEmployment.findMany({
      where: { doctorId: doctor.doctorId },
      orderBy: { startedAt: 'asc' },
    });
    expect(employments.map((row) => [row.hospitalId, row.endedAt === null])).toEqual([
      [a, false],
      [b, true],
    ]);

    const fresh = await signIn(doctor.email);
    expect(fresh.status).toBe(200);
    const session = dataOf<{ activeHospital: { id: string } | null }>(
      await request(harness.server).get(SESSION).set(as(fresh.token)),
    );
    expect(session.activeHospital?.id).toBe(b);
  });

  it('refuses a second concurrent employment (one hospital at a time)', async () => {
    const admin = await seedAdmin('platformtwice', { platform: true });
    const a = await hospital('First');
    const b = await hospital('Second');
    const doctor = await seedDoctor('twice');
    expect((await hire(admin.token, a, doctor.doctorId)).status).toBe(201);
    expect((await hire(admin.token, b, doctor.doctorId)).status).toBe(409);
  });
});

describe('administrative tiering (§2.2, §2.3, OD-07)', () => {
  it('confines a Hospital Admin to its own hospital', async () => {
    const a = await hospital('Own');
    const b = await hospital('Other');
    const hospitalAdmin = await seedAdmin('hadmin', { hospitalId: a });
    const doctor = await seedDoctor('hadmindoc');
    const other = await seedDoctor('hadminotherdoc');

    expect((await hire(hospitalAdmin.token, b, other.doctorId)).status).toBe(403);
    expect((await hire(hospitalAdmin.token, a, doctor.doctorId)).status).toBe(201);
  });

  it('refuses a Hospital Admin every platform-tier route', async () => {
    const a = await hospital('Tier');
    const b = await hospital('TierTarget');
    const hospitalAdmin = await seedAdmin('hadmintier', { hospitalId: a });
    const doctor = await seedDoctor('tierdoc');
    expect((await hire(hospitalAdmin.token, a, doctor.doctorId)).status).toBe(201);
    const candidate = await seedAdmin('tiercandidate', 'none');

    const transfer = await request(harness.server)
      .post(`/api/v1/doctors/${doctor.doctorId}/transfer`)
      .set(as(hospitalAdmin.token))
      .send({ toHospitalId: b, reason: REASON });
    const assign = await request(harness.server)
      .post(`/api/v1/hospitals/${a}/admins`)
      .set(as(hospitalAdmin.token))
      .send({ userId: candidate.publicId, reason: REASON });
    const platform = await request(harness.server)
      .post('/api/v1/platform/admins')
      .set(as(hospitalAdmin.token))
      .send({ userId: candidate.publicId, reason: REASON });
    const matrix = await request(harness.server)
      .get('/api/v1/roles/matrix')
      .set(as(hospitalAdmin.token));

    expect([transfer.status, assign.status, platform.status]).toEqual([403, 403, 403]);
    // Existing administrative surfaces act across hospitals, so they are
    // platform-tier by default until each is scoped to one hospital.
    for (const path of ['/api/v1/admin/users', '/api/v1/doctors', '/api/v1/platform-settings']) {
      const response = await request(harness.server).get(path).set(as(hospitalAdmin.token));
      expect(response.status, path).toBe(403);
    }
    // While the hospital-tier role catalogue stays open to it.
    expect(
      (await request(harness.server).get('/api/v1/roles').set(as(hospitalAdmin.token))).status,
    ).toBe(200);
    // `roles.manage` alone does not open the platform's permission matrix.
    expect(matrix.status).toBe(403);
  });

  it('gives an unmapped administrator no administrative reach at all', async () => {
    const unmapped = await seedAdmin('unmapped', 'none');
    const h = await hospital('Unmapped');
    const doctor = await seedDoctor('unmappeddoc');

    expect((await hire(unmapped.token, h, doctor.doctorId)).status).toBe(403);
    expect(
      (await request(harness.server).get('/api/v1/admin/users').set(as(unmapped.token))).status,
    ).toBe(403);
    // Self-service still works: the account is not frozen or disabled.
    expect((await request(harness.server).get(SESSION).set(as(unmapped.token))).status).toBe(200);
  });

  it('assigns a Hospital Admin, revoking the subject’s sessions; the scopes stay exclusive', async () => {
    const platform = await seedAdmin('assigner', { platform: true });
    const a = await hospital('Assign');
    const candidate = await seedAdmin('assignee', 'none');

    const assigned = await request(harness.server)
      .post(`/api/v1/hospitals/${a}/admins`)
      .set(as(platform.token))
      .send({ userId: candidate.publicId, reason: REASON });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    expect((await request(harness.server).get(SESSION).set(as(candidate.token))).status).toBe(401);

    // Already a Hospital Admin: platform scope is refused (exclusive).
    const both = await request(harness.server)
      .post('/api/v1/platform/admins')
      .set(as(platform.token))
      .send({ userId: candidate.publicId, reason: REASON });
    expect(both.status).toBe(409);

    // And the database refuses it even when the service is bypassed.
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { publicId: candidate.publicId },
      select: { id: true },
    });
    await expect(
      harness.prisma.platformAdminGrant.create({ data: { userId: user.id, reason: REASON } }),
    ).rejects.toThrow();
  });

  it('never lets an administrator grant or revoke their own scope, or drop the last Platform Admin', async () => {
    const platform = await seedAdmin('selfgrant', { platform: true });

    const self = await request(harness.server)
      .post(`/api/v1/platform/admins/${platform.publicId}/revoke`)
      .set(as(platform.token))
      .send({ reason: REASON });
    expect(self.status).toBe(403);

    const selfGrant = await request(harness.server)
      .post('/api/v1/platform/admins')
      .set(as(platform.token))
      .send({ userId: platform.publicId, reason: REASON });
    expect(selfGrant.status).toBe(403);
  });

  it('scopes the audit ledger to a Hospital Admin’s hospital, and audits every ledger read', async () => {
    const platform = await seedAdmin('ledgerplatform', { platform: true });
    const a = await hospital('LedgerA');
    const b = await hospital('LedgerB');
    const hospitalAdmin = await seedAdmin('ledgerhadmin', { hospitalId: a });
    const own = dataOf<{ id: string }>(await hire(hospitalAdmin.token, a, (await seedDoctor('ledgerdoca')).doctorId)).id;
    const other = dataOf<{ id: string }>(await hire(platform.token, b, (await seedDoctor('ledgerdocb')).doctorId)).id;

    const listed = await request(harness.server)
      .get('/api/v1/audit-events?pageSize=100&q=employment')
      .set(as(hospitalAdmin.token));
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    const targets = dataOf<{ items: { target: string | null }[] }>(listed).items.map((item) => item.target);
    expect(targets).toContain(`doctor_employment:${own}`);
    expect(targets).not.toContain(`doctor_employment:${other}`);

    // Another hospital's event is not found; the platform sees both.
    const otherEvent = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { target: `doctor_employment:${other}` },
      select: { id: true },
    });
    expect(
      (await request(harness.server).get(`/api/v1/audit-events/${otherEvent.id}`).set(as(hospitalAdmin.token)))
        .status,
    ).toBe(404);
    expect(
      (await request(harness.server).get(`/api/v1/audit-events/${otherEvent.id}`).set(as(platform.token))).status,
    ).toBe(200);
    // Export stays platform-tier.
    expect(
      (await request(harness.server).post('/api/v1/audit-events/export').set(as(hospitalAdmin.token))).status,
    ).toBe(403);

    // The Hospital Admin's list read is recorded at its hospital (the refused
    // detail read disclosed nothing and is not a read); the platform's
    // detail read is recorded against the event it opened.
    const platformUser = await harness.prisma.user.findUniqueOrThrow({
      where: { publicId: platform.publicId },
      select: { id: true },
    });
    await expect(
      harness.prisma.auditEvent.count({ where: { eventType: 'audit_ledger.read', hospitalId: a } }),
    ).resolves.toBe(1);
    await expect(
      harness.prisma.auditEvent.count({
        where: { eventType: 'audit_ledger.read', actorId: platformUser.id, target: `audit_ledger:${otherEvent.id}` },
      }),
    ).resolves.toBe(1);
  });

  it('audits each change with actor, affected user, hospital and previous/new values', async () => {
    const admin = await seedAdmin('auditor', { platform: true });
    const h = await hospital('Audit');
    const doctor = await seedDoctor('auditeddoc');
    const hired = await hire(admin.token, h, doctor.doctorId);
    const id = dataOf<{ id: string }>(hired).id;

    const row = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'hospital.doctor_employment_started', target: `doctor_employment:${id}` },
    });
    const metadata = row.payload as Record<string, unknown>;
    // Hospital attribution and the actor are columns, not payload.
    expect(row.hospitalId).toBe(h);
    expect(row.actorRole).toBe('admin');
    expect(metadata['affectedUserId']).toBe(doctor.userId);
    expect(metadata['previous']).toBe('none');
    expect(metadata['next']).toBe(h);
    expect(metadata['reason']).toBe(REASON);
    expect(row.occurredAt).toBeInstanceOf(Date);
  });
});
