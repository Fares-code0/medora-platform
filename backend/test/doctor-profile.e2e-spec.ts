import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  patientRegistrationBody,
  professionalNumberFor,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * `GET/PATCH /me/profile` and `PUT /me/profile/photo`
 * (RM M9.1, M9.2 — API §3.1–3.3, ADR-036).
 *
 * The milestone's verify step for M9.1 is "license change flips status
 * and notifies", and that is the centre of this file. Three properties
 * around it are worth reading:
 *
 *  · **The reset is compared against the stored value, not against the
 *    body.** A settings screen sends the whole document back on every
 *    save, so "the client mentioned `licenseNumber`" is true every time
 *    — and a practitioner whose verification reset when they edited
 *    their biography would learn to stop editing.
 *  · **The reset and the edit are one statement.** "Verified against a
 *    number no longer on the row" must be unreachable, not unlikely.
 *  · **`GET` serves everyone, `PATCH` serves practitioners.** ADR-036
 *    and ADR-030 RA-030.2: there is a document to read and no decision
 *    about a patient writing it.
 *
 * `patient-api.e2e-spec.ts` covers the patient half of the same route,
 * unchanged by the move — which is the point of ADR-036's composition
 * being additive.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PROFILE = '/api/v1/me/profile';
const PHOTO = '/api/v1/me/profile/photo';
const DOCTORS = '/api/v1/doctors';
const PASSWORD = 'Medora123!';
/** A PNG's eight-byte signature — enough for the upload's content check. */
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

interface DoctorProfileView {
  id: string;
  fullName: string;
  specialty: string;
  licenseNumber: string;
  licenseExpiresOn: string | null;
  biography: string | null;
  languages: string[];
  skills: string[];
  contactEmail: string;
  contactPhone: string;
  verificationStatus: string;
  verifiedAt: string | null;
  practiceStatus: string;
  ratingAvg: number | null;
}

interface SelfProfileView {
  account: { id: string; email: string; displayName: string };
  patient: unknown;
  doctor: DoctorProfileView | null;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function seedDoctor(local: string): Promise<{ email: string; token: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return { email, token: dataOf<SessionPayload>(response).accessToken };
}

async function seedPatient(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(patientRegistrationBody({ email }));
  await markVerified(harness.prisma, email);

  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}

/** An administrator token, built the only way ADR-035 §7 allows one. */
async function adminToken(local: string): Promise<string> {
  const { email, token } = await seedDoctor(local);

  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set('Authorization', `Bearer ${token}`)
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${token}`)
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

async function readProfile(token: string): Promise<SelfProfileView> {
  const response = await request(harness.server)
    .get(PROFILE)
    .set('Authorization', `Bearer ${token}`);

  return dataOf<SelfProfileView>(response);
}

async function patch(token: string, body: object): Promise<request.Response> {
  return request(harness.server).patch(PROFILE).set('Authorization', `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  harness = await createAuthHarness('doctor-profile');
}, 60_000);

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('GET /me/profile — the composed document (§3.1, ADR-036)', () => {
  it('carries the professional half for a doctor', async () => {
    const { token } = await seedDoctor('amelia');

    const view = await readProfile(token);

    expect(Object.keys(view).sort()).toEqual(['account', 'doctor', 'patient']);
    expect(view.doctor?.specialty).toBe('Cardiology');
    expect(view.doctor?.licenseNumber).toBe(professionalNumberFor(testEmail('amelia')));
    // Read-only fields are present and are the seeded defaults.
    expect(view.doctor?.verificationStatus).toBe('pending');
    expect(view.doctor?.practiceStatus).toBe('active');
    // A doctor has no clinical record.
    expect(view.patient).toBeNull();
  });

  it('carries doctor: null for a patient, and the patient half unchanged', async () => {
    const token = await seedPatient('sara');

    const view = await readProfile(token);

    // The composition is additive: a patient client sees exactly the
    // `account` and `patient` it always did, plus a null it can ignore.
    expect(view.doctor).toBeNull();
    expect(view.patient).toBeNull();
    expect(view.account.email).toBe(testEmail('sara'));
  });

  it('never carries the internal doctor columns', async () => {
    const { token } = await seedDoctor('internals');

    const response = await request(harness.server)
      .get(PROFILE)
      .set('Authorization', `Bearer ${token}`);

    const raw = JSON.stringify(response.body);
    // The practitioner's own settings screen edits none of these, and a
    // field on the wire is a field in a log.
    for (const forbidden of ['employeeId', 'emergencyContactName', 'emergencyContactPhone']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(harness.server).get(PROFILE)).status).toBe(401);
  });
});

describe('PATCH /me/profile (§3.2)', () => {
  it('edits the ordinary fields without touching verification', async () => {
    const { token } = await seedDoctor('editor');

    const response = await patch(token, {
      biography: 'Twelve years in interventional cardiology.',
      languages: ['English', 'Arabic'],
      skills: ['Echocardiography', 'Angioplasty'],
      officeHours: 'Mon–Thu, 09:00–17:00',
    });

    expect(response.status).toBe(200);

    const doctor = dataOf<SelfProfileView>(response).doctor;
    expect(doctor?.biography).toContain('interventional cardiology');
    expect(doctor?.languages).toEqual(['English', 'Arabic']);
    expect(doctor?.verificationStatus).toBe('pending');
  });

  it('flips a verified doctor back to pending when the licence number changes', async () => {
    const admin = await adminToken('verifier');
    const { email, token } = await seedDoctor('licensee');

    // Get them genuinely verified first, through the real M9.3 workflow.
    const doctorRow = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email } },
      select: { id: true },
    });

    for (const kind of ['medical_license', 'degree_certificate', 'national_id']) {
      const file = await harness.prisma.file.create({
        data: {
          storageKey: `test/${doctorRow.id}/${kind}`,
          originalName: `${kind}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(512),
          checksumSha256: 'a'.repeat(64),
          kind: 'verification_document',
        },
      });
      const document = await harness.prisma.doctorVerificationDocument.create({
        data: { doctorId: doctorRow.id, kind, fileId: file.id },
        select: { id: true },
      });
      await request(harness.server)
        .post(`${DOCTORS}/${doctorRow.id}/documents/${document.id}/approve`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ authentic: true, current: true, identityMatch: true });
    }

    await request(harness.server)
      .post(`${DOCTORS}/${doctorRow.id}/verify`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});

    expect((await readProfile(token)).doctor?.verificationStatus).toBe('verified');

    // Now the edit that matters.
    const response = await patch(token, { licenseNumber: 'REG-CHANGED-0001' });

    expect(response.status).toBe(200);

    const doctor = dataOf<SelfProfileView>(response).doctor;
    expect(doctor?.licenseNumber).toBe('REG-CHANGED-0001');
    // The badge goes with the number it was granted against.
    expect(doctor?.verificationStatus).toBe('pending');
    // And the timestamp goes with it: `verified_at` beside `pending`
    // would read as a verification that is still good.
    expect(doctor?.verifiedAt).toBeNull();
  });

  it('re-opens verification when the licence expiry moves', async () => {
    const { token } = await seedDoctor('expiry');

    await harness.prisma.doctor.updateMany({
      where: { user: { email: testEmail('expiry') } },
      data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() },
    });

    const response = await patch(token, { licenseExpiresOn: '2030-06-30' });

    // A practitioner extending their own registration date without
    // re-verification would be self-certifying the thing the workflow
    // exists to check.
    expect(dataOf<SelfProfileView>(response).doctor?.verificationStatus).toBe('pending');
    expect(dataOf<SelfProfileView>(response).doctor?.licenseExpiresOn).toBe('2030-06-30');
  });

  it('does not re-open verification when an unrelated field changes', async () => {
    const { token } = await seedDoctor('biography');

    await harness.prisma.doctor.updateMany({
      where: { user: { email: testEmail('biography') } },
      data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() },
    });

    const response = await patch(token, { biography: 'Updated on a Tuesday.' });

    expect(dataOf<SelfProfileView>(response).doctor?.verificationStatus).toBe('verified');
  });

  it('does not re-open verification when the licence number is resent unchanged', async () => {
    const { email, token } = await seedDoctor('resend');

    await harness.prisma.doctor.updateMany({
      where: { user: { email } },
      data: { verificationStatus: 'VERIFIED', verifiedAt: new Date() },
    });

    // A settings screen sends the whole document back on every save.
    const response = await patch(token, {
      licenseNumber: professionalNumberFor(email),
      biography: 'Same number, new sentence.',
    });

    // Comparing against the body rather than the stored value would
    // reset verification on every save a practitioner ever made.
    expect(dataOf<SelfProfileView>(response).doctor?.verificationStatus).toBe('verified');
  });

  it('answers 409 when the registration number belongs to another practitioner', async () => {
    const first = await seedDoctor('holder');
    const second = await seedDoctor('claimant');

    const response = await patch(second.token, {
      licenseNumber: professionalNumberFor(first.email),
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('professional_number_taken');
  });

  it('rejects values outside the contract bounds', async () => {
    const { token } = await seedDoctor('bounds');

    for (const body of [
      { fullName: 'A' },
      { yearsOfExperience: 71 },
      { yearsOfExperience: -1 },
      { biography: 'x'.repeat(601) },
      { languages: Array.from({ length: 9 }, (_, index) => `L${String(index)}`) },
      { skills: Array.from({ length: 13 }, (_, index) => `S${String(index)}`) },
      { contactEmail: 'not-an-email' },
      { contactPhone: '12' },
      { linkedinUrl: 'linkedin.com/in/someone' },
      { licenseExpiresOn: '30-06-2030' },
    ]) {
      const response = await patch(token, body);
      expect(response.status).toBe(422);
    }
  });

  it('refuses to set the read-only governance fields', async () => {
    const { token } = await seedDoctor('selfverify');

    const response = await patch(token, {
      verificationStatus: 'verified',
      practiceStatus: 'active',
      ratingAvg: 5,
      biography: 'A legitimate edit alongside three that are not.',
    });

    // Unknown keys are stripped rather than rejected, so the edit
    // succeeds — and the governance fields are untouched, which is what
    // stops a doctor verifying themselves.
    expect(response.status).toBe(200);
    expect(dataOf<SelfProfileView>(response).doctor?.verificationStatus).toBe('pending');

    const row = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: testEmail('selfverify') } },
      select: { verificationStatus: true, ratingAvg: true },
    });
    expect(row.verificationStatus).toBe('PENDING');
    expect(row.ratingAvg).toBeNull();
  });

  it('answers 404 for an account with no doctor profile', async () => {
    const token = await seedPatient('nodoctor');

    const response = await patch(token, { biography: 'I would like a profile please.' });

    // ADR-030 RA-030.2: there is a document to read and no decision
    // about a patient writing it.
    expect(response.status).toBe(404);
  });

  it('writes a profile activity entry', async () => {
    const { token } = await seedDoctor('feed');

    await patch(token, { licenseNumber: 'REG-FEED-0001' });

    const feed = await request(harness.server)
      .get('/api/v1/me/activity')
      .set('Authorization', `Bearer ${token}`);

    const items = dataOf<{ items: { kind: string; summary: string }[] }>(feed).items;
    expect(items[0]?.kind).toBe('profile');
    expect(items[0]?.summary).toContain('verification re-opened');
  });
});

describe('PUT /me/profile/photo (§3.3, M9.2)', () => {
  it('validates the image before reaching storage', async () => {
    const { token } = await seedDoctor('photovalidation');

    const wrongType = await request(harness.server)
      .put(PHOTO)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.from('%PDF-1.4'), {
        filename: 'scan.pdf',
        contentType: 'application/pdf',
      });

    // The type check runs before the storage call, so it is the answer a
    // client gets today rather than being masked by the 503 below.
    expect(wrongType.status).toBe(422);
    expect(errorBody(wrongType).fieldErrors?.['photo']).toBeDefined();
  });

  it('refuses a file whose bytes are not the image type it declares', async () => {
    const { token } = await seedDoctor('photoimpostor');

    const response = await request(harness.server)
      .put(PHOTO)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', Buffer.from('<!doctype html><script>1</script>'), {
        filename: 'portrait.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['photo']).toEqual([
      "The file's content is not image/png",
    ]);
  });

  it('refuses a request with no file attached', async () => {
    const { token } = await seedDoctor('nofile');

    const response = await request(harness.server)
      .put(PHOTO)
      .set('Authorization', `Bearer ${token}`)
      .send();

    expect(response.status).toBe(422);
  });

  it('answers 503 while object storage is unconfigured', async () => {
    const { token } = await seedDoctor('photostorage');

    const response = await request(harness.server)
      .put(PHOTO)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', PNG_HEADER, {
        filename: 'portrait.png',
        contentType: 'image/png',
      });

    // `UnconfiguredFileStorage` rejects rather than resolving: a `put()`
    // that resolved without writing would hand back an id for bytes that
    // do not exist. M25.2 wires the adapter; the route is already real.
    expect(response.status).toBe(503);
    expect(errorBody(response).code).toBe('service_unavailable');

    // And nothing was recorded against the doctor.
    const row = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: testEmail('photostorage') } },
      select: { photoUrl: true },
    });
    expect(row.photoUrl).toBeNull();
  });

  it('answers 404 for an account with no doctor profile', async () => {
    const token = await seedPatient('photopatient');

    const response = await request(harness.server)
      .put(PHOTO)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo', PNG_HEADER, {
        filename: 'portrait.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(404);
  });
});
