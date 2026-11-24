/**
 * DR-05 at resource level (multi-hospital §2.6; audit finding F-01).
 *
 * Reaching a patient is not reaching every row about them: a doctor reads
 * the rows that belong to their own clinical hospital, and writes rows
 * stamped with it (F-06). No care assignment is needed at that hospital, and
 * none from a former hospital survives a transfer or a termination.
 *
 * Fixture: hospitals A and B; doctors `a` and `colleague` at A (only `a`
 * registered the patient, so only `a` holds an assignment), `b` at B. The
 * patient holds a Hospital Medical Record at both. `stranger` is a patient
 * with a record at B only.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HospitalStaffingRepository } from '../src/modules/hospitals/repositories/hospital-staffing.repository';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  purgeHospitalRecords,
  recordPatientAt,
  registrationBody,
  testEmail,
} from './support/auth-app';

const PASSWORD = 'Medora123!';
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';

let harness: AuthHarness;
let hospitalA = '';
let hospitalB = '';
const tokens: Record<string, string> = {};
const patientIds: string[] = [];
let patient = ''; // PT-… with records at A and B
let patientUuid = '';
let stranger = ''; // PT-… with a record at B only
let recordAtA = '';

const as = (who: string) => ({ Authorization: `Bearer ${tokens[who] ?? ''}` });

const VITALS = (systolic: number) => ({
  systolic,
  diastolic: 80,
  heartRate: 70,
  temperatureC: 36.6,
  respiratoryRate: 14,
  oxygenSaturation: 98,
  weightKg: 70,
  heightCm: 170,
});

async function doctor(local: string, hospitalId: string): Promise<void> {
  const email = testEmail(local);
  expect((await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }))).status).toBe(
    201,
  );
  await markVerified(harness.prisma, email);
  await makeClinicalDoctor(harness.prisma, email, hospitalId);
  await login(local);
}

async function login(local: string): Promise<void> {
  const response = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email: testEmail(local), password: PASSWORD, rememberMe: false });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  tokens[local] = dataOf<{ accessToken: string }>(response).accessToken;
}

async function register(token: string, fullName: string): Promise<{ publicId: string; id: string }> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set({ Authorization: `Bearer ${token}` })
    .send({
      fullName,
      dateOfBirth: '1980-02-02',
      gender: 'female',
      bloodType: 'B+',
      phone: '+20 100 555 0101',
      allergies: [],
      chronicConditions: [],
    });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const publicId = dataOf<{ id: string }>(response).id;
  const row = await harness.prisma.patient.findUniqueOrThrow({ where: { publicId }, select: { id: true } });
  patientIds.push(row.id);
  return { publicId, id: row.id };
}

const systolicsSeenBy = async (who: string): Promise<number[]> => {
  const response = await request(harness.server).get(`${PATIENTS}/${patient}/vitals`).set(as(who));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dataOf<{ items: { systolic: number }[] }>(response)
    .items.map((row) => row.systolic)
    .sort();
};

beforeAll(async () => {
  harness = await createAuthHarness('dr05-resource');
  hospitalA = await fixtureHospital(harness.prisma, 'r5a');
  hospitalB = await fixtureHospital(harness.prisma, 'r5b');
  await doctor('r5-a', hospitalA);
  await doctor('r5-colleague', hospitalA);
  await doctor('r5-b', hospitalB);

  const registered = await register(tokens['r5-a'] ?? '', 'Two Hospital Patient');
  patient = registered.publicId;
  patientUuid = registered.id;
  await recordPatientAt(harness.prisma, patientUuid, hospitalB);
  stranger = (await register(tokens['r5-b'] ?? '', 'Hospital B Only Patient')).publicId;

  // One reading at each hospital, each written through the API.
  expect((await request(harness.server).post(`${PATIENTS}/${patient}/vitals`).set(as('r5-a')).send(VITALS(111))).status).toBe(201);
  expect((await request(harness.server).post(`${PATIENTS}/${patient}/vitals`).set(as('r5-b')).send(VITALS(122))).status).toBe(201);

  const record = await request(harness.server)
    .post(RECORDS)
    .set(as('r5-a'))
    .send({
      patientId: patient,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'DR-05 resource scope probe',
      historyOfPresentIllness: 'Probe.',
      physicalExamination: 'Probe.',
    });
  expect(record.status, JSON.stringify(record.body)).toBe(201);
  recordAtA = dataOf<{ id: string }>(record).id;
}, 180_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.prisma.medicalRecord.deleteMany({ where: { patientId: { in: patientIds } } }).catch(() => undefined);
  await harness.prisma.patientVitalSign.deleteMany({ where: { patientId: { in: patientIds } } });
  await harness.prisma.patientNote.deleteMany({ where: { patientId: { in: patientIds } } });
  await harness.prisma.patientAllergy.deleteMany({ where: { patientId: { in: patientIds } } });
  await harness.prisma.patientDoctorAssignment.deleteMany({ where: { patientId: { in: patientIds } } });
  await purgeHospitalRecords(harness.prisma, patientIds);
  await harness.prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
  await harness.reset();
  await harness.close();
});

describe('reads belong to the reader’s hospital', () => {
  it('stamps every write with the writer’s hospital and the patient’s record there (F-06)', async () => {
    const rows = await harness.prisma.patientVitalSign.findMany({
      where: { patientId: patientUuid },
      select: { hospitalId: true, hospitalMedicalRecordId: true, bloodPressureSystolic: true },
    });
    const byHospital = Object.fromEntries(rows.map((row) => [row.bloodPressureSystolic, row.hospitalId]));
    expect(byHospital).toEqual({ 111: hospitalA, 122: hospitalB });
    expect(rows.every((row) => row.hospitalMedicalRecordId !== null)).toBe(true);
  });

  it('shows each hospital only its own rows of a patient with records at both', async () => {
    expect(await systolicsSeenBy('r5-a')).toEqual([111]);
    expect(await systolicsSeenBy('r5-b')).toEqual([122]);
  });

  it('needs no care assignment at the same hospital', async () => {
    expect(await systolicsSeenBy('r5-colleague')).toEqual([111]);
    const record = await request(harness.server).get(`${RECORDS}/${recordAtA}`).set(as('r5-colleague'));
    expect(record.status).toBe(200);
  });

  it('hides another hospital’s record, in the list and by id', async () => {
    expect((await request(harness.server).get(`${RECORDS}/${recordAtA}`).set(as('r5-b'))).status).toBe(404);
    const list = await request(harness.server).get(`${RECORDS}?pageSize=100`).set(as('r5-b'));
    expect(dataOf<{ items: { id: string }[] }>(list).items.map((row) => row.id)).not.toContain(recordAtA);
  });

  it('refuses a patient with no record at the reader’s hospital (mismatched record)', async () => {
    for (const path of ['', '/vitals', '/notes', '/allergies']) {
      const response = await request(harness.server).get(`${PATIENTS}/${stranger}${path}`).set(as('r5-a'));
      expect(response.status, path).toBe(404);
    }
  });

  it('never shows a row with no hospital ownership (unstamped legacy)', async () => {
    await harness.prisma.patientVitalSign.create({
      data: {
        patientId: patientUuid,
        bloodPressureSystolic: 199,
        bloodPressureDiastolic: 99,
        heartRateBpm: 90,
        temperatureC: 37,
        respiratoryRate: 18,
        oxygenSaturation: 95,
        weightKg: 70,
        heightCm: 170,
      },
    });
    expect(await systolicsSeenBy('r5-a')).toEqual([111]);
    expect(await systolicsSeenBy('r5-b')).toEqual([122]);
  });

  it('keeps allergies hospital-owned too', async () => {
    const added = await request(harness.server)
      .post(`${PATIENTS}/${patient}/allergies`)
      .set(as('r5-b'))
      .send({ allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const seenByA = await request(harness.server).get(`${PATIENTS}/${patient}/allergies`).set(as('r5-a'));
    expect(dataOf<{ allergen: string }[]>(seenByA).map((row) => row.allergen)).not.toContain('Penicillin');
    const seenByB = await request(harness.server).get(`${PATIENTS}/${patient}/allergies`).set(as('r5-b'));
    expect(dataOf<{ allergen: string }[]>(seenByB).map((row) => row.allergen)).toContain('Penicillin');
  });
});

describe('standing ends access, and assignments do not outlive it', () => {
  it('a suspended doctor reaches nothing', async () => {
    await harness.prisma.doctor.updateMany({
      where: { user: { is: { email: testEmail('r5-colleague') } } },
      data: { practiceStatus: 'SUSPENDED' },
    });
    await harness.prisma.user.update({
      where: { email: testEmail('r5-colleague') },
      data: { authzVersion: { increment: 1 } },
    });
    const response = await request(harness.server).get(`${PATIENTS}/${patient}/vitals`).set(as('r5-colleague'));
    expect([403, 404]).toContain(response.status);
  });

  it('a transferred doctor reads the new hospital’s rows only, and the old assignment is revoked', async () => {
    const staffing = harness.app.get(HospitalStaffingRepository);
    const doctorRow = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { is: { email: testEmail('r5-a') } } },
      select: { id: true, userId: true },
    });
    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctorRow.id, endedAt: null },
      select: { id: true, hospitalId: true },
    });
    await staffing.transfer({
      from: { ...employment, doctorId: doctorRow.id, endedAt: null, userId: doctorRow.userId },
      toHospitalId: hospitalB,
      departmentId: undefined,
    });
    // Sessions were revoked by the transfer; sign in again.
    await login('r5-a');

    expect(
      await harness.prisma.patientDoctorAssignment.count({
        where: { doctorId: doctorRow.id, hospitalId: hospitalA, revokedAt: null },
      }),
    ).toBe(0);
    expect(await systolicsSeenBy('r5-a')).toEqual([122]);
    expect((await request(harness.server).get(`${RECORDS}/${recordAtA}`).set(as('r5-a'))).status).toBe(404);
    const list = await request(harness.server).get(`${PATIENTS}?pageSize=100`).set(as('r5-a'));
    expect(dataOf<{ items: { id: string }[] }>(list).items.map((row) => row.id)).not.toContain(patient);
  });

  it('a terminated doctor reaches nothing', async () => {
    const staffing = harness.app.get(HospitalStaffingRepository);
    const doctorRow = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { is: { email: testEmail('r5-b') } } },
      select: { id: true, userId: true },
    });
    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctorRow.id, endedAt: null },
      select: { id: true, hospitalId: true },
    });
    await staffing.endEmployment({ ...employment, doctorId: doctorRow.id, endedAt: null, userId: doctorRow.userId });
    // The session it held is revoked, and the account cannot open a new one.
    const response = await request(harness.server).get(`${PATIENTS}/${stranger}/vitals`).set(as('r5-b'));
    expect(response.status).toBe(401);
    const relogin = await request(harness.server)
      .post('/api/v1/auth/login')
      .send({ email: testEmail('r5-b'), password: PASSWORD, rememberMe: false });
    expect(relogin.status).toBe(403);
    expect(
      await harness.prisma.patientDoctorAssignment.count({ where: { doctorId: doctorRow.id, revokedAt: null } }),
    ).toBe(0);
  });
});
