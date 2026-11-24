import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { assignOwned, deletePatients } from './support/hospital-fixture';

/**
 * S3/S4 — negative cross-hospital tests for every clinical caller family
 * (BACKEND_ENFORCEMENT_INVENTORY.md §4: N-1, N-6…N-11) and for the
 * doctor-own lists, through the real HTTP stack.
 *
 * Two hospitals, A and B. Doctor A is employed at A, doctor B at B.
 *
 *  · patient X is assigned only at B (doctor B registered the chart);
 *  · patient Y is assigned at both: doctor A registered the chart at A, and
 *    doctor B holds an assignment owned by B. Doctor B then writes a note,
 *    vitals, an encounter, a lab order, a prescription, a booking and a
 *    document at B — all through the API or with B's ownership — so
 *    hospital B's rows hang off a patient doctor A **can** reach;
 *  · patient Z has a legacy assignment for doctor A with no hospital (#17).
 *
 * Doctor A must get the 404 a missing chart produces for X and Z on every
 * caller, must see none of B's rows on Y, and must lose access when not
 * clinically usable (#18) — except on VACATION.
 */

const PASSWORD = 'Medora123!';
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';
const LAB_ORDERS = '/api/v1/lab-orders';
const PRESCRIPTIONS = '/api/v1/prescriptions';
const APPOINTMENTS = '/api/v1/appointments';
const FILES = '/api/v1/files';
const AI = '/api/v1/ai/conversations';
const SEARCH = '/api/v1/search';

interface Doctor {
  readonly token: string;
  readonly email: string;
  readonly doctorId: string;
}

interface Chart {
  readonly id: string;
  readonly publicId: string;
}

let harness: AuthHarness;
let doctorA: Doctor;
let doctorB: Doctor;
let x: Chart;
let y: Chart;
let z: Chart;
const charts: string[] = [];
const atB = {
  record: '',
  labOrder: '',
  prescription: '',
  appointment: '',
  fileId: '',
};

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function seedDoctor(local: string, hospital: 'a' | 'b'): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  // `clinicalDoctors`: verified and employed at the suite's hospital A.
  await markVerified(harness.prisma, email);
  if (hospital === 'b') await harness.employ(email, 'b');

  const login = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, rememberMe: false });
  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true },
  });

  return { token: dataOf<{ accessToken: string }>(login).accessToken, email, doctorId: doctor.id };
}

async function createPatient(doctor: Doctor, fullName: string): Promise<Chart> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set(as(doctor.token))
    .send({
      fullName,
      dateOfBirth: '1980-02-02',
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 100 555 0101',
      allergies: [{ allergen: `Allergen of ${fullName}`, severity: 'severe', reaction: 'Rash' }],
      chronicConditions: [],
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);

  const publicId = dataOf<{ id: string }>(response).id;
  charts.push(publicId);
  const row = await harness.prisma.patient.findUniqueOrThrow({
    where: { publicId },
    select: { id: true },
  });
  return { id: row.id, publicId };
}

function created(response: request.Response): string {
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return dataOf<{ id: string }>(response).id;
}

beforeAll(async () => {
  harness = await createAuthHarness('hospital-isolation', { clinicalDoctors: true });

  doctorA = await seedDoctor('iso-a', 'a');
  doctorB = await seedDoctor('iso-b', 'b');

  x = await createPatient(doctorB, 'Isolated Xenia Bravo');
  y = await createPatient(doctorA, 'Shared Yara Alpha');
  z = await createPatient(doctorA, 'Legacy Zaid Alpha');

  // Y is also doctor B's patient, owned by B (their active employment).
  await assignOwned(harness.prisma, { doctorId: doctorB.doctorId, patientId: y.id });

  // Z: doctor A's assignment becomes a legacy row with no hospital (#17).
  await harness.prisma.patientDoctorAssignment.updateMany({
    where: { patientId: z.id, doctorId: doctorA.doctorId },
    data: { revokedAt: new Date() },
  });
  await harness.prisma.patientDoctorAssignment.create({
    data: { patientId: z.id, doctorId: doctorA.doctorId },
  });

  // Doctor B's work on Y, at hospital B, through the API (S4 stamps it).
  const b = as(doctorB.token);
  created(
    await request(harness.server)
      .post(`${PATIENTS}/${y.publicId}/notes`)
      .set(b)
      .send({ title: 'Hospital B note', body: 'Written at B' }),
  );
  created(
    await request(harness.server).post(`${PATIENTS}/${y.publicId}/vitals`).set(b).send({
      systolic: 120,
      diastolic: 80,
      heartRate: 70,
      temperatureC: 37,
      respiratoryRate: 14,
      oxygenSaturation: 98,
      weightKg: 70,
      heightCm: 170,
    }),
  );
  atB.record = created(
    await request(harness.server).post(RECORDS).set(b).send({
      patientId: y.publicId,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Seen at hospital B',
      historyOfPresentIllness: 'History taken at hospital B.',
      physicalExamination: 'Examined at hospital B.',
    }),
  );
  atB.labOrder = created(
    await request(harness.server).post(LAB_ORDERS).set(b).send({
      patientId: y.publicId,
      testCode: '51990-0',
      priority: 'routine',
      clinicalIndication: 'Ordered at hospital B',
    }),
  );
  const medication = await harness.prisma.medication.findFirstOrThrow({
    where: { isControlled: false, strengths: { some: {} } },
    select: { id: true, strengths: { select: { strength: true }, take: 1 } },
  });
  atB.prescription = created(
    await request(harness.server).post(PRESCRIPTIONS).set(b).send({
      patientId: y.publicId,
      medicationId: medication.id,
      strength: medication.strengths[0]?.strength,
      dosage: '1 tablet',
      frequency: 'Once daily',
      durationDays: 7,
      quantity: 7,
      instructions: 'Prescribed at hospital B',
    }),
  );

  // A booking and a document owned by B, written with B's ownership.
  const care = await harness.prisma.patientDoctorAssignment.findFirstOrThrow({
    where: { patientId: y.id, doctorId: doctorB.doctorId, revokedAt: null },
    select: { hospitalId: true, hospitalMedicalRecordId: true, doctorEmploymentId: true },
  });
  const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });
  atB.appointment = 'APT-Tiso1';
  await harness.prisma.appointment.create({
    data: {
      publicId: atB.appointment,
      patientId: y.id,
      doctorId: doctorB.doctorId,
      visitTypeId: visitType.id,
      startsAt: new Date('2026-09-10T09:00:00.000Z'),
      reason: 'Booked at hospital B',
      status: 'COMPLETED',
      hospitalId: care.hospitalId,
      hospitalMedicalRecordId: care.hospitalMedicalRecordId,
      doctorEmploymentId: care.doctorEmploymentId,
    },
  });
  const uploader = await harness.prisma.user.findFirstOrThrow({
    where: { email: doctorB.email },
    select: { id: true },
  });
  const file = await harness.prisma.file.create({
    data: {
      storageKey: 'test/hospital-isolation/b-document.pdf',
      originalName: 'b-document.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(1024),
      checksumSha256: '0'.repeat(64),
      kind: 'patient_document',
      uploadedBy: uploader.id,
      hospitalId: care.hospitalId,
    },
    select: { id: true },
  });
  atB.fileId = file.id;
  await harness.prisma.patientDocument.create({
    data: {
      patientId: y.id,
      hospitalId: care.hospitalId,
      hospitalMedicalRecordId: care.hospitalMedicalRecordId,
      name: 'b-document.pdf',
      category: 'REPORT',
      sizeKb: 1,
      fileId: file.id,
      uploadedBy: uploader.id,
    },
  });
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.prisma.patientDocument.deleteMany({ where: { fileId: atB.fileId } });
  await harness.prisma.file.deleteMany({ where: { id: atB.fileId } });
  await deletePatients(harness.prisma, { where: { publicId: { in: charts } } });
  await harness.reset();
  await harness.close();
});

function get(token: string, path: string) {
  return request(harness.server).get(path).set(as(token));
}

const CHART_READS = [
  '',
  '/profile',
  '/allergies',
  '/alerts',
  '/history',
  '/emergency-contacts',
  '/notes',
  '/vitals',
  '/medications',
  '/documents',
  '/studies',
  '/appointments',
  '/labs',
];

describe('N-1 — patient chart and tabs', () => {
  it.each(CHART_READS)(
    'answers 404 on %s for a patient assigned only at another hospital',
    async (tab) => {
      const response = await get(doctorA.token, `${PATIENTS}/${x.publicId}${tab}`);
      expect(response.status).toBe(404);
    },
  );

  it.each(CHART_READS)(
    'answers 404 on %s for a legacy assignment with no hospital (#17)',
    async (tab) => {
      expect((await get(doctorA.token, `${PATIENTS}/${z.publicId}${tab}`)).status).toBe(404);
    },
  );

  it('refuses writes and the identity reveal on the other hospital’s patient', async () => {
    const a = as(doctorA.token);
    expect(
      (
        await request(harness.server)
          .post(`${PATIENTS}/${x.publicId}/notes`)
          .set(a)
          .send({ title: 'No', body: 'No' })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(harness.server)
          .post(`${PATIENTS}/${x.publicId}/reveal`)
          .set(a)
          .send({ category: 'clinical-review', reason: 'Cross-hospital attempt' })
      ).status,
    ).toBe(404);
  });

  it('keeps the patient off the doctor’s directory', async () => {
    const response = await get(doctorA.token, `${PATIENTS}?pageSize=100`);
    const ids = dataOf<{ items: { id: string }[] }>(response).items.map((row) => row.id);
    expect(ids).toContain(y.publicId);
    expect(ids).not.toContain(x.publicId);
    expect(ids).not.toContain(z.publicId);
  });

  it('shows none of hospital B’s rows on a patient both hospitals treat', async () => {
    const notes = dataOf<{ items: { title: string }[] }>(
      await get(doctorA.token, `${PATIENTS}/${y.publicId}/notes`),
    ).items;
    expect(notes.map((note) => note.title)).not.toContain('Hospital B note');

    const vitals = dataOf<{ items: unknown[] }>(
      await get(doctorA.token, `${PATIENTS}/${y.publicId}/vitals`),
    ).items;
    expect(vitals).toHaveLength(0);

    const documents = dataOf<{ items: unknown[] }>(
      await get(doctorA.token, `${PATIENTS}/${y.publicId}/documents`),
    ).items;
    expect(documents).toHaveLength(0);

    const appointments = JSON.stringify(
      (await get(doctorA.token, `${PATIENTS}/${y.publicId}/appointments`)).body,
    );
    expect(appointments).not.toContain(atB.appointment);

    const labs = JSON.stringify((await get(doctorA.token, `${PATIENTS}/${y.publicId}/labs`)).body);
    expect(labs).not.toContain(atB.labOrder);

    // Doctor B, at B, sees B's own rows — the filter is the hospital, not the doctor.
    const notesAtB = dataOf<{ items: { title: string }[] }>(
      await get(doctorB.token, `${PATIENTS}/${y.publicId}/notes`),
    ).items;
    expect(notesAtB.map((note) => note.title)).toContain('Hospital B note');
  });

  it('keeps each hospital’s allergies on its own chart (DR-04)', async () => {
    const allergens = dataOf<{ allergen: string }[]>(
      await get(doctorB.token, `${PATIENTS}/${y.publicId}/allergies`),
    ).map((row) => row.allergen);
    // Y's allergy was recorded at A on registration; B has none of its own.
    expect(allergens).toEqual([]);
  });
});

describe('N-6 — medical records', () => {
  it('answers 404 for hospital B’s record and keeps it off the list', async () => {
    expect((await get(doctorA.token, `${RECORDS}/${atB.record}`)).status).toBe(404);
    expect(JSON.stringify((await get(doctorA.token, RECORDS)).body)).not.toContain(atB.record);
    expect((await get(doctorB.token, `${RECORDS}/${atB.record}`)).status).toBe(200);
  });

  it('refuses a record for a patient assigned only at another hospital', async () => {
    const response = await request(harness.server).post(RECORDS).set(as(doctorA.token)).send({
      patientId: x.publicId,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Cross-hospital',
      historyOfPresentIllness: 'Cross-hospital.',
      physicalExamination: 'Cross-hospital.',
    });
    expect(response.status).toBe(404);
  });

  it('stamps a created record with the creating doctor’s hospital, record and employment (S4)', async () => {
    const row = await harness.prisma.medicalRecord.findUniqueOrThrow({
      where: { publicId: atB.record },
      select: { hospitalId: true, hospitalMedicalRecordId: true, doctorEmploymentId: true },
    });
    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctorB.doctorId, endedAt: null },
      select: { id: true, hospitalId: true },
    });
    expect(row.hospitalId).toBe(employment.hospitalId);
    expect(row.doctorEmploymentId).toBe(employment.id);
    expect(row.hospitalMedicalRecordId).not.toBeNull();
  });
});

describe('N-7 — lab orders', () => {
  it('answers 404 for hospital B’s order and keeps it off the worklist', async () => {
    expect((await get(doctorA.token, `${LAB_ORDERS}/${atB.labOrder}`)).status).toBe(404);
    expect(JSON.stringify((await get(doctorA.token, LAB_ORDERS)).body)).not.toContain(atB.labOrder);
    expect((await get(doctorB.token, `${LAB_ORDERS}/${atB.labOrder}`)).status).toBe(200);
  });

  it('refuses an order for a patient assigned only at another hospital', async () => {
    const response = await request(harness.server).post(LAB_ORDERS).set(as(doctorA.token)).send({
      patientId: x.publicId,
      testCode: '51990-0',
      clinicalIndication: 'Cross-hospital',
    });
    expect(response.status).toBe(404);
  });
});

describe('N-8 — prescriptions and the safety screen', () => {
  it('answers 404 for hospital B’s prescription and keeps it off the list', async () => {
    expect((await get(doctorA.token, `${PRESCRIPTIONS}/${atB.prescription}`)).status).toBe(404);
    expect(JSON.stringify((await get(doctorA.token, PRESCRIPTIONS)).body)).not.toContain(
      atB.prescription,
    );
  });

  it('refuses a prescription and a safety check for the other hospital’s patient', async () => {
    const medication = await harness.prisma.medication.findFirstOrThrow({ select: { id: true } });
    const a = as(doctorA.token);
    expect(
      (
        await request(harness.server)
          .post(`${PRESCRIPTIONS}/safety-check`)
          .set(a)
          .send({ patientId: x.publicId, medicationId: medication.id })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(harness.server).post(PRESCRIPTIONS).set(a).send({
          patientId: x.publicId,
          medicationId: medication.id,
          strength: '500 mg',
          dosage: '1 tablet',
          frequency: 'Once daily',
          durationDays: 7,
          quantity: 7,
          instructions: 'Cross-hospital',
        })
      ).status,
    ).toBe(404);
  });
});

describe('N-9 — files', () => {
  it('answers 404 for hospital B’s document on a chart doctor A can reach', async () => {
    expect((await get(doctorA.token, `${FILES}/${atB.fileId}`)).status).toBe(404);
    expect((await get(doctorB.token, `${FILES}/${atB.fileId}`)).status).toBe(200);
  });
});

describe('N-10 — AI context binding', () => {
  it('refuses to bind a patient assigned only at another hospital', async () => {
    const response = await request(harness.server)
      .post(AI)
      .set(as(doctorA.token))
      .send({ context: { mode: 'patient', patientId: x.publicId } });
    expect(response.status).toBe(404);
  });

  it('cannot ground a thread in hospital B’s record on a shared patient', async () => {
    const response = await request(harness.server)
      .post(AI)
      .set(as(doctorA.token))
      .send({ context: { mode: 'record', patientId: y.publicId, refId: atB.record } });
    expect(response.status).toBe(409);
  });
});

describe('N-11 — search', () => {
  it('finds neither the other hospital’s patient nor a legacy one', async () => {
    const response = await get(doctorA.token, `${SEARCH}?q=Alpha`);
    const text = JSON.stringify(response.body);
    expect(text).toContain(y.publicId);
    expect(text).not.toContain(z.publicId);

    const bravo = JSON.stringify((await get(doctorA.token, `${SEARCH}?q=Xenia`)).body);
    expect(bravo).not.toContain(x.publicId);
  });
});

describe('S4 — doctor-own lists are the active hospital’s', () => {
  it('keeps hospital B’s booking off doctor B’s book once B is no longer their hospital', async () => {
    const before = JSON.stringify(
      (await get(doctorB.token, `${APPOINTMENTS}?view=list&pageSize=100`)).body,
    );
    expect(before).toContain(atB.appointment);

    // Doctor B moves to hospital A: B's book, records and orders stay B's.
    await harness.employ(doctorB.email, 'a');
    try {
      const after = JSON.stringify(
        (await get(doctorB.token, `${APPOINTMENTS}?view=list&pageSize=100`)).body,
      );
      expect(after).not.toContain(atB.appointment);
      expect((await get(doctorB.token, `${APPOINTMENTS}/${atB.appointment}`)).status).toBe(404);
      expect((await get(doctorB.token, `${RECORDS}/${atB.record}`)).status).toBe(404);
      expect((await get(doctorB.token, `${LAB_ORDERS}/${atB.labOrder}`)).status).toBe(404);
      expect((await get(doctorB.token, `${PRESCRIPTIONS}/${atB.prescription}`)).status).toBe(404);
      expect((await get(doctorB.token, `${PATIENTS}/${x.publicId}`)).status).toBe(404);
    } finally {
      await harness.employ(doctorB.email, 'b');
    }
  });
});

describe('doctor lifecycle (#18)', () => {
  it('keeps access on VACATION', async () => {
    const id = doctorA.doctorId;
    await harness.prisma.doctor.update({ where: { id }, data: { practiceStatus: 'VACATION' } });
    try {
      expect((await get(doctorA.token, `${PATIENTS}/${y.publicId}`)).status).toBe(200);
    } finally {
      await harness.prisma.doctor.update({ where: { id }, data: { practiceStatus: 'ACTIVE' } });
    }
  });

  it.each([
    [
      'unverified',
      { verificationStatus: 'PENDING' as const },
      { verificationStatus: 'VERIFIED' as const },
    ],
    ['suspended', { practiceStatus: 'SUSPENDED' as const }, { practiceStatus: 'ACTIVE' as const }],
    ['soft-deleted', { deletedAt: new Date() }, { deletedAt: null }],
  ])('denies a doctor who is %s, on the chart and the list', async (_label, change, restore) => {
    const id = doctorA.doctorId;
    await harness.prisma.doctor.update({ where: { id }, data: change });
    try {
      expect((await get(doctorA.token, `${PATIENTS}/${y.publicId}`)).status).toBe(404);
      expect((await get(doctorA.token, `${RECORDS}`)).status).toBe(404);
      const list = dataOf<{ items: unknown[] }>(await get(doctorA.token, PATIENTS));
      expect(list.items).toHaveLength(0);
    } finally {
      await harness.prisma.doctor.update({ where: { id }, data: restore });
    }
  });

  it('denies a doctor whose employment was terminated (OD-12)', async () => {
    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctorA.doctorId, endedAt: null },
      select: { id: true },
    });
    await harness.prisma.doctorEmployment.update({
      where: { id: employment.id },
      data: { endedAt: new Date() },
    });

    expect((await get(doctorA.token, `${PATIENTS}/${y.publicId}`)).status).toBe(404);
    expect((await get(doctorA.token, `${LAB_ORDERS}`)).status).toBe(404);
  });
});
