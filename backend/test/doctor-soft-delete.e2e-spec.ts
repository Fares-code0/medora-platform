import { createHash } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * A soft-deleted doctor is not resolved by the ordinary doctor routes.
 *
 * The soft-delete extension cannot filter `findUnique`, and the admin
 * doctor repository looked doctors up with exactly that — so a deleted
 * practitioner could still be read, suspended, reactivated, verified or
 * rejected by id, and still manage their own grid. Each of those is now
 * 404 (ADR-022) and leaves the row untouched; the same routes on a live
 * doctor are the control.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const DOCTORS = '/api/v1/doctors';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function seedDoctor(local: string): Promise<{ email: string; doctorId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true },
  });

  return { email, doctorId: doctor.id };
}

async function tokenFor(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}

/** An administrator token, built the only way ADR-035 §7 allows one. */
async function adminToken(local: string): Promise<string> {
  const { email } = await seedDoctor(local);
  const bootstrap = await tokenFor(email);

  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  return dataOf<SessionPayload>(verified).accessToken;
}

/** A pending verification document, so the document routes have a target. */
async function uploadDocument(doctorId: string, kind: string): Promise<string> {
  const file = await harness.prisma.file.create({
    data: {
      storageKey: `test/${doctorId}/${kind}`,
      originalName: `${kind}.pdf`,
      mimeType: 'application/pdf',
      sizeBytes: BigInt(1024),
      checksumSha256: createHash('sha256').update(`${doctorId}:${kind}`).digest('hex'),
      kind: 'verification_document',
    },
  });

  const document = await harness.prisma.doctorVerificationDocument.create({
    data: { doctorId, kind, fileId: file.id },
    select: { id: true },
  });

  return document.id;
}

/** Everything a decision route could change, read through the plain client. */
async function snapshot(doctorId: string) {
  return harness.prisma.doctor.findUniqueOrThrow({
    where: { id: doctorId },
    select: {
      practiceStatus: true,
      verificationStatus: true,
      verifiedAt: true,
      verifiedBy: true,
      updatedAt: true,
      updatedBy: true,
      deletedAt: true,
      defaultDurationMin: true,
      bufferMin: true,
      verificationDocuments: {
        select: { id: true, decision: true, decidedAt: true, rejectReason: true },
      },
    },
  });
}

/** Doctor decisions in the ledger — a 404 must not have recorded one. */
async function doctorAuditCount(): Promise<number> {
  return harness.prisma.auditEvent.count({ where: { eventType: { startsWith: 'doctor.' } } });
}

const APPROVAL = { authentic: true, current: true, identityMatch: true };

beforeAll(async () => {
  harness = await createAuthHarness('doctor-soft-delete');
}, 60_000);

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('a soft-deleted doctor on the administrator routes', () => {
  it('is 404 on read and on every decision, and the row does not change', async () => {
    const token = await adminToken('sd-admin');
    const { doctorId } = await seedDoctor('sd-deleted');
    const documentId = await uploadDocument(doctorId, 'medical_license');

    await harness.prisma.doctor.update({
      where: { id: doctorId },
      data: { deletedAt: new Date() },
    });

    const before = await snapshot(doctorId);
    const auditBefore = await doctorAuditCount();

    const detail = await request(harness.server)
      .get(`${DOCTORS}/${doctorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(404);

    const decisions: readonly [string, Record<string, unknown>][] = [
      ['suspend', { reason: 'Licence under review' }],
      ['reactivate', {}],
      ['verify', {}],
      ['reject', { reason: 'Licence does not match' }],
      ['request-documents', { kinds: ['national_id'], reason: 'Scan unreadable' }],
      [`documents/${documentId}/approve`, APPROVAL],
      [`documents/${documentId}/reject`, { reason: 'Expired' }],
    ];

    for (const [path, body] of decisions) {
      const response = await request(harness.server)
        .post(`${DOCTORS}/${doctorId}/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect({ path, status: response.status }).toEqual({ path, status: 404 });
    }

    expect(await snapshot(doctorId)).toEqual(before);
    expect(await doctorAuditCount()).toBe(auditBefore);
  });

  it('disappears from the roster', async () => {
    const token = await adminToken('sd-roster');
    const { doctorId } = await seedDoctor('sd-roster-deleted');

    await harness.prisma.doctor.update({
      where: { id: doctorId },
      data: { deletedAt: new Date() },
    });

    const response = await request(harness.server)
      .get(`${DOCTORS}?pageSize=100`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(
      dataOf<{ items: { id: string }[] }>(response).items.some((row) => row.id === doctorId),
    ).toBe(false);
  });
});

describe('an active doctor on the same routes', () => {
  it('is read, suspended, reactivated and rejected as before', async () => {
    const token = await adminToken('live-admin');
    const { doctorId } = await seedDoctor('live-doctor');

    const detail = await request(harness.server)
      .get(`${DOCTORS}/${doctorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(dataOf<{ id: string }>(detail).id).toBe(doctorId);

    const suspend = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Licence under review' });
    expect(suspend.status).toBe(200);
    expect((await snapshot(doctorId)).practiceStatus).toBe('SUSPENDED');

    const reactivate = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/reactivate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(reactivate.status).toBe(200);
    expect((await snapshot(doctorId)).practiceStatus).toBe('ACTIVE');

    const reject = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Licence does not match' });
    expect(reject.status).toBe(200);
    expect((await snapshot(doctorId)).verificationStatus).toBe('REJECTED');
  });

  it('is verified once every required document is approved', async () => {
    const token = await adminToken('live-verifier');
    const { doctorId } = await seedDoctor('live-verified');

    for (const kind of ['medical_license', 'degree_certificate', 'national_id']) {
      const documentId = await uploadDocument(doctorId, kind);
      const approve = await request(harness.server)
        .post(`${DOCTORS}/${doctorId}/documents/${documentId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .send(APPROVAL);
      expect(approve.status).toBe(200);
    }

    const verify = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(verify.status).toBe(200);
    expect((await snapshot(doctorId)).verificationStatus).toBe('VERIFIED');
  });
});

describe("a soft-deleted doctor's own routes", () => {
  it('cannot read the weekly grid, time off or verification documents', async () => {
    const { email, doctorId } = await seedDoctor('sd-self');
    const token = await tokenFor(email);

    const live = await request(harness.server)
      .get('/api/v1/me/availability')
      .set('Authorization', `Bearer ${token}`);
    expect(live.status).toBe(200);

    await harness.prisma.doctor.update({
      where: { id: doctorId },
      data: { deletedAt: new Date() },
    });
    const before = await snapshot(doctorId);

    const grid = await request(harness.server)
      .get('/api/v1/me/availability')
      .set('Authorization', `Bearer ${token}`);
    expect(grid.status).toBe(404);

    const timeOff = await request(harness.server)
      .get('/api/v1/me/time-off')
      .set('Authorization', `Bearer ${token}`);
    expect(timeOff.status).toBe(404);

    const documents = await request(harness.server)
      .get('/api/v1/me/verification-documents')
      .set('Authorization', `Bearer ${token}`);
    expect(documents.status).toBe(404);

    expect(await snapshot(doctorId)).toEqual(before);
  });
});
