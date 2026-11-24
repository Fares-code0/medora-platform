import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  registrationBody,
  testEmail,
} from './support/auth-app';
import { deletePatients } from './support/hospital-fixture';

/**
 * Record attachments — API §6.7, RM M12.5.
 *
 * > ✅ Verify: attachment round-trip.
 *
 * The round trip is upload (`POST /files`, kind `record_attachment`) →
 * attach (`POST /medical-records/{id}/attachments`) → the attachment on
 * the document → download behind the scan gate. Every step is driven over
 * HTTP against Postgres; only the object store is the in-memory double
 * `files.e2e-spec.ts` uses, for the reason RA-M25.1 records.
 *
 * The refusals carry the weight: who may link which upload, what a
 * finalised record accepts, and that a download is unreachable — not
 * merely gated — for anyone outside the care relationship.
 */
class InMemoryStorage implements FileStoragePort {
  readonly objects = new Map<string, Buffer>();

  put(upload: FileUpload): Promise<StoredFile> {
    const key = `${upload.kind}/${String(this.objects.size)}`;
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
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';
const FILES = '/api/v1/files';
const PASSWORD = 'Medora123!';
/** Every upload this suite makes, so teardown removes exactly those. */
const NAME_PREFIX = 'M125 ';

const PDF = Buffer.from('%PDF-1.7 an external cardiology report');

interface Doctor {
  readonly token: string;
  readonly userId: string;
}

interface Attachment {
  id: string;
  name: string;
  kind: string;
  sizeKb: number;
  uploadedBy: string;
  uploadedAt: string;
}

interface RecordDetail {
  id: string;
  status: string;
  attachments: Attachment[];
  timeline: { kind: string; detail: string }[];
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let owner: Doctor;
let stranger: Doctor;
let patientId = '';
let recordId = '';
const createdCharts: string[] = [];

async function seedDoctor(local: string): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: user.id };
}

async function seedPatient(token: string): Promise<string> {
  const response = await request(harness.server).post(PATIENTS).set(as(token)).send({
    fullName: 'Nadia Fathy',
    dateOfBirth: '1979-02-03',
    gender: 'female',
    bloodType: 'B+',
    phone: '+20 100 555 2211',
    allergies: [],
    chronicConditions: [],
  });

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  const id = dataOf<{ id: string }>(response).id;
  createdCharts.push(id);

  return id;
}

async function createRecord(token: string, patient: string): Promise<string> {
  const response = await request(harness.server).post(RECORDS).set(as(token)).send({
    patientId: patient,
    visitDate: '2026-10-20T09:00:00.000Z',
    visitType: 'Consultation',
    priority: 'normal',
    chiefComplaint: 'Palpitations on exertion',
    historyOfPresentIllness: 'Two weeks, no syncope.',
    physicalExamination: 'Regular rhythm at rest.',
  });

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  return dataOf<{ id: string }>(response).id;
}

async function uploadFile(token: string, kind = 'record_attachment', name = 'echo.pdf') {
  const response = await request(harness.server)
    .post(FILES)
    .set(as(token))
    .field('kind', kind)
    .attach('file', PDF, { filename: `${NAME_PREFIX}${name}`, contentType: 'application/pdf' });

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  return dataOf<{ id: string }>(response).id;
}

function attach(token: string, record: string, body: object) {
  return request(harness.server).post(`${RECORDS}/${record}/attachments`).set(as(token)).send(body);
}

function download(token: string, record: string, attachmentId: string) {
  return request(harness.server)
    .get(`${RECORDS}/${record}/attachments/${attachmentId}/download`)
    .set(as(token));
}

async function detail(token: string, record: string): Promise<RecordDetail> {
  return dataOf<RecordDetail>(
    await request(harness.server).get(`${RECORDS}/${record}`).set(as(token)),
  );
}

/** What M30.2's scanner writes once an engine is bound. */
async function markScanned(fileId: string, result: 'clean' | 'infected'): Promise<void> {
  await harness.prisma.file.update({
    where: { id: fileId },
    data: { scannedAt: new Date(), scanResult: result },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('record-attachments-m125', {
    clinicalDoctors: true,
    overrides: [{ token: FILE_STORAGE, value: storage }],
  });

  owner = await seedDoctor('rec-att-owner');
  stranger = await seedDoctor('rec-att-stranger');
  patientId = await seedPatient(owner.token);
  recordId = await createRecord(owner.token, patientId);
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;

  // Records first: `record_attachments` cascades from the record and
  // restricts the file, so the files can go only after.
  if (createdCharts.length > 0) {
    await harness.prisma.medicalRecord.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await deletePatients(harness.prisma, { where: { publicId: { in: createdCharts } } });
  }
  await harness.prisma.file.deleteMany({ where: { originalName: { startsWith: NAME_PREFIX } } });

  await harness.reset();
  await harness.close();
});

describe('M12.5 — the round trip', () => {
  let attachmentId = '';
  let fileId = '';

  it('attaches an upload and shows it on the document, with a timeline event', async () => {
    fileId = await uploadFile(owner.token);

    const response = await attach(owner.token, recordId, { fileId, kind: 'external-report' });

    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const document = dataOf<RecordDetail>(response);
    const [attachment] = document.attachments;

    expect(document.attachments).toHaveLength(1);
    expect(attachment).toMatchObject({
      // Defaults to the name it was uploaded under.
      name: `${NAME_PREFIX}echo.pdf`,
      kind: 'external-report',
      sizeKb: 1,
    });
    attachmentId = attachment?.id ?? '';

    expect(document.timeline).toContainEqual(
      expect.objectContaining({ kind: 'attachment-added', detail: `${NAME_PREFIX}echo.pdf` }),
    );
  });

  it('holds the download at 403 scan_pending until the scan is clean', async () => {
    const pending = await download(owner.token, recordId, attachmentId);

    expect(pending.status).toBe(403);
    expect(errorBody(pending).code).toBe('scan_pending');
  });

  it('refuses an infected file with the same code and its own message', async () => {
    await markScanned(fileId, 'infected');

    const infected = await download(owner.token, recordId, attachmentId);

    expect(infected.status).toBe(403);
    expect(errorBody(infected).code).toBe('scan_pending');
    expect(errorBody(infected).message).toContain('rejected by the malware scan');
  });

  it('signs a short-lived URL for the stored object once clean, and audits it', async () => {
    await markScanned(fileId, 'clean');
    const storageKey = (
      await harness.prisma.file.findUniqueOrThrow({
        where: { id: fileId },
        select: { storageKey: true },
      })
    ).storageKey;

    const response = await download(owner.token, recordId, attachmentId);

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const link = dataOf<{ url: string; expiresInSeconds: number }>(response);
    // The object's key, not a database id — the M25.4 defect, guarded.
    expect(link.url).toContain(storageKey);
    expect(link.expiresInSeconds).toBe(60);

    const row = await harness.prisma.auditEvent.findFirst({
      where: { actorId: owner.userId, eventType: 'file.download', target: `file:${fileId}` },
    });
    expect(row?.payload).toMatchObject({ kind: 'record_attachment', recordId });
  });

  it('files the attach under medical_record with the id and kind, never the name', async () => {
    const row = await harness.prisma.auditEvent.findFirst({
      where: { actorId: owner.userId, eventType: 'medical_record.attachment_add' },
    });

    expect(row?.target).toBe(`medical_record:${recordId}`);
    expect(row?.payload).toMatchObject({ attachmentId, kind: 'external-report' });
    expect(JSON.stringify(row?.payload)).not.toContain('echo.pdf');
  });

  it('refuses to link the same upload twice', async () => {
    const again = await attach(owner.token, recordId, { fileId, kind: 'external-report' });

    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('attachment_already_linked');
    expect((await detail(owner.token, recordId)).attachments).toHaveLength(1);
  });

  it('gives a doctor outside the care relationship the 404 a missing record gets', async () => {
    const outside = await download(stranger.token, recordId, attachmentId);
    const missing = await download(stranger.token, 'MR-999999999', attachmentId);

    // Not 403 scan_pending, not 200: unreachable, and indistinguishable
    // from absent.
    expect(outside.status).toBe(404);
    expect(outside.body).toEqual(missing.body);
  });

  it('answers 404 for an attachment that is not on this record', async () => {
    const otherRecord = await createRecord(owner.token, patientId);

    expect((await download(owner.token, otherRecord, attachmentId)).status).toBe(404);
    expect((await download(owner.token, recordId, 'not-a-uuid')).status).toBe(404);
  });
});

describe('M12.5 — which uploads are linkable', () => {
  it('honours a name given at attach time', async () => {
    const fileId = await uploadFile(owner.token, 'record_attachment', 'scan-0042.pdf');

    const response = await attach(owner.token, recordId, {
      fileId,
      kind: 'referral',
      name: 'Referral to cardiology',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(dataOf<RecordDetail>(response).attachments.map((a) => a.name)).toContain(
      'Referral to cardiology',
    );
  });

  it.each([
    ['another account’s upload', async () => uploadFile(stranger.token)],
    ['an upload of another kind', async () => uploadFile(owner.token, 'patient_document')],
    ['an id that was never issued', () => Promise.resolve('7b0a3c52-0000-4000-8000-000000000000')],
    [
      'a deleted upload',
      async () => {
        const id = await uploadFile(owner.token);
        await request(harness.server).delete(`${FILES}/${id}`).set(as(owner.token)).expect(204);
        return id;
      },
    ],
  ])('refuses %s with the same 422, and attaches nothing', async (_label, fileIdOf) => {
    const before = (await detail(owner.token, recordId)).attachments.length;

    const response = await attach(owner.token, recordId, {
      fileId: await fileIdOf(),
      kind: 'imaging',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(errorBody(response).fieldErrors?.['fileId']).toBeDefined();
    expect((await detail(owner.token, recordId)).attachments).toHaveLength(before);
  });

  it('refuses a kind outside the contract’s five', async () => {
    const fileId = await uploadFile(owner.token);

    const response = await attach(owner.token, recordId, { fileId, kind: 'selfie' });

    expect(response.status).toBe(422);
  });

  it('refuses a doctor attaching to a record outside their care, as a 404', async () => {
    const fileId = await uploadFile(stranger.token);

    const response = await attach(stranger.token, recordId, { fileId, kind: 'imaging' });

    expect(response.status).toBe(404);
  });

  it('refuses an attachment on a completed record — it is as frozen as the text', async () => {
    const record = await createRecord(owner.token, patientId);
    for (const status of ['active', 'completed']) {
      await request(harness.server)
        .post(`${RECORDS}/${record}/status`)
        .set(as(owner.token))
        .send({ status })
        .expect(200);
    }

    const fileId = await uploadFile(owner.token);
    const response = await attach(owner.token, record, { fileId, kind: 'consent' });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('record_not_editable');
    expect((await detail(owner.token, record)).attachments).toHaveLength(0);
  });
});
