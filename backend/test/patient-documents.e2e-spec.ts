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
 * Patient documents — API §4.7, the Documents tab's write and read paths.
 *
 * The round trip is upload (`POST /files`, kind `patient_document`) →
 * link (`POST /patients/{id}/documents`) → the document in the tab →
 * download (`GET /patients/{id}/documents/{documentId}/download`) behind
 * the M25.3 scan gate. Every step runs over HTTP against Postgres; only
 * the object store is the in-memory double the other file suites use.
 *
 * The refusals carry the weight: care scope is checked **before** the
 * scan gate, so `403 scan_pending` is not an existence oracle; an upload
 * is filed once; and a document id from one chart is absent on another.
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
const FILES = '/api/v1/files';
const PASSWORD = 'Medora123!';
/** Every upload this suite makes, so teardown removes exactly those. */
const NAME_PREFIX = 'D04 ';

const PDF = Buffer.from('%PDF-1.7 a signed consent form');

interface Doctor {
  readonly token: string;
  readonly userId: string;
}

interface DocumentView {
  id: string;
  name: string;
  category: string;
  sizeKb: number;
  uploadedAt: string;
  uploadedBy: string | null;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let owner: Doctor;
let stranger: Doctor;
let patientId = '';
let otherPatientId = '';
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

async function seedPatient(token: string, fullName: string): Promise<string> {
  const response = await request(harness.server).post(PATIENTS).set(as(token)).send({
    fullName,
    dateOfBirth: '1984-06-11',
    gender: 'female',
    bloodType: 'O+',
    phone: '+20 100 555 3311',
    allergies: [],
    chronicConditions: [],
  });

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  const id = dataOf<{ id: string }>(response).id;
  createdCharts.push(id);

  return id;
}

async function uploadFile(token: string, kind = 'patient_document', name = 'consent.pdf') {
  const response = await request(harness.server)
    .post(FILES)
    .set(as(token))
    .field('kind', kind)
    .attach('file', PDF, { filename: `${NAME_PREFIX}${name}`, contentType: 'application/pdf' });

  expect(response.status, JSON.stringify(response.body)).toBe(201);

  return dataOf<{ id: string }>(response).id;
}

function link(token: string, patient: string, body: object) {
  return request(harness.server).post(`${PATIENTS}/${patient}/documents`).set(as(token)).send(body);
}

function download(token: string, patient: string, documentId: string) {
  return request(harness.server)
    .get(`${PATIENTS}/${patient}/documents/${documentId}/download`)
    .set(as(token));
}

async function documents(token: string, patient: string): Promise<DocumentView[]> {
  return dataOf<{ items: DocumentView[] }>(
    await request(harness.server).get(`${PATIENTS}/${patient}/documents`).set(as(token)),
  ).items;
}

/** What M30.2's scanner writes once an engine is bound. */
async function markScanned(fileId: string, result: 'clean' | 'infected'): Promise<void> {
  await harness.prisma.file.update({
    where: { id: fileId },
    data: { scannedAt: new Date(), scanResult: result },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-documents-d04', {
    clinicalDoctors: true,
    overrides: [{ token: FILE_STORAGE, value: storage }],
  });

  owner = await seedDoctor('pt-doc-owner');
  stranger = await seedDoctor('pt-doc-stranger');
  patientId = await seedPatient(owner.token, 'Salma Adel');
  otherPatientId = await seedPatient(owner.token, 'Hoda Kamal');
}, 90_000);

afterAll(async () => {
  if (harness === undefined) return;

  // Charts first: `patient_documents` cascades from the patient and
  // restricts the file, so the files can go only after.
  if (createdCharts.length > 0) {
    await deletePatients(harness.prisma, { where: { publicId: { in: createdCharts } } });
  }
  await harness.prisma.file.deleteMany({ where: { originalName: { startsWith: NAME_PREFIX } } });

  await harness.reset();
  await harness.close();
});

describe('§4.7 — the round trip', () => {
  let documentId = '';
  let fileId = '';

  it('links an upload and shows it in the Documents tab', async () => {
    fileId = await uploadFile(owner.token);

    const response = await link(owner.token, patientId, { fileId, category: 'consent' });

    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const created = dataOf<DocumentView>(response);
    expect(created).toMatchObject({
      name: `${NAME_PREFIX}consent.pdf`,
      category: 'consent',
      sizeKb: 1,
    });
    expect(created.uploadedBy).not.toBeNull();
    documentId = created.id;

    expect((await documents(owner.token, patientId)).map((d) => d.id)).toContain(documentId);
  });

  it('files the link under the patient with the id and category, never the name', async () => {
    const row = await harness.prisma.auditEvent.findFirst({
      where: { actorId: owner.userId, eventType: 'patient.document_add' },
    });

    expect(row?.target).toBe(`patient:${patientId}`);
    expect(row?.payload).toMatchObject({ documentId, category: 'consent' });
    expect(JSON.stringify(row?.payload)).not.toContain('consent.pdf');
  });

  it('refuses a doctor outside the care relationship with a 404 before the scan gate', async () => {
    // The file is still unscanned: the owner would get 403 scan_pending.
    const pending = await download(owner.token, patientId, documentId);
    expect(pending.status).toBe(403);
    expect(errorBody(pending).code).toBe('scan_pending');

    const outside = await download(stranger.token, patientId, documentId);
    const missing = await download(stranger.token, 'PT-DOES-NOT-EXIST', documentId);

    // Not 403 scan_pending: unreachable, and indistinguishable from absent.
    expect(outside.status).toBe(404);
    expect(outside.body).toEqual(missing.body);
  });

  it('refuses an infected file with the same code and its own message', async () => {
    await markScanned(fileId, 'infected');

    const infected = await download(owner.token, patientId, documentId);

    expect(infected.status).toBe(403);
    expect(errorBody(infected).code).toBe('scan_pending');
    expect(errorBody(infected).message).toContain('rejected by the malware scan');
  });

  it('signs a short-lived URL for the stored object once clean, and audits it', async () => {
    await markScanned(fileId, 'clean');
    const { storageKey } = await harness.prisma.file.findUniqueOrThrow({
      where: { id: fileId },
      select: { storageKey: true },
    });

    const response = await download(owner.token, patientId, documentId);

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const signed = dataOf<{ url: string; expiresInSeconds: number }>(response);
    expect(signed.url).toContain(storageKey);
    expect(signed.expiresInSeconds).toBe(60);

    const row = await harness.prisma.auditEvent.findFirst({
      where: { actorId: owner.userId, eventType: 'file.download', target: `file:${fileId}` },
    });
    expect(row?.payload).toMatchObject({ kind: 'patient_document', patientId, documentId });
    // The patient handle and ids only — never the filename, never a URL.
    expect(JSON.stringify(row?.payload)).not.toContain('consent.pdf');
    expect(JSON.stringify(row?.payload)).not.toContain('objects.test');
  });

  it('still refuses the out-of-scope doctor once the file is clean, and audits no download', async () => {
    expect((await download(stranger.token, patientId, documentId)).status).toBe(404);

    // Every refusal throws before the signing step, so nothing reached the
    // ledger as a download that did not happen.
    expect(
      await harness.prisma.auditEvent.count({
        where: { actorId: stranger.userId, eventType: 'file.download' },
      }),
    ).toBe(0);
  });

  it('refuses to link the same upload twice, on this chart or another', async () => {
    const again = await link(owner.token, patientId, { fileId, category: 'consent' });
    const elsewhere = await link(owner.token, otherPatientId, { fileId, category: 'report' });

    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('document_already_linked');
    expect(elsewhere.status).toBe(409);
    expect(errorBody(elsewhere).code).toBe('document_already_linked');
    expect(await documents(owner.token, patientId)).toHaveLength(1);
    expect(await documents(owner.token, otherPatientId)).toHaveLength(0);
  });

  it('answers 404 for a document id under a patient it does not belong to', async () => {
    // The caller reaches both charts; the document is simply not on this one.
    const foreign = await download(owner.token, otherPatientId, documentId);

    // The same body a document id that was never issued gets: the answer
    // does not say the id exists on some other chart.
    const neverIssued = await download(
      owner.token,
      otherPatientId,
      '7b0a3c52-0000-4000-8000-000000000000',
    );

    expect(foreign.status).toBe(404);
    expect(errorBody(foreign).code).not.toBe('scan_pending');
    expect(foreign.body).toEqual(neverIssued.body);
    expect((await download(owner.token, patientId, 'not-a-uuid')).status).toBe(404);
  });
});

describe('§4.7 — concurrent links', () => {
  it('files one upload exactly once when several charts race for it', async () => {
    const fileId = await uploadFile(owner.token, 'patient_document', 'race.pdf');
    // Alternating between two charts, so a lost race would file the one
    // upload under two patients — the disclosure the lock exists to stop.
    const charts = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? patientId : otherPatientId));

    // Fired together, so requests overlap between reading "not yet linked"
    // and inserting. Only the `FOR UPDATE` on `files` makes each later one
    // see the first's row. A race is likely, not guaranteed, so with the
    // lock removed this fails often rather than always; with it, never.
    const responses = await Promise.all(
      charts.map((chart) => link(owner.token, chart, { fileId, category: 'report' })),
    );
    const statuses = responses.map((response) => response.status);

    expect(
      statuses.filter((status) => status === 201),
      JSON.stringify(responses.map((r) => r.body as unknown)),
    ).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(charts.length - 1);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(errorBody(response).code).toBe('document_already_linked');
    }
    expect(await harness.prisma.patientDocument.count({ where: { fileId } })).toBe(1);
  });
});

describe('§4.7 — which uploads are linkable', () => {
  it.each([
    ['another account’s upload', async () => uploadFile(stranger.token)],
    ['an upload of another kind', async () => uploadFile(owner.token, 'record_attachment')],
    ['an id that was never issued', () => Promise.resolve('7b0a3c52-0000-4000-8000-000000000000')],
    [
      'a deleted upload',
      async () => {
        const id = await uploadFile(owner.token);
        await request(harness.server).delete(`${FILES}/${id}`).set(as(owner.token)).expect(204);
        return id;
      },
    ],
  ])('refuses %s with the same 422, and links nothing', async (_label, fileIdOf) => {
    const before = (await documents(owner.token, patientId)).length;

    const response = await link(owner.token, patientId, {
      fileId: await fileIdOf(),
      category: 'report',
    });

    expect(response.status, JSON.stringify(response.body)).toBe(422);
    expect(errorBody(response).fieldErrors?.['fileId']).toBeDefined();
    expect(await documents(owner.token, patientId)).toHaveLength(before);
  });

  it('refuses a category outside the DocumentCategory enum', async () => {
    const fileId = await uploadFile(owner.token);

    const response = await link(owner.token, patientId, { fileId, category: 'selfie' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['category']).toBeDefined();
  });

  it('refuses a doctor linking to a chart outside their care, as a 404', async () => {
    const fileId = await uploadFile(stranger.token);

    const response = await link(stranger.token, patientId, { fileId, category: 'referral' });

    expect(response.status).toBe(404);
    expect(await harness.prisma.patientDocument.count({ where: { fileId } })).toBe(0);
  });
});
