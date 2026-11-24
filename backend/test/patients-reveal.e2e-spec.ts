import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Prisma } from '../src/generated/prisma/client';
import { type AuditEvent, TransactionalAuditWriter } from '../src/shared/audit';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { assignOwned } from './support/hospital-fixture';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';
import { markPlatformAdmin } from './support/admin-scope';

/**
 * `POST /patients/{id}/reveal` — API §4.9, RM M7.3.
 *
 * > ✅ Verify: reveal without `patients.revealIdentity` → 403 and no audit
 * > row; with it → 200 + audit row exists.
 *
 * "Atomically with the audit write" is asserted as the failure it
 * forbids, not inferred from the success: a second application whose
 * audit insert genuinely fails in Postgres answers 503 and the body
 * carries no identifier.
 *
 * Audit rows are always looked up by **actor**. `audit_events` is shared
 * by every suite in the run, so "no row" must mean "no row by this
 * caller" or it measures whichever suites ran first.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PASSWORD = 'Medora123!';
const TAG = 'rv73';

let adminToken = '';
let adminUserId = '';
let deniedToken = '';
let deniedUserId = '';
let doctorToken = '';
let doctorUserId = '';
let strangerToken = '';
let strangerUserId = '';
let patientPublicId = '';
let patientId = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const reveal = (publicId: string, token: string, body: object = JUSTIFIED) =>
  request(harness.server).post(`/api/v1/patients/${publicId}/reveal`).set(as(token)).send(body);

const JUSTIFIED = {
  category: 'safety-investigation',
  reason: 'Incident report filed by ward staff this morning',
};

interface Revealed {
  patientId: string;
  fullName: string;
  mrn: string;
  phone: string;
  dateOfBirth: string;
  revealed: boolean;
  revealedAt: string;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function userIdOf(email: string, h: AuthHarness = harness): Promise<string> {
  return (await h.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } })).id;
}

async function signUpDoctor(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  return { token, userId: await userIdOf(email) };
}

/** An administrator, which since ADR-035 means one with an enrolled second factor. */
async function signUpAdmin(
  local: string,
  h: AuthHarness = harness,
): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(h.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(h.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(h.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(h.server)
      .post('/api/v1/me/2fa/setup')
      .set(as(bootstrap))
      .send({ password: PASSWORD }),
  ).secret;

  await request(h.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });

  const adminRole = await h.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await h.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
  // S5: the admin role alone has no administrative scope (OD-07, M-13).
  await markPlatformAdmin(h.prisma, email);

  const otpToken = dataOf<{ otpToken: string }>(
    await request(h.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  const token = dataOf<{ accessToken: string }>(
    await request(h.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;

  return { token, userId: await userIdOf(email, h) };
}

/** Reveal rows this actor filed. */
function revealsBy(actorId: string) {
  return harness.prisma.auditEvent.findMany({
    where: { actorId, eventType: 'patient_identity.reveal' },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('patients-reveal-m73', { clinicalDoctors: true });

  ({ token: adminToken, userId: adminUserId } = await signUpAdmin('reveal-admin'));
  ({ token: deniedToken, userId: deniedUserId } = await signUpAdmin('reveal-denied'));
  ({ token: doctorToken, userId: doctorUserId } = await signUpDoctor('reveal-doctor'));
  ({ token: strangerToken, userId: strangerUserId } = await signUpDoctor('reveal-stranger'));

  const [record] = await createPatientRecords(harness.prisma, TAG, 1);
  patientPublicId = record?.publicId ?? '';
  patientId = record?.id ?? '';

  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { userId: doctorUserId },
    select: { id: true },
  });
  // Owned by the doctor's employment at the suite's hospital (S3).
  await assignOwned(harness.prisma, { patientId, doctorId: doctor.id, role: 'primary' });

  // Take the capability away from one administrator through the real
  // override surface (§15.5), which also invalidates the permission
  // cache — a row written behind its back would test the cache instead.
  const deniedPublicId = (
    await harness.prisma.user.findUniqueOrThrow({
      where: { id: deniedUserId },
      select: { publicId: true },
    })
  ).publicId;

  const override = await request(harness.server)
    .put(`/api/v1/users/${deniedPublicId}/permissions`)
    .set(as(adminToken))
    .send({ granted: [], revoked: ['patients.revealIdentity'] });

  expect(override.status, JSON.stringify(override.body)).toBe(200);
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.patientDoctorAssignment.deleteMany({ where: { patientId } });
  await destroyPatientRecords(harness.prisma, TAG);

  await harness.reset();
  await harness.close();
});

describe('M7.3 — who may reveal', () => {
  it('refuses an administrator without patients.revealIdentity, and files nothing', async () => {
    const response = await reveal(patientPublicId, deniedToken);

    expect(response.status, JSON.stringify(response.body)).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain('Test Patient');
    expect(await revealsBy(deniedUserId)).toHaveLength(0);
  });

  it('reveals the clear identity to an administrator holding it, with the row', async () => {
    const response = await reveal(patientPublicId, adminToken);

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const identity = dataOf<Revealed>(response);
    expect(identity).toMatchObject({
      patientId: patientPublicId,
      fullName: 'Test Patient 1',
      mrn: `MRN-T${TAG}0`,
      phone: '+20 100 214 3387',
      dateOfBirth: '1984-05-12',
      revealed: true,
    });

    const rows = await revealsBy(adminUserId);
    expect(rows).toHaveLength(1);

    const [row] = rows;
    expect(row?.category).toBe('SECURITY');
    expect(row?.severity).toBe('WARNING');
    expect(row?.target).toBe(`patient:${patientPublicId}`);
    expect(row?.summary).toBe('Patient identity revealed');
    // The row and the response agree on when the elevation opened.
    expect(row?.occurredAt.toISOString()).toBe(identity.revealedAt);
  });

  it('keeps the category and never the free-text reason', async () => {
    const rows = await revealsBy(adminUserId);
    const payload = JSON.stringify(rows.map((row) => row.payload));

    expect(payload).toContain('safety-investigation');
    expect(payload).not.toContain(JUSTIFIED.reason);
  });

  it('reveals to the treating doctor', async () => {
    const response = await reveal(patientPublicId, doctorToken);

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(dataOf<Revealed>(response).fullName).toBe('Test Patient 1');
    expect(await revealsBy(doctorUserId)).toHaveLength(1);
  });

  it('gives a doctor with no care relationship the same 404 as a missing chart', async () => {
    // The doctor bundle holds `patients.revealIdentity`; holding it must
    // not become a way round M7.2's care scope.
    const stranger = await reveal(patientPublicId, strangerToken);
    const missing = await reveal('PT-T0000000', strangerToken);

    expect(stranger.status).toBe(404);
    expect(stranger.body).toEqual(missing.body);
    expect(await revealsBy(strangerUserId)).toHaveLength(0);
  });

  it('answers 404 for an unknown patient and files nothing', async () => {
    const before = (await revealsBy(adminUserId)).length;
    const response = await reveal('PT-T0000000', adminToken);

    expect(response.status).toBe(404);
    expect(await revealsBy(adminUserId)).toHaveLength(before);
  });
});

describe('M7.3 — the justification', () => {
  it.each([
    ['no body', {}],
    ['a reason under twelve characters', { category: 'clinical-review', reason: 'checking' }],
    [
      'twelve characters only once trimmed',
      { category: 'clinical-review', reason: '   short    ' },
    ],
    ['a category ADM-10 does not offer', { category: 'curiosity', reason: JUSTIFIED.reason }],
  ])('refuses %s with 422 and files nothing', async (_label, body) => {
    const before = (await revealsBy(adminUserId)).length;
    const response = await reveal(patientPublicId, adminToken, body);

    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(JSON.stringify(response.body)).not.toContain('Test Patient');
    expect(await revealsBy(adminUserId)).toHaveLength(before);
  });
});

describe('M7.3 — atomic with the audit write', () => {
  it('answers 503 with no identifier when the ledger refuses the row', async () => {
    // The real writer, on the real transaction, handed an event Postgres
    // rejects: `session_id` is a uuid column. Everything after the event
    // is built — the insert, its failure, the rollback and the mapping to
    // a response — is the production path.
    class RefusedByPostgres extends TransactionalAuditWriter {
      override recordWithin(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
        return super.recordWithin(tx, {
          ...event,
          actor: { ...event.actor, sessionId: 'not-a-uuid' },
        });
      }
    }

    const failing = await createAuthHarness('patients-reveal-m73-fail', {
      overrides: [{ token: TransactionalAuditWriter, value: new RefusedByPostgres() }],
    });

    try {
      const admin = await signUpAdmin('reveal-fail-admin', failing);

      const response = await request(failing.server)
        .post(`/api/v1/patients/${patientPublicId}/reveal`)
        .set(as(admin.token))
        .send(JUSTIFIED);

      expect(response.status, JSON.stringify(response.body)).toBe(503);
      expect(errorBody(response).code).toBe('audit_unavailable');

      const body = JSON.stringify(response.body);
      expect(body).not.toContain('Test Patient');
      expect(body).not.toContain(`MRN-T${TAG}0`);
      expect(body).not.toContain('214 3387');
      // And the provider's words did not reach the client.
      expect(body).not.toMatch(/uuid|prisma|postgres/i);

      expect(await revealsBy(admin.userId)).toHaveLength(0);
    } finally {
      await failing.reset();
      await failing.close();
    }
  });
});
