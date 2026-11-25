import { createHash } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
  grantPlatformAdmin,
  patientRegistrationBody,
} from './support/auth-app';

/**
 * The administrator's doctor surface (RM M9.3, M9.5 — API §3.4–3.7).
 *
 * RM M9.5 says it plainly: "**No frontend consumer exists** — ADM-02/
 * ADM-03 are unbuilt (M39.6). Verify by contract test, not by UI." This
 * file is that contract test.
 *
 * The cases worth reading are the gates:
 *
 *  · **Verification refuses until every required document is approved**,
 *    with 409 naming the ones outstanding. M9.3 words the rule as the
 *    button being "enabled only when all required docs approved"; an
 *    enabled button is a client-side courtesy, and a gate only the UI
 *    enforces is one a `curl` walks past.
 *  · **`doctors.verify` and `doctors.manage` are different capabilities**,
 *    and the split is honoured per route — an office manager who runs
 *    the roster must not be able to attest that a licence is genuine.
 *  · **Suspension is `practice_status`, not the account.** The suspended
 *    practitioner still signs in; what changes is that patients stop
 *    seeing them.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const DOCTORS = '/api/v1/doctors';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

interface AdminDoctorSummary {
  id: string;
  fullName: string;
  licenseNumber: string;
  verificationStatus: string;
  practiceStatus: string;
  ratingAvg: number | null;
  lastActiveAt: string | null;
  joinedAt: string;
  patientsCount: number;
  appointments30d: number;
}

interface VerificationDocumentView {
  id: string;
  kind: string;
  decision: string;
  checks: { authentic: boolean; current: boolean; identityMatch: boolean };
  rejectReason: string | null;
}

interface AdminDoctorDetail extends AdminDoctorSummary {
  contactEmail: string;
  contactPhone: string;
  documents: VerificationDocumentView[];
  affectedAppointments: number;
  verifiable: boolean;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
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
  await grantPlatformAdmin(harness.prisma, email);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  return dataOf<SessionPayload>(verified).accessToken;
}

/** A `files` row plus the verification document that points at it. */
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

const APPROVAL = { authentic: true, current: true, identityMatch: true };

async function approveAll(token: string, doctorId: string): Promise<void> {
  for (const kind of ['medical_license', 'degree_certificate', 'national_id']) {
    const documentId = await uploadDocument(doctorId, kind);
    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send(APPROVAL);

    expect(response.status).toBe(200);
  }
}

beforeAll(async () => {
  harness = await createAuthHarness('doctor-admin');
}, 60_000);

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('authorization (§3.4–3.7)', () => {
  it('refuses a doctor the roster and every decision', async () => {
    const { email, doctorId } = await seedDoctor('outsider');
    const token = await tokenFor(email);

    expect(
      (await request(harness.server).get(DOCTORS).set('Authorization', `Bearer ${token}`)).status,
    ).toBe(403);

    for (const path of ['verify', 'reject', 'suspend', 'reactivate', 'request-documents']) {
      const response = await request(harness.server)
        .post(`${DOCTORS}/${doctorId}/${path}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'Because I said so', kinds: ['national_id'] });

      // A doctor holds neither `doctors.manage` nor `doctors.verify`, so
      // they cannot verify themselves — which is the point of the split.
      expect(response.status).toBe(403);
    }
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(harness.server).get(DOCTORS)).status).toBe(401);
  });
});

describe('GET /doctors (§3.4)', () => {
  it('still lists a doctor whose account has been soft-deleted', async () => {
    // The roster used to answer **500** for every caller the moment one
    // account was soft-deleted, and it was found as an intermittent
    // failure in this suite rather than as a bug report: whether it
    // fired depended on whether another spec had removed an account
    // yet. `doctors.user_id` is NOT NULL and the relation CASCADEs, so
    // the generated type says `user` is always there — and the
    // soft-delete extension (ADR-021) filters it out of the nested read
    // anyway, handing the projection a null the type denies.
    //
    // An administrator needs this page most when accounts are being
    // removed, so the doctor stays on the roster with no last-active
    // time rather than taking the page down.
    const token = await adminToken('softdeleted');
    const { doctorId, email } = await seedDoctor('softdeleted-doctor');

    await harness.prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    const response = await request(harness.server)
      .get(`${DOCTORS}?pageSize=100`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    const row = dataOf<Page<AdminDoctorSummary>>(response).items.find(
      (entry) => entry.id === doctorId,
    );

    expect(row).toBeDefined();
    expect(row?.lastActiveAt).toBeNull();
  });

  it('returns the roster with its operational columns', async () => {
    const token = await adminToken('lister');
    const { doctorId } = await seedDoctor('listed');

    const response = await request(harness.server)
      .get(`${DOCTORS}?pageSize=100`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    const row = dataOf<Page<AdminDoctorSummary>>(response).items.find(
      (entry) => entry.id === doctorId,
    );

    expect(row).toBeDefined();
    // The four columns UX §3.2 puts on the roster.
    expect(row?.patientsCount).toBe(0);
    expect(row?.appointments30d).toBe(0);
    expect(row?.ratingAvg).toBeNull();
    expect(row).toHaveProperty('lastActiveAt');
    // Unverified practitioners are exactly what this roster is for —
    // the patient-facing one hides them, this one must not.
    expect(row?.verificationStatus).toBe('pending');
  });

  it('carries the licence number, which the patient projection never does', async () => {
    const token = await adminToken('licences');
    const { doctorId } = await seedDoctor('licensed');

    const response = await request(harness.server)
      .get(`${DOCTORS}/${doctorId}`)
      .set('Authorization', `Bearer ${token}`);

    const detail = dataOf<AdminDoctorDetail>(response);
    expect(detail.licenseNumber).toMatch(/^REG-/);
    expect(detail.contactEmail).toBeDefined();

    // And the list does *not* carry the personal contact fields: a
    // roster page renders dozens of rows and needs none of them.
    const listed = await request(harness.server)
      .get(`${DOCTORS}?pageSize=100`)
      .set('Authorization', `Bearer ${token}`);

    const row = dataOf<Page<AdminDoctorSummary>>(listed).items[0];
    expect(row).not.toHaveProperty('contactPhone');
    expect(row).not.toHaveProperty('emergencyContactPhone');
  });

  it('filters by verification status and searches by licence number', async () => {
    const token = await adminToken('filterer');
    const { doctorId } = await seedDoctor('findme');

    const byLicence = await harness.prisma.doctor.findUniqueOrThrow({
      where: { id: doctorId },
      select: { licenseNumber: true },
    });

    const found = await request(harness.server)
      .get(`${DOCTORS}?q=${encodeURIComponent(byLicence.licenseNumber)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(dataOf<Page<AdminDoctorSummary>>(found).items.map((row) => row.id)).toEqual([doctorId]);

    const verifiedOnly = await request(harness.server)
      .get(`${DOCTORS}?verification=verified&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);

    expect(dataOf<Page<AdminDoctorSummary>>(verifiedOnly).items.map((row) => row.id)).not.toContain(
      doctorId,
    );
  });

  it('rejects an unknown verification filter', async () => {
    const token = await adminToken('badfilter');

    const response = await request(harness.server)
      .get(`${DOCTORS}?verification=maybe`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(422);
  });

  it('answers 404 for an unknown doctor and for a non-uuid id', async () => {
    const token = await adminToken('ghosts');

    for (const id of ['11111111-2222-4333-8444-555555555555', 'not-a-uuid']) {
      const response = await request(harness.server)
        .get(`${DOCTORS}/${id}`)
        .set('Authorization', `Bearer ${token}`);

      // The non-uuid case is the one that would otherwise be a 500:
      // Postgres answers a malformed uuid literal with a type error.
      expect(response.status).toBe(404);
    }
  });
});

describe('the verification state machine (§3.6, M9.3)', () => {
  it('refuses to verify until every required document is approved', async () => {
    const token = await adminToken('gatekeeper');
    const { doctorId } = await seedDoctor('ungated');

    const refused = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(refused.status).toBe(409);
    expect(errorBody(refused).detail).toContain('medical_license');
    expect(errorBody(refused).detail).toContain('national_id');

    // Nothing moved.
    const stillPending = await harness.prisma.doctor.findUniqueOrThrow({
      where: { id: doctorId },
      select: { verificationStatus: true, verifiedAt: true },
    });
    expect(stillPending.verificationStatus).toBe('PENDING');
    expect(stillPending.verifiedAt).toBeNull();
  });

  it('still refuses when a required document is uploaded but not approved', async () => {
    const token = await adminToken('halfway');
    const { doctorId } = await seedDoctor('partial');

    await uploadDocument(doctorId, 'medical_license');
    await uploadDocument(doctorId, 'degree_certificate');
    await uploadDocument(doctorId, 'national_id');

    const refused = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    // The gate is "approved", not "uploaded".
    expect(refused.status).toBe(409);
  });

  it('verifies once every required document is approved', async () => {
    const token = await adminToken('approver');
    const { doctorId } = await seedDoctor('approved');

    await approveAll(token, doctorId);

    const detail = await request(harness.server)
      .get(`${DOCTORS}/${doctorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<AdminDoctorDetail>(detail).verifiable).toBe(true);

    const verified = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(verified.status).toBe(200);
    expect(dataOf<{ verificationStatus: string; verifiedAt: string }>(verified)).toMatchObject({
      verificationStatus: 'verified',
    });

    const row = await harness.prisma.doctor.findUniqueOrThrow({
      where: { id: doctorId },
      select: { verificationStatus: true, verifiedAt: true, verifiedBy: true },
    });
    expect(row.verificationStatus).toBe('VERIFIED');
    expect(row.verifiedAt).not.toBeNull();
    // Who decided, not just that someone did.
    expect(row.verifiedBy).not.toBeNull();
  });

  it('refuses a document approval that is not fully attested', async () => {
    const token = await adminToken('halfattested');
    const { doctorId } = await seedDoctor('halfchecked');
    const documentId = await uploadDocument(doctorId, 'national_id');

    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send({ authentic: true, current: true, identityMatch: false });

    // A document approved with `identityMatch` false is one the reviewer
    // has said does not belong to this person.
    expect(response.status).toBe(422);

    const row = await harness.prisma.doctorVerificationDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { decision: true },
    });
    expect(row.decision).toBe('pending');
  });

  it('rejects a document with a reason and clears it on re-approval', async () => {
    const token = await adminToken('rejector');
    const { doctorId } = await seedDoctor('rejected-doc');
    const documentId = await uploadDocument(doctorId, 'medical_license');

    const rejected = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/documents/${documentId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'The scan is illegible' });

    expect(rejected.status).toBe(200);
    const afterReject = dataOf<AdminDoctorDetail>(rejected).documents.find(
      (doc) => doc.id === documentId,
    );
    expect(afterReject?.decision).toBe('rejected');
    expect(afterReject?.rejectReason).toBe('The scan is illegible');

    const reapproved = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send(APPROVAL);

    const afterApprove = dataOf<AdminDoctorDetail>(reapproved).documents.find(
      (doc) => doc.id === documentId,
    );
    // A stale reason beside a green tick is a contradiction that
    // outlives whoever could explain it.
    expect(afterApprove?.decision).toBe('approved');
    expect(afterApprove?.rejectReason).toBeNull();
  });

  it('requires a reason to reject a verification', async () => {
    const token = await adminToken('noreason');
    const { doctorId } = await seedDoctor('unreasoned');

    for (const body of [{}, { reason: '' }, { reason: 'ab' }]) {
      const response = await request(harness.server)
        .post(`${DOCTORS}/${doctorId}/reject`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      // P4: the reason is the half that survives into the audit trail,
      // so an optional one would be an optional audit trail.
      expect(response.status).toBe(422);
    }
  });

  it('rejects a verification and clears any stale verified_at', async () => {
    const token = await adminToken('unverifier');
    const { doctorId } = await seedDoctor('unverified');

    await approveAll(token, doctorId);
    await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/verify`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'The register lists this number against another practitioner' });

    expect(response.status).toBe(200);

    const row = await harness.prisma.doctor.findUniqueOrThrow({
      where: { id: doctorId },
      select: { verificationStatus: true, verifiedAt: true },
    });
    expect(row.verificationStatus).toBe('REJECTED');
    expect(row.verifiedAt).toBeNull();
  });

  it('requests documents and tells the doctor in their own feed', async () => {
    const token = await adminToken('requester');
    const { email, doctorId } = await seedDoctor('asked');

    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/request-documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kinds: ['national_id'], reason: 'The uploaded identity page has expired' });

    expect(response.status).toBe(200);
    expect(dataOf<{ verificationStatus: string }>(response).verificationStatus).toBe(
      'docs_requested',
    );

    // Filtered to `security`. Fetching the token signs the doctor in,
    // and since M29.1 that writes a `login` row which is newer than the
    // entry under test — so the unfiltered feed's first item is no
    // longer the one this test is about.
    const doctorFeed = await request(harness.server)
      .get('/api/v1/me/activity?kind=security')
      .set('Authorization', `Bearer ${await tokenFor(email)}`);

    const items = dataOf<{ items: { kind: string; summary: string; detail: string | null }[] }>(
      doctorFeed,
    ).items;
    expect(items[0]?.kind).toBe('security');
    expect(items[0]?.summary).toContain('documents');
    expect(items[0]?.detail).toContain('expired');
  });

  it('refuses an empty document request', async () => {
    const token = await adminToken('emptyrequest');
    const { doctorId } = await seedDoctor('nothing-asked');

    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/request-documents`)
      .set('Authorization', `Bearer ${token}`)
      .send({ kinds: [], reason: 'Send me something' });

    expect(response.status).toBe(422);
  });

  it("answers 404 for a document that is not this doctor's", async () => {
    const token = await adminToken('crossdoc');
    const mine = await seedDoctor('docowner');
    const theirs = await seedDoctor('docother');
    const documentId = await uploadDocument(mine.doctorId, 'national_id');

    const response = await request(harness.server)
      .post(`${DOCTORS}/${theirs.doctorId}/documents/${documentId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send(APPROVAL);

    expect(response.status).toBe(404);

    const row = await harness.prisma.doctorVerificationDocument.findUniqueOrThrow({
      where: { id: documentId },
      select: { decision: true },
    });
    expect(row.decision).toBe('pending');
  });
});

describe('suspension (§3.7, M9.5)', () => {
  it('suspends with a reason and reports the consequence count', async () => {
    const token = await adminToken('suspender');
    const { email, doctorId } = await seedDoctor('suspended');

    const patient = await harness.prisma.patient.findFirstOrThrow({ select: { id: true } });
    const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });
    const appointment = await harness.prisma.appointment.create({
      data: {
        publicId: `APT-SUS-${Date.now().toString(36)}`,
        patientId: patient.id,
        doctorId,
        visitTypeId: visitType.id,
        startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        durationMin: 30,
        status: 'CONFIRMED',
        reason: 'Follow-up',
      },
    });

    // §3.5 carries the same number, so the confirmation dialog can be
    // drawn before anything is pressed.
    const detail = await request(harness.server)
      .get(`${DOCTORS}/${doctorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<AdminDoctorDetail>(detail).affectedAppointments).toBe(1);

    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Practising rights under review' });

    expect(response.status).toBe(200);
    expect(
      dataOf<{ practiceStatus: string; affectedAppointments: number }>(response),
    ).toMatchObject({ practiceStatus: 'suspended', affectedAppointments: 1 });

    // Suspension is `practice_status`, not the account: the doctor still
    // signs in, and can still reach their own records.
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    expect(login.status).toBe(200);

    // Outside clinical standing they reach their own account only (F-09):
    // the directory is refused to them.
    const ownView = await request(harness.server)
      .get('/api/v1/patient/doctors?pageSize=100')
      .set('Authorization', `Bearer ${dataOf<SessionPayload>(login).accessToken}`);
    expect(ownView.status).toBe(403);

    // What changed for patients is that they no longer see them.
    const patientEmail = testEmail('suspension-patient');
    await request(harness.server).post(REGISTER).send(patientRegistrationBody({ email: patientEmail }));
    await markVerified(harness.prisma, patientEmail);
    const patientLogin = await request(harness.server)
      .post(LOGIN)
      .send({ email: patientEmail, password: PASSWORD, rememberMe: false });
    const patientView = await request(harness.server)
      .get('/api/v1/patient/doctors?pageSize=100')
      .set('Authorization', `Bearer ${dataOf<SessionPayload>(patientLogin).accessToken}`);
    expect(
      dataOf<Page<{ id: string }>>(patientView).items.map((row) => row.id),
    ).not.toContain(doctorId);

    await harness.prisma.appointment.delete({ where: { id: appointment.id } });
  });

  it('requires a reason to suspend but not to reactivate', async () => {
    const token = await adminToken('reactivator');
    const { doctorId } = await seedDoctor('restored');

    const withoutReason = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(withoutReason.status).toBe(422);

    await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/suspend`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Temporary hold pending paperwork' });

    // Restoring access is not destructive, so it takes no reason.
    const reactivated = await request(harness.server)
      .post(`${DOCTORS}/${doctorId}/reactivate`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(reactivated.status).toBe(200);
    expect(dataOf<{ practiceStatus: string }>(reactivated).practiceStatus).toBe('active');
  });
});
