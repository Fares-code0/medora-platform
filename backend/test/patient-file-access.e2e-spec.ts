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
  fixtureHospital,
  makeClinicalStaff,
  markVerified,
  patientRegistrationBody,
  recordPatientAt,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { destroyLabFixtures, orderTest, seedDoctor, seedPatient } from './support/lab-fixture';

/**
 * R-02 (PR-68 audit) — a patient never reads a clinical file.
 *
 * The approved owner decision: a patient must never reach lab results,
 * medical documents, clinical attachments or record content, and ADR-031
 * (results release) is open. The three file kinds that carry that content
 * are `patient_document`, `record_attachment` and `lab_attachment`.
 *
 * Every file here is created the way the application creates it — the
 * document through `POST /files` + `POST /patients/{id}/documents`, the
 * record attachment through `POST /files` + `POST /medical-records/{id}/
 * attachments`, the lab attachment through `POST /lab-orders/{id}/
 * attachments` — and marked clean, so a refusal is the access rule and
 * never the scan gate. Only the patient link is written directly (ADR-048
 * links through staff in production; `patient-lab-notifications` does the
 * same).
 *
 * The database layer (`app_rls.file_of_current_patient`) still admits these
 * rows to the linked patient; that redefinition awaits approval
 * (docs/audits/PR-68-R02-PATIENT-FILE-ACCESS-DESIGN.md). What is proved here
 * is the application gate every patient-reachable route passes through.
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
const FILES = '/api/v1/files';
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';
const LAB_ORDERS = '/api/v1/lab-orders';
const PASSWORD = 'Medora123!';
/** Every name this suite stores under, so teardown removes exactly those. */
const NAME_PREFIX = 'R02 ';

const PDF = Buffer.from('%PDF-1.7 a clinical document');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('a portrait'),
]);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

type ClinicalKind = 'patient_document' | 'record_attachment' | 'lab_attachment';
const CLINICAL_KINDS: readonly ClinicalKind[] = [
  'patient_document',
  'record_attachment',
  'lab_attachment',
];

/** One chart's clinical files, with the handles the domain routes use. */
interface ChartFiles {
  readonly patientId: string;
  readonly fileIds: Record<ClinicalKind, string>;
  readonly documentId: string;
  readonly recordId: string;
  readonly recordAttachmentId: string;
  readonly labOrderId: string;
}

let doctorToken = '';
let otherHospitalDoctorToken = '';
let receptionToken = '';
let patientToken = '';
let patientUserId = '';

let own: ChartFiles;
let theirs: ChartFiles;
const charts: string[] = [];

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

function upload(token: string, kind: string, name: string, type = 'application/pdf', body = PDF) {
  return request(harness.server)
    .post(FILES)
    .set(as(token))
    .field('kind', kind)
    .attach('file', body, { filename: `${NAME_PREFIX}${name}`, contentType: type });
}

async function uploadId(token: string, kind: string, name: string): Promise<string> {
  const response = await upload(token, kind, name);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return dataOf<{ id: string }>(response).id;
}

/** What M30.2's scanner writes once an engine is bound. */
async function markClean(fileId: string): Promise<void> {
  await harness.prisma.file.update({
    where: { id: fileId },
    data: { scannedAt: new Date(), scanResult: 'clean' },
  });
}

/** A chart at hospital A carrying one file of each clinical kind. */
async function chartWithClinicalFiles(fullName: string): Promise<ChartFiles> {
  const patient = await seedPatient(harness, doctorToken, { fullName });
  charts.push(patient.id);

  // patient_document — uploaded and filed under the Documents tab.
  const documentFile = await uploadId(doctorToken, 'patient_document', 'referral.pdf');
  const linked = await request(harness.server)
    .post(`${PATIENTS}/${patient.id}/documents`)
    .set(as(doctorToken))
    .send({ fileId: documentFile, category: 'referral' });
  expect(linked.status, JSON.stringify(linked.body)).toBe(201);
  const documentId = dataOf<{ id: string }>(linked).id;

  // record_attachment — the doctor's upload attached to an encounter.
  const created = await request(harness.server)
    .post(RECORDS)
    .set(as(doctorToken))
    .send({
      patientId: patient.id,
      visitDate: '2026-10-20T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Palpitations on exertion',
      historyOfPresentIllness: 'Two weeks, no syncope.',
      physicalExamination: 'Regular rhythm at rest.',
    });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const recordId = dataOf<{ id: string }>(created).id;
  const recordFile = await uploadId(doctorToken, 'record_attachment', 'echo.pdf');
  const attached = await request(harness.server)
    .post(`${RECORDS}/${recordId}/attachments`)
    .set(as(doctorToken))
    .send({ fileId: recordFile, kind: 'external-report' });
  expect(attached.status, JSON.stringify(attached.body)).toBe(201);
  const recordAttachmentId =
    dataOf<{ attachments: { id: string }[] }>(attached).attachments[0]?.id ?? '';

  // lab_attachment — the report uploaded on the order, which mints its own file.
  const order = await orderTest(harness, doctorToken, patient.id);
  const report = await request(harness.server)
    .post(`${LAB_ORDERS}/${order.id}/attachments`)
    .set(as(doctorToken))
    .send({
      name: `${NAME_PREFIX}Basic Metabolic Panel.pdf`,
      kind: 'report',
      mimeType: 'application/pdf',
      content: PDF.toString('base64'),
    });
  expect(report.status, JSON.stringify(report.body)).toBe(201);
  const labFile = (
    await harness.prisma.labAttachment.findFirstOrThrow({
      where: { order: { publicId: order.id } },
      select: { fileId: true },
    })
  ).fileId;

  for (const id of [documentFile, recordFile, labFile]) await markClean(id);

  return {
    patientId: patient.id,
    fileIds: {
      patient_document: documentFile,
      record_attachment: recordFile,
      lab_attachment: labFile,
    },
    documentId,
    recordId,
    recordAttachmentId,
    labOrderId: order.id,
  };
}

function readFile(token: string, fileId: string) {
  return request(harness.server).get(`${FILES}/${fileId}`).set(as(token));
}

function downloadFile(token: string, fileId: string) {
  return request(harness.server).get(`${FILES}/${fileId}/download`).set(as(token));
}

/** `staff_members` outlive their user (SET NULL) and hold the unique email. */
async function removeStaffProfiles(): Promise<void> {
  const staff = { email: { endsWith: `@${harness.domain}` } };
  await harness.prisma.hospitalStaffAffiliation.deleteMany({ where: { staff: { is: staff } } });
  await harness.prisma.staffMember.deleteMany({ where: staff });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-file-access', {
    overrides: [{ token: FILE_STORAGE, value: storage }],
  });
  await removeStaffProfiles();

  doctorToken = await seedDoctor(harness, 'r02-doctor');
  otherHospitalDoctorToken = await seedDoctor(harness, 'r02-other-doctor', 'b');

  // Reception at hospital A, the way the role matrix suite seeds staff.
  const receptionEmail = testEmail('r02-reception');
  await request(harness.server).post(REGISTER).send(registrationBody({ email: receptionEmail }));
  await markVerified(harness.prisma, receptionEmail);
  const reception = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'reception' } });
  await harness.prisma.user.update({
    where: { email: receptionEmail },
    data: { roleId: reception.id },
  });
  await makeClinicalStaff(harness.prisma, receptionEmail);
  receptionToken = await login(receptionEmail);

  const patientEmail = testEmail('r02-patient');
  await request(harness.server)
    .post(REGISTER)
    .send(patientRegistrationBody({ email: patientEmail }))
    .expect(201);
  await markVerified(harness.prisma, patientEmail);
  patientUserId = (
    await harness.prisma.user.findUniqueOrThrow({
      where: { email: patientEmail },
      select: { id: true },
    })
  ).id;

  own = await chartWithClinicalFiles('Layla Morsi');
  theirs = await chartWithClinicalFiles('Omar Farouk');

  // Test-only link (ADR-048 links through staff in production).
  await harness.prisma.patient.update({
    where: { publicId: own.patientId },
    data: { userId: patientUserId },
  });
  patientToken = await login(patientEmail);
}, 180_000);

afterAll(async () => {
  if (harness === undefined) return;

  // `patient_documents` restrict their file; remove them before the files.
  const patients = await harness.prisma.patient.findMany({
    where: { publicId: { in: charts } },
    select: { id: true },
  });
  await harness.prisma.patientDocument.deleteMany({
    where: { patientId: { in: patients.map((row) => row.id) } },
  });
  await destroyLabFixtures(harness, charts);
  await harness.prisma.file.deleteMany({ where: { originalName: { startsWith: NAME_PREFIX } } });
  await removeStaffProfiles();

  await harness.reset();
  await harness.close();
});

describe('R-02 — a linked patient cannot read their own chart’s clinical files', () => {
  it('the link is live: the patient sees their own lab order on /me/lab-orders', async () => {
    // Guards the premise. Without a working link every refusal below would
    // be the unlinked-account answer, not the R-02 rule.
    const response = await request(harness.server).get('/api/v1/me/lab-orders').set(as(patientToken));
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain(own.labOrderId);
    expect(JSON.stringify(response.body)).not.toContain(theirs.labOrderId);
  });

  it.each(CLINICAL_KINDS)('%s: metadata and signed URL are both 404', async (kind) => {
    const fileId = own.fileIds[kind];

    const detail = await readFile(patientToken, fileId);
    expect(detail.status, JSON.stringify(detail.body)).toBe(404);

    const download = await downloadFile(patientToken, fileId);
    expect(download.status, JSON.stringify(download.body)).toBe(404);
    // The refusal is the generic one: no URL, no kind, no name.
    expect(JSON.stringify(download.body)).not.toContain('objects.test');
  });

  it('the refusal is indistinguishable from an id that does not exist', async () => {
    const real = await downloadFile(patientToken, own.fileIds.lab_attachment);
    const absent = await downloadFile(patientToken, '00000000-0000-4000-8000-000000000000');

    expect(real.status).toBe(absent.status);
    expect((real.body as { error?: unknown }).error).toEqual(
      (absent.body as { error?: unknown }).error,
    );
  });
});

describe('R-02 — nor another patient’s', () => {
  it.each(CLINICAL_KINDS)('%s of an unlinked chart: 404', async (kind) => {
    const fileId = theirs.fileIds[kind];

    expect((await readFile(patientToken, fileId)).status).toBe(404);
    expect((await downloadFile(patientToken, fileId)).status).toBe(404);
  });
});

describe('R-02 — the uploader shortcut does not reopen a clinical kind to a patient', () => {
  it.each(CLINICAL_KINDS)(
    '%s uploaded by the patient themselves: accepted, then unreadable',
    async (kind) => {
      // `POST /files` is not role-gated per kind, so a patient can mint a
      // clinical-kind row. Reading it back through "the uploader, always"
      // would be a second road to the kind; it is closed.
      const fileId = await uploadId(patientToken, kind, `self-${kind}.pdf`);
      await markClean(fileId);

      expect((await readFile(patientToken, fileId)).status).toBe(404);
      expect((await downloadFile(patientToken, fileId)).status).toBe(404);
    },
  );

  it('leaves a non-clinical kind the patient uploaded readable (profile photo)', async () => {
    const response = await upload(patientToken, 'profile_photo', 'portrait.png', 'image/png', PNG);
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    expect((await readFile(patientToken, dataOf<{ id: string }>(response).id)).status).toBe(200);
  });
});

describe('R-02 — no alternate route hands a patient the file', () => {
  it('the domain download routes refuse the patient role', async () => {
    const routes = [
      `${PATIENTS}/${own.patientId}/documents/${own.documentId}/download`,
      `${PATIENTS}/${own.patientId}/documents`,
      `${RECORDS}/${own.recordId}`,
      `${RECORDS}/${own.recordId}/attachments/${own.recordAttachmentId}/download`,
      `${LAB_ORDERS}/${own.labOrderId}`,
      `/api/v1/attachments/${own.fileIds.patient_document}/download`,
    ];

    for (const path of routes) {
      const response = await request(harness.server).get(path).set(as(patientToken));
      expect([403, 404], `${path} → ${String(response.status)}`).toContain(response.status);
      expect(JSON.stringify(response.body), path).not.toContain('objects.test');
    }
  });

  it('no patient-facing read carries a clinical file id', async () => {
    const ids = Object.values(own.fileIds);

    for (const path of ['/api/v1/me/lab-orders', '/api/v1/me/profile', '/api/v1/me/patient-link']) {
      const response = await request(harness.server).get(path).set(as(patientToken));
      expect(response.status, `${path} ${JSON.stringify(response.body)}`).toBe(200);
      const body = JSON.stringify(response.body);
      for (const id of ids) expect(body, `${path} leaks ${id}`).not.toContain(id);
    }
  });
});

describe('R-02 — clinicians and staff keep their access', () => {
  it.each(CLINICAL_KINDS)('%s: the treating doctor reads and downloads it', async (kind) => {
    const fileId = own.fileIds[kind];

    expect((await readFile(doctorToken, fileId)).status).toBe(200);
    const download = await downloadFile(doctorToken, fileId);
    expect(download.status, JSON.stringify(download.body)).toBe(200);
    expect(dataOf<{ url: string }>(download).url).toContain('objects.test');
  });

  it('the treating doctor still downloads the document through the chart', async () => {
    const response = await request(harness.server)
      .get(`${PATIENTS}/${own.patientId}/documents/${own.documentId}/download`)
      .set(as(doctorToken));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(dataOf<{ url: string }>(response).url).toContain('objects.test');
  });

  it.each(CLINICAL_KINDS.filter((kind) => kind !== 'lab_attachment'))(
    '%s: staff keep the uploader rule (reception reads its own upload)',
    async (kind) => {
      // Only a doctor holds a care relationship (PatientScopeService), so a
      // staff member's /files access to a clinical kind is the uploader rule.
      // R-02 narrows the patient role only; this is unchanged.
      const fileId = await uploadId(receptionToken, kind, `staff-${kind}.pdf`);
      await markClean(fileId);

      expect((await readFile(receptionToken, fileId)).status).toBe(200);
      expect((await downloadFile(receptionToken, fileId)).status).toBe(200);
    },
  );

  it('the treating doctor still downloads the record attachment through the record', async () => {
    const response = await request(harness.server)
      .get(`${RECORDS}/${own.recordId}/attachments/${own.recordAttachmentId}/download`)
      .set(as(doctorToken));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  });
});

describe('R-02 — hospital isolation is unchanged', () => {
  it.each(CLINICAL_KINDS)(
    '%s: a doctor at another hospital is refused, even reaching the patient there',
    async (kind) => {
      // The patient now has a record at hospital B too, so the other doctor
      // reaches them — and still cannot open hospital A's file (DR-05).
      const patient = await harness.prisma.patient.findUniqueOrThrow({
        where: { publicId: own.patientId },
        select: { id: true },
      });
      await recordPatientAt(harness.prisma, patient.id, await fixtureHospital(harness.prisma, 'b'));

      const fileId = own.fileIds[kind];
      expect((await readFile(otherHospitalDoctorToken, fileId)).status).toBe(404);
      expect((await downloadFile(otherHospitalDoctorToken, fileId)).status).toBe(404);
    },
  );
});
