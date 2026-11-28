/**
 * Controlled-access lifecycle completeness (audit XH-01, XH-03, XH-05,
 * XH-07, XH-08, XH-09), over HTTP with real tokens.
 *
 * Three hospitals. The patient is recorded at B (by doctor B); requesting
 * doctors are employed at A; C is where a doctor is transferred to. aB is
 * B's Hospital Admin (the approver), aA is A's (another hospital's admin),
 * pA a Platform Admin.
 */

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Prisma } from '../src/generated/prisma/client';
import { type AuditEvent, TransactionalAuditWriter } from '../src/shared/audit';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
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
const STAFFING_REASON = 'Contract ended at the end of the month';

let harness: AuthHarness;
let hospitalA: string;
let hospitalB: string;
let hospitalC: string;
let patient: { id: string; uuid: string };
/** A patient recorded only at A: has no record at B. */
let patientAtAOnly: { id: string; uuid: string };
let adminB: string;
let adminA: string;
let platformAdmin: string;
let platformAdminUserId: string;
const patients: string[] = [];

interface Doctor {
  readonly email: string;
  readonly userId: string;
  readonly doctorId: string;
  token: string;
}

interface GrantBody {
  id: string;
  kind: string;
  status: string;
  hospitalId: string;
  categories: string[];
  startsAt: string | null;
  expiresAt: string | null;
  requiresApproval: boolean;
  reviewOutcome: string | null;
}

interface PageBody<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function currentCode(secret: string): string {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();
}

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function doctorAt(local: string, hospitalId: string): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const { doctorId } = await makeClinicalDoctor(harness.prisma, email, hospitalId);
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  return { email, userId: user.id, doctorId, token: await login(email) };
}

async function admin(local: string, scope: { platform: true } | { hospitalId: string }): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const bootstrap = await login(email);
  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post('/api/v1/me/2fa/setup').set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;
  await request(harness.server).post('/api/v1/me/2fa/enable').set(as(bootstrap)).send({ code: currentCode(secret) });
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

async function registerPatient(token: string, fullName: string): Promise<{ id: string; uuid: string }> {
  const created = await request(harness.server)
    .post('/api/v1/patients')
    .set(as(token))
    .send({
      fullName,
      dateOfBirth: '1980-04-05',
      gender: 'male',
      bloodType: 'O+',
      phone: '+20 100 555 0202',
      allergies: [{ allergen: 'Latex', severity: 'moderate', reaction: 'Rash' }],
      chronicConditions: [],
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const publicId = dataOf<{ id: string }>(created).id;
  const row = await harness.prisma.patient.findUniqueOrThrow({ where: { publicId }, select: { id: true } });
  patients.push(row.id);
  return { id: publicId, uuid: row.id };
}

function requestGrant(token: string, body: Record<string, unknown> = {}) {
  return request(harness.server)
    .post('/api/v1/exceptional-access')
    .set(as(token))
    .send({
      kind: 'EXCEPTIONAL',
      patientId: patient.id,
      hospitalId: hospitalB,
      categories: ['identity', 'allergies'],
      reason: REASON,
      durationMinutes: 60,
      password: PASSWORD,
      ...body,
    });
}

const approveGrant = (token: string, id: string, body: Record<string, unknown> = {}) =>
  request(harness.server).post(`/api/v1/exceptional-access/${id}/approve`).set(as(token)).send(body);

async function approvedGrant(token: string, body: Record<string, unknown> = {}): Promise<GrantBody> {
  const created = await requestGrant(token);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const approved = await approveGrant(adminB, dataOf<GrantBody>(created).id, body);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return dataOf<GrantBody>(approved);
}

function ask(token: string, body: Record<string, unknown> = {}) {
  return request(harness.server)
    .post('/api/v1/information-requests')
    .set(as(token))
    .send({
      patientId: patient.id,
      targetHospitalId: hospitalB,
      items: ['allergies', 'labs'],
      reason: 'Continuity of care after transfer',
      ...body,
    });
}

const approveRequest = (token: string, id: string, body: Record<string, unknown>) =>
  request(harness.server).post(`/api/v1/information-requests/${id}/approve`).set(as(token)).send(body);

async function approvedRequest(token: string): Promise<string> {
  const created = await ask(token);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const id = dataOf<{ id: string }>(created).id;
  const approved = await approveRequest(adminB, id, { approvedItems: ['allergies'], shareDays: 3 });
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return id;
}

const readGrant = (token: string, id: string, category: string) =>
  request(harness.server).get(`/api/v1/exceptional-access/${id}/data?category=${category}`).set(as(token));
const readShared = (token: string, id: string, category: string) =>
  request(harness.server).get(`/api/v1/information-requests/${id}/shared?category=${category}`).set(as(token));

beforeAll(async () => {
  harness = await createAuthHarness('controlled-access-lifecycle');
  hospitalA = await fixtureHospital(harness.prisma, 'cal_a');
  hospitalB = await fixtureHospital(harness.prisma, 'cal_b');
  hospitalC = await fixtureHospital(harness.prisma, 'cal_c');
  const doctorB = await doctorAt('cal-doctor-b', hospitalB);
  const doctorA = await doctorAt('cal-doctor-a', hospitalA);
  adminB = await admin('cal-admin-b', { hospitalId: hospitalB });
  adminA = await admin('cal-admin-a', { hospitalId: hospitalA });
  platformAdmin = await admin('cal-platform', { platform: true });
  platformAdminUserId = (
    await harness.prisma.user.findUniqueOrThrow({ where: { email: testEmail('cal-platform') }, select: { id: true } })
  ).id;
  patient = await registerPatient(doctorB.token, 'Lifecycle Patient');
  patientAtAOnly = await registerPatient(doctorA.token, 'Lifecycle Patient At A');
}, 180_000);

afterAll(async () => {
  if (harness === undefined) return;
  vi.restoreAllMocks();
  const users = await harness.prisma.user.findMany({
    where: { email: { endsWith: `@${harness.domain}` } },
    select: { id: true },
  });
  const ids = users.map((row) => row.id);
  await harness.prisma.exceptionalAccessGrant.deleteMany({
    where: { OR: [{ patientId: { in: patients } }, { requesterUserId: { in: ids } }] },
  });
  await harness.prisma.informationRequest.deleteMany({
    where: { OR: [{ patientId: { in: patients } }, { requesterUserId: { in: ids } }] },
  });
  await harness.reset();
  await purgeHospitalRecords(harness.prisma, patients);
  await harness.prisma.patient.deleteMany({ where: { id: { in: patients } } });
  await harness.close();
});

// ── XH-07: a read outside a live authorization answers 404 ────────────

describe('XH-07: reads outside a live grant or request are 404 (BG4, N-27)', () => {
  it('a Break-Glass past its window, and a grant revoked by the target admin, read as unknown', async () => {
    const doctor = await doctorAt('cal-xh07-bg', hospitalA);
    const created = await requestGrant(doctor.token, { kind: 'EMERGENCY', categories: ['allergies'] });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const emergency = dataOf<GrantBody>(created);
    expect((await readGrant(doctor.token, emergency.id, 'allergies')).status).toBe(200);
    await harness.prisma.exceptionalAccessGrant.update({
      where: { id: emergency.id },
      data: { startsAt: new Date(Date.now() - 120_000), expiresAt: new Date(Date.now() - 1_000) },
    });
    const after = await readGrant(doctor.token, emergency.id, 'allergies');
    expect(after.status).toBe(404);
    // Indistinguishable from an id that never existed.
    const unknown = await readGrant(doctor.token, '00000000-0000-4000-8000-000000000000', 'allergies');
    expect(unknown.status).toBe(404);
    expect([errorBody(after).code, errorBody(after).message]).toEqual([
      errorBody(unknown).code,
      errorBody(unknown).message,
    ]);

    const grant = await approvedGrant(doctor.token);
    expect((await readGrant(doctor.token, grant.id, 'identity')).status).toBe(200);
    const revoked = await request(harness.server).post(`/api/v1/exceptional-access/${grant.id}/revoke`).set(as(adminB));
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect((await readGrant(doctor.token, grant.id, 'identity')).status).toBe(404);
  });

  it('an information request past its share window reads as unknown', async () => {
    const doctor = await doctorAt('cal-xh07-ir', hospitalA);
    const id = await approvedRequest(doctor.token);
    expect((await readShared(doctor.token, id, 'allergies')).status).toBe(200);
    await harness.prisma.informationRequest.update({
      where: { id },
      data: { shareExpiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await readShared(doctor.token, id, 'allergies')).status).toBe(404);
  });
});

// ── XH-08: an unmatched request is audited, then refused honestly ─────
//
// A uniform answer (no existence oracle) needs a request to be storable
// without a record at the target — a Database dependency. Until then the
// request answers 404, never a decoy "pending" that can never be decided,
// and every such attempt is on the ledger.

describe('XH-08: a request for a patient with no record at the target', () => {
  it('EXCEPTIONAL: 404, nothing stored, the attempt audited (unknown id alike)', async () => {
    const doctor = await doctorAt('cal-xh08-ex', hospitalA);
    const real = await requestGrant(doctor.token);
    expect(real.status, JSON.stringify(real.body)).toBe(201);
    const before = await harness.prisma.exceptionalAccessGrant.count({ where: { requesterUserId: doctor.userId } });

    const bodies: string[] = [];
    for (const patientId of [patientAtAOnly.id, 'PT-999999999']) {
      const refused = await requestGrant(doctor.token, { patientId });
      expect(refused.status, JSON.stringify(refused.body)).toBe(404);
      bodies.push(errorBody(refused).message);
    }
    // A patient recorded elsewhere and a nonexistent id read the same.
    expect(bodies[0]).toBe(bodies[1]);
    await expect(
      harness.prisma.exceptionalAccessGrant.count({ where: { requesterUserId: doctor.userId } }),
    ).resolves.toBe(before);
    await expect(
      harness.prisma.auditEvent.count({
        where: { eventType: 'exceptional_access.request_unmatched', actorId: doctor.userId },
      }),
    ).resolves.toBe(2);
  });

  it('information requests: 404, nothing stored, the attempt audited', async () => {
    const doctor = await doctorAt('cal-xh08-ir', hospitalA);
    const real = await ask(doctor.token);
    expect(real.status, JSON.stringify(real.body)).toBe(201);
    const refused = await ask(doctor.token, { patientId: patientAtAOnly.id });
    expect(refused.status).toBe(404);
    await expect(
      harness.prisma.informationRequest.count({ where: { requesterUserId: doctor.userId } }),
    ).resolves.toBe(1);
    await expect(
      harness.prisma.auditEvent.count({
        where: { eventType: 'information_request.create_unmatched', actorId: doctor.userId },
      }),
    ).resolves.toBe(1);
  });

  it('Emergency Override: 404, and the attempt audited', async () => {
    const doctor = await doctorAt('cal-xh08-bg', hospitalA);
    const response = await requestGrant(doctor.token, { kind: 'EMERGENCY', patientId: patientAtAOnly.id });
    expect(response.status).toBe(404);
    await expect(
      harness.prisma.auditEvent.count({
        where: { eventType: 'exceptional_access.request_unmatched', actorId: doctor.userId },
      }),
    ).resolves.toBe(1);
  });
});

// ── XH-01: the approver narrows, never widens ─────────────────────────

describe('XH-01: approval may narrow categories and end time, never widen', () => {
  it('a grant approved for fewer categories and an earlier end reads only those, until then', async () => {
    const doctor = await doctorAt('cal-xh01-grant', hospitalA);
    const created = dataOf<GrantBody>(await requestGrant(doctor.token));

    // Widening is refused.
    expect((await approveGrant(adminB, created.id, { categories: ['identity', 'labs'] })).status).toBe(422);
    const tooLate = new Date(Date.now() + 2 * 3_600_000).toISOString();
    expect((await approveGrant(adminB, created.id, { endsAt: tooLate })).status).toBe(422);
    const past = new Date(Date.now() - 60_000).toISOString();
    expect((await approveGrant(adminB, created.id, { endsAt: past })).status).toBe(422);

    const endsAt = new Date(Date.now() + 10 * 60_000);
    const approved = await approveGrant(adminB, created.id, {
      categories: ['allergies'],
      endsAt: endsAt.toISOString(),
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const grant = dataOf<GrantBody>(approved);
    expect(grant.status).toBe('ACTIVE');
    expect(grant.categories).toEqual(['allergies']);
    expect(new Date(grant.expiresAt ?? 0).getTime()).toBe(endsAt.getTime());

    expect((await readGrant(doctor.token, grant.id, 'allergies')).status).toBe(200);
    // Requested, but dropped by the approver.
    expect((await readGrant(doctor.token, grant.id, 'identity')).status).toBe(404);

    const audit = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'exceptional_access.approve', target: `exceptional_access_grant:${grant.id}` },
    });
    expect(audit.payload).toMatchObject({
      requestedCategories: 'identity allergies',
      approvedCategories: 'allergies',
      approvedEndsAt: endsAt.toISOString(),
    });
  });

  it('an information request approved with an earlier end shares until then, never past shareDays', async () => {
    const doctor = await doctorAt('cal-xh01-ir', hospitalA);
    const id = dataOf<{ id: string }>(await ask(doctor.token)).id;
    const beyond = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await approveRequest(adminB, id, { approvedItems: ['allergies'], shareDays: 1, endsAt: beyond })).status).toBe(
      422,
    );
    const endsAt = new Date(Date.now() + 3_600_000);
    const approved = await approveRequest(adminB, id, {
      approvedItems: ['allergies'],
      shareDays: 1,
      endsAt: endsAt.toISOString(),
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const view = dataOf<{ shareExpiresAt: string }>(approved);
    expect(new Date(view.shareExpiresAt).getTime()).toBe(endsAt.getTime());
    const audit = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'information_request.approve', target: `information_request:${id}` },
    });
    expect(audit.payload).toMatchObject({ requestedItems: 'allergies labs', approvedItems: 'allergies' });
  });
});

// ── XH-05: lists ──────────────────────────────────────────────────────

describe('XH-05: the requester’s own lists and the target Hospital Admin’s queues', () => {
  it('a requester sees its own grants and requests, every status, and nobody else’s', async () => {
    const mine = await doctorAt('cal-xh05-mine', hospitalA);
    const other = await doctorAt('cal-xh05-other', hospitalA);
    const pending = dataOf<GrantBody>(await requestGrant(mine.token));
    const active = await approvedGrant(mine.token);
    const requestId = dataOf<{ id: string }>(await ask(mine.token)).id;

    const list = await request(harness.server).get('/api/v1/exceptional-access/mine').set(as(mine.token));
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const page = dataOf<PageBody<GrantBody & { requester: { id: string; name: string } }>>(list);
    expect(page.items.map((row) => row.id).sort()).toEqual([pending.id, active.id].sort());
    expect(page.totalItems).toBe(2);
    expect(new Set(page.items.map((row) => row.status))).toEqual(new Set(['PENDING', 'ACTIVE']));
    expect(page.items[0]?.requester.id).toBe(mine.userId);
    // Metadata only: no patient, no reason.
    expect(JSON.stringify(page.items)).not.toMatch(/patient|reason|Lifecycle Patient/i);

    const requests = dataOf<PageBody<{ id: string }>>(
      await request(harness.server).get('/api/v1/information-requests/mine').set(as(mine.token)),
    );
    expect(requests.items.map((row) => row.id)).toEqual([requestId]);

    const others = dataOf<PageBody<{ id: string }>>(
      await request(harness.server).get('/api/v1/exceptional-access/mine').set(as(other.token)),
    );
    expect(others.items).toEqual([]);
    const othersRequests = dataOf<PageBody<{ id: string }>>(
      await request(harness.server).get('/api/v1/information-requests/mine').set(as(other.token)),
    );
    expect(othersRequests.items).toEqual([]);

    // Paging.
    const first = dataOf<PageBody<{ id: string }>>(
      await request(harness.server).get('/api/v1/exceptional-access/mine?page=1&pageSize=1').set(as(mine.token)),
    );
    expect(first.items).toHaveLength(1);
    expect(first.totalPages).toBe(2);
  });

  it('the target Hospital Admin sees pending, active and review queues for its own hospital only', async () => {
    const doctor = await doctorAt('cal-xh05-queue', hospitalA);
    const pending = dataOf<GrantBody>(await requestGrant(doctor.token));
    const active = await approvedGrant(doctor.token);
    const emergency = dataOf<GrantBody>(await requestGrant(doctor.token, { kind: 'EMERGENCY' }));
    const pendingRequest = dataOf<{ id: string }>(await ask(doctor.token)).id;

    const queue = async (token: string, path: string) => request(harness.server).get(path).set(as(token));
    const ids = (response: { body: unknown }) => dataOf<PageBody<{ id: string }>>(response).items.map((row) => row.id);

    const pendingQueue = await queue(adminB, '/api/v1/exceptional-access/queue?view=pending&pageSize=100');
    expect(pendingQueue.status, JSON.stringify(pendingQueue.body)).toBe(200);
    expect(ids(pendingQueue)).toContain(pending.id);
    expect(ids(pendingQueue)).not.toContain(active.id);
    expect(JSON.stringify(dataOf<object>(pendingQueue))).not.toMatch(/patient|reason|Lifecycle Patient/i);

    const activeQueue = await queue(adminB, '/api/v1/exceptional-access/queue?view=active&pageSize=100');
    expect(ids(activeQueue)).toEqual(expect.arrayContaining([active.id, emergency.id]));
    expect(ids(activeQueue)).not.toContain(pending.id);

    const reviewQueue = await queue(adminB, '/api/v1/exceptional-access/queue?view=review&pageSize=100');
    expect(ids(reviewQueue)).toContain(emergency.id);
    expect(ids(reviewQueue)).not.toContain(active.id);

    const requestQueue = await queue(adminB, '/api/v1/information-requests/queue?view=pending&pageSize=100');
    expect(requestQueue.status, JSON.stringify(requestQueue.body)).toBe(200);
    expect(ids(requestQueue)).toContain(pendingRequest);

    // Another hospital's admin (N-9): its own hospital's queue, which holds none of these.
    for (const view of ['pending', 'active', 'review']) {
      const foreign = await queue(adminA, `/api/v1/exceptional-access/queue?view=${view}&pageSize=100`);
      expect(foreign.status).toBe(200);
      expect(ids(foreign)).not.toEqual(expect.arrayContaining([pending.id]));
      expect(ids(foreign).some((id) => [pending.id, active.id, emergency.id].includes(id))).toBe(false);
    }
    const foreignRequests = await queue(adminA, '/api/v1/information-requests/queue?pageSize=100');
    expect(ids(foreignRequests)).not.toContain(pendingRequest);

    // A Platform Admin decides nothing here and is refused the queue; a doctor too.
    expect((await queue(platformAdmin, '/api/v1/exceptional-access/queue')).status).toBe(403);
    expect((await queue(platformAdmin, '/api/v1/information-requests/queue')).status).toBe(403);
    expect((await queue(doctor.token, '/api/v1/exceptional-access/queue')).status).toBe(403);
    expect((await queue(doctor.token, '/api/v1/information-requests/queue')).status).toBe(403);

    // The review queue empties once reviewed.
    const reviewed = await request(harness.server)
      .post(`/api/v1/exceptional-access/${emergency.id}/review`)
      .set(as(adminB))
      .send({ outcome: 'JUSTIFIED' });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(ids(await queue(adminB, '/api/v1/exceptional-access/queue?view=review&pageSize=100'))).not.toContain(
      emergency.id,
    );
  });

  it('validates the list parameters', async () => {
    expect((await request(harness.server).get('/api/v1/exceptional-access/queue?view=all').set(as(adminB))).status).toBe(
      422,
    );
    expect(
      (await request(harness.server).get('/api/v1/exceptional-access/mine?pageSize=500').set(as(adminB))).status,
    ).toBe(422);
  });
});

// ── XH-03: a transfer or an ended employment revokes controlled access ─

describe('XH-03: controlled access does not survive a transfer or an ended employment', () => {
  it('a transfer A → C revokes the doctor’s grants and requests at B, in the same transaction, audited', async () => {
    const doctor = await doctorAt('cal-xh03-xfer', hospitalA);
    const bystander = await doctorAt('cal-xh03-bystander', hospitalA);
    const grant = await approvedGrant(doctor.token);
    const requestId = await approvedRequest(doctor.token);
    const pendingRequest = dataOf<{ id: string }>(await ask(doctor.token)).id;
    const untouched = await approvedGrant(bystander.token);
    expect((await readGrant(doctor.token, grant.id, 'identity')).status).toBe(200);
    expect((await readShared(doctor.token, requestId, 'allergies')).status).toBe(200);

    const moved = await request(harness.server)
      .post(`/api/v1/doctors/${doctor.doctorId}/transfer`)
      .set(as(platformAdmin))
      .send({ toHospitalId: hospitalC, reason: STAFFING_REASON });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    // Fresh sign-in at C: clinical standing, but nothing at B any more.
    doctor.token = await login(doctor.email);
    expect((await readGrant(doctor.token, grant.id, 'identity')).status).toBe(404);
    expect((await readShared(doctor.token, requestId, 'allergies')).status).toBe(404);

    const grantRow = await harness.prisma.exceptionalAccessGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(grantRow.status).toBe('REVOKED');
    expect(grantRow.revokedAt).not.toBeNull();
    expect(grantRow.revokedBy).toBe(platformAdminUserId);
    const requestRows = await harness.prisma.informationRequest.findMany({
      where: { id: { in: [requestId, pendingRequest] } },
    });
    expect(requestRows.map((row) => row.status)).toEqual(['REVOKED', 'REVOKED']);

    const audits = await harness.prisma.auditEvent.findMany({
      where: {
        target: { in: [`exceptional_access_grant:${grant.id}`, `information_request:${requestId}`] },
        eventType: { in: ['exceptional_access.revoke', 'information_request.revoke'] },
      },
    });
    expect(audits).toHaveLength(2);
    for (const row of audits) {
      expect(row.hospitalId).toBe(hospitalB);
      expect(row.actorId).toBe(platformAdminUserId);
      expect(row.payload).toMatchObject({ reason: 'employment_transferred', affectedUserId: doctor.userId });
    }

    // Another doctor's grant is untouched.
    const other = await harness.prisma.exceptionalAccessGrant.findUniqueOrThrow({ where: { id: untouched.id } });
    expect(other.status).toBe('ACTIVE');
    expect((await readGrant(bystander.token, untouched.id, 'identity')).status).toBe(200);
  });

  it('ending the employment (by A’s own Hospital Admin) revokes them too; re-employed at C, the reads are 404', async () => {
    const doctor = await doctorAt('cal-xh03-end', hospitalA);
    const grant = await approvedGrant(doctor.token);
    const requestId = await approvedRequest(doctor.token);
    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctor.doctorId, endedAt: null },
    });

    const ended = await request(harness.server)
      .post(`/api/v1/hospitals/${hospitalA}/doctor-employments/${employment.id}/end`)
      .set(as(adminA))
      .send({ reason: STAFFING_REASON });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);

    await expect(
      harness.prisma.exceptionalAccessGrant.findUniqueOrThrow({ where: { id: grant.id } }),
    ).resolves.toMatchObject({ status: 'REVOKED' });
    await expect(
      harness.prisma.informationRequest.findUniqueOrThrow({ where: { id: requestId } }),
    ).resolves.toMatchObject({ status: 'REVOKED' });
    const audit = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'exceptional_access.revoke', target: `exceptional_access_grant:${grant.id}` },
    });
    expect(audit.payload).toMatchObject({ reason: 'employment_ended' });
    expect(audit.hospitalId).toBe(hospitalB);

    // Hired again elsewhere: standing returns, the old access does not.
    await makeClinicalDoctor(harness.prisma, doctor.email, hospitalC);
    doctor.token = await login(doctor.email);
    expect((await readGrant(doctor.token, grant.id, 'identity')).status).toBe(404);
    expect((await readShared(doctor.token, requestId, 'allergies')).status).toBe(404);
  });
});

// ── XH-09: lifecycle audits are fail-closed and transactional ─────────

describe('XH-09: a lifecycle change without its audit row is rolled back', () => {
  function breakAudit(action: string): () => void {
    const writer = harness.app.get(TransactionalAuditWriter, { strict: false });
    const original = writer.recordWithin.bind(writer);
    // The real writer on the real transaction, handed an event Postgres
    // rejects (`session_id` is a uuid column) for the one action under test.
    const spy = vi
      .spyOn(writer, 'recordWithin')
      .mockImplementation((tx: Prisma.TransactionClient, event: AuditEvent) =>
        original(tx, event.action === action ? { ...event, actor: { ...event.actor, sessionId: 'not-a-uuid' } } : event),
      );
    return () => spy.mockRestore();
  }

  it('no Emergency Override is active without its ledger row', async () => {
    const doctor = await doctorAt('cal-xh09-bg', hospitalA);
    const restore = breakAudit('exceptional_access.emergency_override');
    try {
      const response = await requestGrant(doctor.token, { kind: 'EMERGENCY' });
      expect(response.status, JSON.stringify(response.body)).toBe(503);
      expect(errorBody(response).code).toBe('audit_unavailable');
    } finally {
      restore();
    }
    await expect(
      harness.prisma.exceptionalAccessGrant.count({ where: { requesterUserId: doctor.userId } }),
    ).resolves.toBe(0);
  });

  it('an approval whose audit row fails leaves the grant pending', async () => {
    const doctor = await doctorAt('cal-xh09-approve', hospitalA);
    const created = dataOf<GrantBody>(await requestGrant(doctor.token));
    const restore = breakAudit('exceptional_access.approve');
    try {
      expect((await approveGrant(adminB, created.id)).status).toBe(503);
    } finally {
      restore();
    }
    await expect(
      harness.prisma.exceptionalAccessGrant.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ status: 'PENDING', approverUserId: null });
    expect((await readGrant(doctor.token, created.id, 'identity')).status).toBe(404);
  });

  it('a transfer whose revocation audit fails is rolled back whole', async () => {
    const doctor = await doctorAt('cal-xh09-xfer', hospitalA);
    const grant = await approvedGrant(doctor.token);
    const restore = breakAudit('exceptional_access.revoke');
    try {
      const moved = await request(harness.server)
        .post(`/api/v1/doctors/${doctor.doctorId}/transfer`)
        .set(as(platformAdmin))
        .send({ toHospitalId: hospitalC, reason: STAFFING_REASON });
      expect(moved.status, JSON.stringify(moved.body)).toBe(503);
    } finally {
      restore();
    }
    await expect(
      harness.prisma.exceptionalAccessGrant.findUniqueOrThrow({ where: { id: grant.id } }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    await expect(
      harness.prisma.doctorEmployment.count({ where: { doctorId: doctor.doctorId, hospitalId: hospitalA, endedAt: null } }),
    ).resolves.toBe(1);
  });
});
