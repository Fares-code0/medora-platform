import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PatientRepository } from '../src/modules/patients/repositories/patient.repository';
import { EXPORT_ROW_LIMIT } from '../src/common/http/csv-export';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { destroyLabFixtures, orderTest } from './support/lab-fixture';

/**
 * Clinical list exports — API §4.10, §6.10, §7.10, §8.11.
 *
 * Each export is asserted against the list it is taken from, because
 * "respecting current filters" and "the same scope as the screen" are the
 * two properties a bulk export of PHI must not get wrong:
 *
 *  - **scope** — a second doctor's export never carries the first
 *    doctor's patient, and an administrator's patient export is the
 *    masked directory, searched for the clear name rather than trusted
 *    by shape;
 *  - **filters** — a filter the list honours narrows the file;
 *  - **audit** — one `*.export` row per file, `warning`, carrying the row
 *    count and the filter *names* and never a search term;
 *  - **file hygiene** — `text/csv`, an attachment, `Cache-Control:
 *    no-store`, and formula-leading text neutralised.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';
const PRESCRIPTIONS = '/api/v1/prescriptions';
const LAB_ORDERS = '/api/v1/lab-orders';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

let doctorToken = '';
let doctorUserId = '';
let strangerToken = '';
let adminToken = '';
let adminUserId = '';

/** Charts this suite created, removed by id (see `patients-clinical`'s note). */
const createdCharts: string[] = [];

let ownPatient = { id: '', fullName: '', mrn: '' };
let formulaPatient = { id: '', fullName: '', mrn: '' };
let strangerPatient = { id: '', fullName: '', mrn: '' };
let recordId = '';
let prescriptionId = '';
let labOrderId = '';

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function userIdOf(email: string): Promise<string> {
  return (await harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } }))
    .id;
}

async function seedDoctor(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  return { token, userId: await userIdOf(email) };
}

/** A real administrator: enrolled TOTP, admin role, and no `doctors` row. */
async function seedAdmin(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

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
  await harness.prisma.doctor.deleteMany({ where: { user: { email } } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  return { token: dataOf<SessionPayload>(verified).accessToken, userId: await userIdOf(email) };
}

async function createPatient(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; fullName: string; mrn: string }> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Layla Morsi',
      dateOfBirth: '1988-04-12',
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 100 777 1234',
      allergies: [],
      chronicConditions: [],
      ...overrides,
    });

  expect(response.status).toBe(201);
  const created = dataOf<{ id: string; fullName: string; mrn: string }>(response);
  createdCharts.push(created.id);

  return created;
}

function getFile(token: string, path: string, query: Record<string, string> = {}) {
  return request(harness.server)
    .get(path)
    .query(query)
    .set('Authorization', `Bearer ${token}`)
    .buffer(true)
    .parse((res, done) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (text += chunk));
      res.on('end', () => done(null, text));
    });
}

/** A minimal RFC 4180 reader — enough to read back what the server wrote. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' && text[index + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
    } else {
      field += char;
    }
  }

  return rows;
}

/** Header-keyed rows. */
function recordsOf(text: string): Record<string, string>[] {
  const [header = [], ...rows] = parseCsv(text);

  return rows.map((row) =>
    Object.fromEntries(header.map((name, index) => [name, row[index] ?? ''])),
  );
}

function exportRowsBy(actorId: string, eventType: string) {
  return harness.prisma.auditEvent.findMany({
    where: { actorId, eventType },
    orderBy: { occurredAt: 'desc' },
  });
}

function expectCsvFile(response: { status: number; headers: Record<string, string> }): void {
  expect(response.status).toBe(200);
  expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
  expect(response.headers['content-disposition']).toMatch(
    /^attachment; filename="[a-z0-9-]+\.csv"$/,
  );
  expect(response.headers['cache-control']).toBe('no-store');
}

beforeAll(async () => {
  harness = await createAuthHarness('clinical-exports');

  ({ token: doctorToken, userId: doctorUserId } = await seedDoctor('export-doctor'));
  ({ token: strangerToken } = await seedDoctor('export-stranger'));
  ({ token: adminToken, userId: adminUserId } = await seedAdmin('export-admin'));

  ownPatient = await createPatient(doctorToken, {
    fullName: 'Nadia Export',
    allergies: [{ allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' }],
  });
  formulaPatient = await createPatient(doctorToken, { fullName: '=HYPERLINK("http://x","y")' });
  strangerPatient = await createPatient(strangerToken, { fullName: 'Omar Stranger' });

  // A high-risk flag on one chart, so a filter has something to narrow.
  const flagged = await request(harness.server)
    .patch(`${PATIENTS}/${ownPatient.id}`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ riskLevel: 'high' });
  expect(flagged.status).toBe(200);

  const record = await request(harness.server)
    .post(RECORDS)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({
      patientId: ownPatient.id,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Persistent headache, two weeks',
      historyOfPresentIllness: 'Gradual onset, worse in the mornings.',
      physicalExamination: 'Alert and oriented. No focal deficit.',
    });
  expect(record.status).toBe(201);
  recordId = dataOf<{ id: string }>(record).id;

  const signed = await request(harness.server)
    .post(`${RECORDS}/${recordId}/notes`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ title: 'Assessment', body: 'Tension-type headache likely.' });
  expect(signed.status).toBe(201);
  const signedNoteId =
    dataOf<{ notes: { id: string; title: string }[] }>(signed).notes.find(
      (note) => note.title === 'Assessment',
    )?.id ?? '';
  expect(
    (
      await request(harness.server)
        .post(`${RECORDS}/${recordId}/notes/${signedNoteId}/sign`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({})
    ).status,
  ).toBe(200);

  const draftNote = await request(harness.server)
    .post(`${RECORDS}/${recordId}/notes`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ title: 'Working thoughts', body: 'UNSIGNED-DRAFT-TEXT' });
  expect(draftNote.status).toBe(201);

  const amoxil = await harness.prisma.medication.findFirstOrThrow({
    where: { name: 'Amoxil' },
    select: { id: true },
  });
  const draft = await request(harness.server)
    .post(PRESCRIPTIONS)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({
      patientId: formulaPatient.id,
      medicationId: amoxil.id,
      strength: '500 mg',
      dosage: '1 capsule',
      frequency: 'Three times daily',
      durationDays: 7,
      quantity: 21,
      refillsAllowed: 0,
      instructions: 'Take with food.',
      startDate: '2026-09-14T00:00:00.000Z',
    });
  expect(draft.status).toBe(201);
  prescriptionId = dataOf<{ id: string }>(draft).id;
  expect(
    (
      await request(harness.server)
        .post(`${PRESCRIPTIONS}/${prescriptionId}/sign`)
        .set('Authorization', `Bearer ${doctorToken}`)
        .send({})
    ).status,
  ).toBe(200);

  labOrderId = (await orderTest(harness, doctorToken, ownPatient.id)).id;
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    const owned = { patient: { publicId: { in: createdCharts } } };
    await harness.prisma.patientMedication.deleteMany({ where: owned });
    await harness.prisma.prescription.deleteMany({ where: owned });
    await destroyLabFixtures(harness, createdCharts);
  }

  await harness.reset();
  await harness.close();
});

describe('GET /patients/export (§4.10)', () => {
  it('serves the doctor’s own list as a CSV attachment that no cache stores', async () => {
    const response = await getFile(doctorToken, `${PATIENTS}/export`);

    expectCsvFile(response);
    const rows = recordsOf(response.body as string);
    const ids = rows.map((row) => row['patientId']);

    expect(ids).toEqual(expect.arrayContaining([ownPatient.id, formulaPatient.id]));
    expect(ids).not.toContain(strangerPatient.id);

    const own = rows.find((row) => row['patientId'] === ownPatient.id);
    expect(own?.['fullName']).toBe('Nadia Export');
    expect(own?.['mrn']).toBe(ownPatient.mrn);
    expect(own?.['hasSevereAllergy']).toBe('true');
    expect(own?.['allergies']).toBe('Penicillin (severe)');
  });

  it('carries exactly the rows the list shows for the same filters', async () => {
    const list = await request(harness.server)
      .get(PATIENTS)
      .query({ riskLevel: 'high', pageSize: '100' })
      .set('Authorization', `Bearer ${doctorToken}`);
    const listed = dataOf<{ items: { id: string }[] }>(list).items.map((item) => item.id);

    const file = await getFile(doctorToken, `${PATIENTS}/export`, { riskLevel: 'high' });
    const exported = recordsOf(file.body as string).map((row) => row['patientId']);

    expect(exported).toEqual(listed);
    expect(exported).toContain(ownPatient.id);
    expect(exported).not.toContain(formulaPatient.id);
  });

  it('neutralises a formula-leading name so a spreadsheet reads it as text', async () => {
    const response = await getFile(doctorToken, `${PATIENTS}/export`, { q: 'HYPERLINK' });
    const [row] = recordsOf(response.body as string);

    expect(row?.['fullName']).toBe(`'${formulaPatient.fullName}`);
  });

  it('gives an administrator the masked directory and never a clear identifier', async () => {
    const response = await getFile(adminToken, `${PATIENTS}/export`);

    expectCsvFile(response);
    const body = response.body as string;
    const [header] = parseCsv(body);

    expect(header).toEqual(['patientId', 'name', 'mrn', 'email', 'phone', 'dateOfBirth']);
    expect(body).toContain(ownPatient.id);
    expect(body).not.toContain('Nadia Export');
    expect(body).not.toContain(ownPatient.mrn);
  });

  it('audits one warning row with the count and the filter names, never the search term', async () => {
    await getFile(doctorToken, `${PATIENTS}/export`, { q: 'Nadia', riskLevel: 'high' });

    const [row] = await exportRowsBy(doctorUserId, 'patient.export');

    expect(row?.severity).toBe('WARNING');
    expect(row?.category).toBe('USER_ACTION');
    const payload = JSON.stringify(row?.payload);
    expect(payload).toContain('"rowCount":1');
    expect(payload).toContain('"filters":"q,riskLevel"');
    expect(payload).not.toContain('Nadia');
  });

  it('audits the administrator’s export as masked', async () => {
    const [row] = await exportRowsBy(adminUserId, 'patient.export');

    expect(JSON.stringify(row?.payload)).toContain('"masked":true');
  });

  it('refuses an export above the row bound with 409 and writes no audit row', async () => {
    const repository = harness.app.get(PatientRepository);
    const spy = vi
      .spyOn(repository, 'list')
      .mockResolvedValueOnce({ rows: [], totalItems: EXPORT_ROW_LIMIT + 1 });
    const before = (await exportRowsBy(doctorUserId, 'patient.export')).length;

    try {
      const response = await request(harness.server)
        .get(`${PATIENTS}/export`)
        .set('Authorization', `Bearer ${doctorToken}`);

      expect(response.status).toBe(409);
      expect(errorBody(response).code).toBe('export_too_large');
    } finally {
      spy.mockRestore();
    }

    expect((await exportRowsBy(doctorUserId, 'patient.export')).length).toBe(before);
  });

  it('validates the filters as the list does', async () => {
    const response = await request(harness.server)
      .get(`${PATIENTS}/export`)
      .query({ sort: 'medicalNotes:asc' })
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(response.status).toBe(422);
  });

  it('requires a session', async () => {
    expect((await request(harness.server).get(`${PATIENTS}/export`)).status).toBe(401);
  });
});

describe('GET /medical-records/export (§6.10)', () => {
  it('exports the doctor’s records and none of another doctor’s', async () => {
    const own = await getFile(doctorToken, `${RECORDS}/export`);
    expectCsvFile(own);
    const row = recordsOf(own.body as string).find((item) => item['recordId'] === recordId);

    expect(row?.['patientId']).toBe(ownPatient.id);
    expect(row?.['chiefComplaint']).toBe('Persistent headache, two weeks');

    const stranger = await getFile(strangerToken, `${RECORDS}/export`);
    expectCsvFile(stranger);
    expect(stranger.body as string).not.toContain(recordId);
  });

  it('respects the list filters', async () => {
    const other = await getFile(doctorToken, `${RECORDS}/export`, { patientId: formulaPatient.id });

    expect(recordsOf(other.body as string)).toHaveLength(0);
  });

  it('refuses an inverted range as the list does', async () => {
    const response = await request(harness.server)
      .get(`${RECORDS}/export`)
      .query({ from: '2026-10-01', to: '2026-09-01' })
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors).toHaveProperty('from');
  });

  it('is refused to a role without records.view', async () => {
    const response = await request(harness.server)
      .get(`${RECORDS}/export`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(403);
  });

  it('audits the export as a warning', async () => {
    const [row] = await exportRowsBy(doctorUserId, 'medical_record.export');

    expect(row?.severity).toBe('WARNING');
  });
});

describe('GET /medical-records/{id}/export (§6.10)', () => {
  it('writes the record as Field,Value rows with signed notes only', async () => {
    const response = await getFile(doctorToken, `${RECORDS}/${recordId}/export`);

    expectCsvFile(response);
    expect(response.headers['content-disposition']).toContain(recordId.toLowerCase());

    const [header, ...rows] = parseCsv(response.body as string);
    expect(header).toEqual(['Field', 'Value']);

    const fields = Object.fromEntries(rows.map(([field = '', value = '']) => [field, value]));
    expect(fields['Record']).toBe(recordId);
    expect(fields['Patient']).toBe(`Nadia Export (${ownPatient.mrn})`);
    expect(fields['Chief complaint']).toBe('Persistent headache, two weeks');
    expect(fields['Note — Assessment']).toContain('Tension-type headache likely.');
    expect(response.body as string).not.toContain('UNSIGNED-DRAFT-TEXT');
  });

  it('answers a doctor outside the care relationship with the 404 a missing record gets', async () => {
    const outside = await request(harness.server)
      .get(`${RECORDS}/${recordId}/export`)
      .set('Authorization', `Bearer ${strangerToken}`);
    const missing = await request(harness.server)
      .get(`${RECORDS}/MR-99999999/export`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(outside.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(errorBody(outside).message).toBe(errorBody(missing).message);
  });

  it('audits against the record reference', async () => {
    const rows = await exportRowsBy(doctorUserId, 'medical_record.export');

    expect(rows.some((row) => row.target === `medical_record:${recordId}`)).toBe(true);
  });
});

describe('GET /prescriptions/export (§7.10)', () => {
  it('exports the prescriber’s list, filtered, and neutralises formula text', async () => {
    const response = await getFile(doctorToken, `${PRESCRIPTIONS}/export`, { status: 'active' });

    expectCsvFile(response);
    const row = recordsOf(response.body as string).find(
      (item) => item['prescriptionId'] === prescriptionId,
    );
    expect(row?.['medication']).toBe('Amoxil');
    expect(row?.['status']).toBe('active');
    expect(row?.['patientName']).toBe(`'${formulaPatient.fullName}`);

    const drafts = await getFile(doctorToken, `${PRESCRIPTIONS}/export`, { status: 'draft' });
    expect(drafts.body as string).not.toContain(prescriptionId);
  });

  it('carries nothing of another prescriber’s', async () => {
    const response = await getFile(strangerToken, `${PRESCRIPTIONS}/export`);

    expectCsvFile(response);
    expect(response.body as string).not.toContain(prescriptionId);
  });

  it('audits the export as a warning', async () => {
    const [row] = await exportRowsBy(doctorUserId, 'prescription.export');

    expect(row?.severity).toBe('WARNING');
    expect(JSON.stringify(row?.payload)).toContain('"filters":"status"');
  });
});

describe('GET /lab-orders/export (§8.11)', () => {
  it('exports the worklist, scoped to the ordering doctor', async () => {
    const response = await getFile(doctorToken, `${LAB_ORDERS}/export`);

    expectCsvFile(response);
    const row = recordsOf(response.body as string).find(
      (item) => item['labOrderId'] === labOrderId,
    );
    expect(row?.['testCode']).toBe('51990-0');
    expect(row?.['status']).toBe('ordered');
    expect(row?.['patientId']).toBe(ownPatient.id);

    const stranger = await getFile(strangerToken, `${LAB_ORDERS}/export`);
    expect(stranger.body as string).not.toContain(labOrderId);
  });

  it('respects the worklist filters', async () => {
    const response = await getFile(doctorToken, `${LAB_ORDERS}/export`, { status: 'completed' });

    expect(response.body as string).not.toContain(labOrderId);
  });

  it('audits the export as a warning', async () => {
    const [row] = await exportRowsBy(doctorUserId, 'lab_order.export');

    expect(row?.severity).toBe('WARNING');
  });
});
