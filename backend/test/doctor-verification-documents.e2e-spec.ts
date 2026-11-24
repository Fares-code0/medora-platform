import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  FILE_STORAGE,
  type FileStoragePort,
  type FileUpload,
  type StoredFile,
} from '../src/shared/files';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { markPlatformAdmin } from './support/admin-scope';

/**
 * `GET/POST /me/verification-documents` — frontend checklist NEW-46.
 *
 * Until this route, nothing created a `doctor_verification_documents`
 * row: `POST /doctors/:id/verify` answers 409 until every required
 * document is approved, so a doctor who registered could never be
 * verified. The administrator's specs seed the rows straight into the
 * table for exactly that reason. The last test here is the one the
 * checklist row asks for — a registered doctor, verified end to end,
 * through HTTP alone.
 */

/** Holds the bytes so `POST /files` succeeds without an object store. */
class InMemoryStorage implements FileStoragePort {
  readonly objects = new Map<string, Buffer>();

  put(upload: FileUpload): Promise<StoredFile> {
    const key = `${upload.kind}/${String(this.objects.size)}-${upload.name}`;
    this.objects.set(key, upload.content);

    return Promise.resolve({
      id: key,
      key,
      name: upload.name,
      mimeType: upload.mimeType,
      sizeBytes: upload.content.byteLength,
      scanStatus: 'pending',
    });
  }

  signedDownloadUrl(key: string, ttlSeconds: number): Promise<string> {
    return Promise.resolve(`https://objects.test/${key}?ttl=${String(ttlSeconds)}`);
  }

  get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    return object === undefined
      ? Promise.reject(new Error(`no object at ${key}`))
      : Promise.resolve(object);
  }

  remove(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

let harness: AuthHarness;
const storage = new InMemoryStorage();

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const FILES = '/api/v1/files';
const MINE = '/api/v1/me/verification-documents';
const DOCTORS = '/api/v1/doctors';
const PASSWORD = 'Medora123!';
const NAME_PREFIX = 'NEW46 ';

const PDF = Buffer.from('%PDF-1.7 a medical licence');

interface DocumentView {
  readonly id: string;
  readonly kind: string;
  readonly fileId: string;
  readonly uploadedAt: string;
  readonly expiresOn: string | null;
  readonly decision: string;
  readonly decidedAt: string | null;
  readonly rejectReason: string | null;
  readonly checks: { authentic: boolean; current: boolean; identityMatch: boolean };
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

async function tokenFor(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function seedDoctor(
  local: string,
): Promise<{ email: string; token: string; doctorId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true },
  });

  return { email, token: await tokenFor(email), doctorId: doctor.id };
}

/** An administrator token, built the way ADR-035 §7 allows (second factor first). */
async function adminToken(local: string): Promise<string> {
  const { email, token: bootstrap } = await seedDoctor(local);

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
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
  // S5: the admin role alone has no administrative scope (OD-07, M-13).
  await markPlatformAdmin(harness.prisma, email);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  return dataOf<{ accessToken: string }>(verified).accessToken;
}

async function uploadFile(token: string, kind = 'verification_document'): Promise<string> {
  const response = await request(harness.server)
    .post(FILES)
    .set(as(token))
    .field('kind', kind)
    .attach('file', PDF, { filename: `${NAME_PREFIX}licence.pdf`, contentType: 'application/pdf' });

  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return dataOf<{ id: string }>(response).id;
}

function submit(token: string, body: Record<string, unknown>) {
  return request(harness.server).post(MINE).set(as(token)).send(body);
}

beforeAll(async () => {
  harness = await createAuthHarness('doctor-verification-docs', {
    overrides: [{ token: FILE_STORAGE, value: storage }],
  });
}, 90_000);

beforeEach(async () => {
  await harness.reset();
});

afterAll(async () => {
  if (harness === undefined) return;

  await harness.reset();
  await harness.prisma.file.deleteMany({ where: { originalName: { startsWith: NAME_PREFIX } } });
  await harness.close();
});

describe('POST /me/verification-documents — filing an upload', () => {
  it('files the doctor’s own upload as a pending document of the kind given', async () => {
    const { token, doctorId } = await seedDoctor('filer');
    const fileId = await uploadFile(token);

    const response = await submit(token, {
      fileId,
      kind: 'medical_license',
      expiresOn: '2028-03-31',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const document = dataOf<DocumentView>(response);
    expect(document).toMatchObject({
      kind: 'medical_license',
      fileId,
      expiresOn: '2028-03-31',
      decision: 'pending',
      decidedAt: null,
      rejectReason: null,
      checks: { authentic: false, current: false, identityMatch: false },
    });

    const row = await harness.prisma.doctorVerificationDocument.findUniqueOrThrow({
      where: { id: document.id },
      select: { doctorId: true, createdBy: true },
    });
    expect(row.doctorId).toBe(doctorId);
  });

  it('records the filing in the audit ledger, with no filename', async () => {
    const { email, token, doctorId } = await seedDoctor('audited');
    const fileId = await uploadFile(token);
    const actor = await harness.prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    const document = dataOf<DocumentView>(await submit(token, { fileId, kind: 'national_id' }));

    const events = await harness.prisma.auditEvent.findMany({
      where: { eventType: 'doctor.verification_document_upload', actorId: actor.id },
    });
    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).toContain(document.id);
    expect(serialized).toContain(doctorId);
    expect(serialized).not.toContain('licence.pdf');
  });

  it('refuses another account’s upload as an unknown one (422), not a 403', async () => {
    const owner = await seedDoctor('owner');
    const thief = await seedDoctor('thief');
    const fileId = await uploadFile(owner.token);

    const response = await submit(thief.token, { fileId, kind: 'medical_license' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.fileId).toBeDefined();
  });

  it('refuses an upload of another kind', async () => {
    const { token } = await seedDoctor('wrongkind');
    const fileId = await uploadFile(token, 'patient_document');

    const response = await submit(token, { fileId, kind: 'medical_license' });

    expect(response.status).toBe(422);
  });

  it('refuses an id that names no upload, in the same words', async () => {
    const { token } = await seedDoctor('ghost');

    const response = await submit(token, {
      fileId: '00000000-0000-4000-8000-000000000000',
      kind: 'degree_certificate',
    });

    expect(response.status).toBe(422);
  });

  it('files one upload once (409)', async () => {
    const { token } = await seedDoctor('twice');
    const fileId = await uploadFile(token);

    expect((await submit(token, { fileId, kind: 'medical_license' })).status).toBe(201);
    const again = await submit(token, { fileId, kind: 'degree_certificate' });

    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('verification_document_already_filed');
  });

  it('files one upload once even when two requests race', async () => {
    const { token } = await seedDoctor('race');
    const fileId = await uploadFile(token);

    const answers = await Promise.all([
      submit(token, { fileId, kind: 'medical_license' }),
      submit(token, { fileId, kind: 'medical_license' }),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([201, 409]);
    expect(await harness.prisma.doctorVerificationDocument.count({ where: { fileId } })).toBe(1);
  });

  it.each([
    ['an unknown kind', { kind: 'selfie' }],
    ['a date that is not one', { kind: 'medical_license', expiresOn: '2028-02-30' }],
    ['a date with a time', { kind: 'medical_license', expiresOn: '2028-02-01T00:00:00Z' }],
  ])('refuses %s with a field error', async (_, body) => {
    const { token } = await seedDoctor('invalid');
    const fileId = await uploadFile(token);

    const response = await submit(token, { fileId, ...body });

    expect(response.status).toBe(422);
  });

  it('answers 404 to an account with no doctor profile', async () => {
    const email = testEmail('patient');
    await request(harness.server).post(REGISTER).send(patientRegistrationBody({ email }));
    await markVerified(harness.prisma, email);
    const token = await tokenFor(email);

    expect((await request(harness.server).get(MINE).set(as(token))).status).toBe(404);
    expect(
      (await submit(token, { fileId: '00000000-0000-4000-8000-000000000000', kind: 'other' }))
        .status,
    ).toBe(404);
  });

  it('answers 401 without a session', async () => {
    expect((await request(harness.server).get(MINE)).status).toBe(401);
    expect(
      (
        await request(harness.server)
          .post(MINE)
          .send({ fileId: '00000000-0000-4000-8000-000000000000', kind: 'other' })
      ).status,
    ).toBe(401);
  });

  it('files under the caller whatever doctor the body names', async () => {
    const caller = await seedDoctor('caller');
    const victim = await seedDoctor('victim');
    const fileId = await uploadFile(caller.token);

    const response = await submit(caller.token, {
      fileId,
      kind: 'medical_license',
      doctorId: victim.doctorId,
    });

    expect(response.status).toBe(201);
    const row = await harness.prisma.doctorVerificationDocument.findUniqueOrThrow({
      where: { id: dataOf<DocumentView>(response).id },
      select: { doctorId: true },
    });
    expect(row.doctorId).toBe(caller.doctorId);
    expect(
      await harness.prisma.doctorVerificationDocument.count({
        where: { doctorId: victim.doctorId },
      }),
    ).toBe(0);
  });

  it('refuses a request with no file id', async () => {
    const { token } = await seedDoctor('nofile');

    const response = await submit(token, { kind: 'medical_license' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.fileId).toBeDefined();
  });
});

describe('POST /files with kind=verification_document — the upload rules', () => {
  it('refuses a type the kind does not take, before storing anything', async () => {
    const { token } = await seedDoctor('texttype');
    const before = storage.objects.size;

    const response = await request(harness.server)
      .post(FILES)
      .set(as(token))
      .field('kind', 'verification_document')
      .attach('file', Buffer.from('just text'), {
        filename: `${NAME_PREFIX}notes.txt`,
        contentType: 'text/plain',
      });

    expect(response.status).toBe(422);
    expect(storage.objects.size).toBe(before);
  });

  it('refuses a file over the kind’s 10 MB ceiling', async () => {
    const { token } = await seedDoctor('oversized');
    const oversized = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);

    const response = await request(harness.server)
      .post(FILES)
      .set(as(token))
      .field('kind', 'verification_document')
      .attach('file', oversized, {
        filename: `${NAME_PREFIX}huge.pdf`,
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(422);
  });

  it('refuses bytes that are not the type they claim', async () => {
    const { token } = await seedDoctor('disguised');

    const response = await request(harness.server)
      .post(FILES)
      .set(as(token))
      .field('kind', 'verification_document')
      .attach('file', Buffer.from('MZ not a pdf at all'), {
        filename: `${NAME_PREFIX}disguised.pdf`,
        contentType: 'application/pdf',
      });

    expect(response.status).toBe(422);
  });
});

describe('DELETE /files/:id — a filed verification document is kept', () => {
  it('lets a doctor discard an upload they have not filed', async () => {
    const { token } = await seedDoctor('discarder');
    const fileId = await uploadFile(token);

    expect((await request(harness.server).delete(`${FILES}/${fileId}`).set(as(token))).status).toBe(
      204,
    );
  });

  it('refuses to delete the file behind a filed document (409), and the document stays', async () => {
    const { token } = await seedDoctor('eraser');
    const fileId = await uploadFile(token);
    const document = dataOf<DocumentView>(await submit(token, { fileId, kind: 'medical_license' }));

    const response = await request(harness.server).delete(`${FILES}/${fileId}`).set(as(token));

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('verification_document_filed');
    const file = await harness.prisma.file.findUniqueOrThrow({
      where: { id: fileId },
      select: { deletedAt: true },
    });
    expect(file.deletedAt).toBeNull();
    const listed = dataOf<DocumentView[]>(await request(harness.server).get(MINE).set(as(token)));
    expect(listed.map((entry) => entry.id)).toEqual([document.id]);
  });
});

describe('GET /me/verification-documents — what the doctor has filed', () => {
  it('lists only the caller’s documents, newest first, with their decisions', async () => {
    const mine = await seedDoctor('lister');
    const theirs = await seedDoctor('neighbour');

    const first = dataOf<DocumentView>(
      await submit(mine.token, { fileId: await uploadFile(mine.token), kind: 'medical_license' }),
    );
    const second = dataOf<DocumentView>(
      await submit(mine.token, { fileId: await uploadFile(mine.token), kind: 'national_id' }),
    );
    await submit(theirs.token, { fileId: await uploadFile(theirs.token), kind: 'other' });

    const response = await request(harness.server).get(MINE).set(as(mine.token));

    expect(response.status).toBe(200);
    expect(dataOf<DocumentView[]>(response).map((document) => document.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it('shows the doctor a rejection and its reason', async () => {
    const admin = await adminToken('reviewer');
    const doctor = await seedDoctor('rejected');
    const document = dataOf<DocumentView>(
      await submit(doctor.token, {
        fileId: await uploadFile(doctor.token),
        kind: 'degree_certificate',
      }),
    );

    const rejected = await request(harness.server)
      .post(`${DOCTORS}/${doctor.doctorId}/documents/${document.id}/reject`)
      .set(as(admin))
      .send({ reason: 'The scan is cut off at the seal' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);

    const listed = dataOf<DocumentView[]>(
      await request(harness.server).get(MINE).set(as(doctor.token)),
    );
    expect(listed[0]).toMatchObject({
      id: document.id,
      decision: 'rejected',
      rejectReason: 'The scan is cut off at the seal',
    });
  });
});

describe('NEW-46 acceptance — a registered doctor can be verified end to end', () => {
  it('files the three required documents, an administrator approves them, and verify succeeds', async () => {
    const admin = await adminToken('verifier');
    const doctor = await seedDoctor('newcomer');

    // Before any filing, the gate holds: nothing to approve, so no verify.
    const early = await request(harness.server)
      .post(`${DOCTORS}/${doctor.doctorId}/verify`)
      .set(as(admin))
      .send({});
    expect(early.status).toBe(409);

    for (const kind of ['medical_license', 'degree_certificate', 'national_id']) {
      const filed = await submit(doctor.token, { fileId: await uploadFile(doctor.token), kind });
      expect(filed.status, JSON.stringify(filed.body)).toBe(201);

      const approved = await request(harness.server)
        .post(`${DOCTORS}/${doctor.doctorId}/documents/${dataOf<DocumentView>(filed).id}/approve`)
        .set(as(admin))
        .send({ authentic: true, current: true, identityMatch: true });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    }

    const verified = await request(harness.server)
      .post(`${DOCTORS}/${doctor.doctorId}/verify`)
      .set(as(admin))
      .send({});

    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    expect(dataOf<{ verificationStatus: string }>(verified).verificationStatus).toBe('verified');
  });

  it('does not let a doctor reject their own documents', async () => {
    const doctor = await seedDoctor('selfrejecter');
    const document = dataOf<DocumentView>(
      await submit(doctor.token, { fileId: await uploadFile(doctor.token), kind: 'national_id' }),
    );

    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctor.doctorId}/documents/${document.id}/reject`)
      .set(as(doctor.token))
      .send({ reason: 'I changed my mind' });

    expect(response.status).toBe(403);
  });

  it('does not let a doctor approve their own documents', async () => {
    const doctor = await seedDoctor('selfapprover');
    const document = dataOf<DocumentView>(
      await submit(doctor.token, {
        fileId: await uploadFile(doctor.token),
        kind: 'medical_license',
      }),
    );

    const response = await request(harness.server)
      .post(`${DOCTORS}/${doctor.doctorId}/documents/${document.id}/approve`)
      .set(as(doctor.token))
      .send({ authentic: true, current: true, identityMatch: true });

    expect(response.status).toBe(403);
  });
});
