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
import { deletePatients } from './support/hospital-fixture';

/**
 * The prescription-safety exception to #17 (owner decision 2026-11-24).
 *
 * Legacy rows (no owning hospital) are isolated from ordinary clinical
 * access. Allergies and active medications are the exception, for safety:
 *
 * - the prescription safety screen includes them for a doctor who already
 *   holds a live care assignment to the patient — never silently dropped;
 * - every warning names them "legacy record, source hospital unknown";
 * - every read of one is audited (`legacy_clinical_record.read`);
 * - no patient becomes reachable that was not: a doctor without an
 *   assignment gets the same 404 as before, and nothing is read or audited;
 * - every other legacy row stays hidden — the chart's own allergy strip
 *   still shows only the hospital's rows.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const SAFETY_CHECK = '/api/v1/prescriptions/safety-check';
const PASSWORD = 'Medora123!';
const MARK = 'legacy record, source hospital unknown';
const ACTION = 'legacy_clinical_record.read';

interface SafetyWarningView {
  id: string;
  kind: string;
  severity: string;
  detail: string;
  against: string[];
  blocking: boolean;
}

const createdCharts: string[] = [];
let amoxilId = '';
let coumadinId = '';

async function signedInDoctor(local: string): Promise<{ token: string; email: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  return { token, email };
}

/** A chart created by the doctor: owned by its hospital, with an owned assignment. */
async function chartFor(token: string): Promise<{ publicId: string; id: string }> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Legacy Safety',
      dateOfBirth: '1979-02-03',
      gender: 'female',
      bloodType: 'O+',
      phone: '+20 100 555 0101',
      allergies: [],
      chronicConditions: [],
    });
  expect(response.status).toBe(201);
  const publicId = dataOf<{ id: string }>(response).id;
  createdCharts.push(publicId);
  const row = await harness.prisma.patient.findFirstOrThrow({
    where: { publicId },
    select: { id: true },
  });
  return { publicId, id: row.id };
}

/** A legacy allergy: `hospital_id` NULL, as rows written before Phase 21 are. */
async function legacyAllergy(patientId: string, allergen: string): Promise<string> {
  const row = await harness.prisma.patientAllergy.create({
    data: { patientId, allergen, severity: 'SEVERE', reaction: 'Anaphylaxis' },
    select: { id: true },
  });
  return row.id;
}

/** A live legacy prescription (no owning hospital). */
async function legacyPrescription(patientId: string, medicationId: string): Promise<string> {
  const prescriber = await harness.prisma.doctor.findFirstOrThrow({ select: { id: true } });
  const publicId = `RX-L${String(Date.now() % 100_000)}${String(Math.floor(Math.random() * 1000))}`;
  await harness.prisma.prescription.create({
    data: {
      publicId,
      patientId,
      medicationId,
      prescribingDoctorId: prescriber.id,
      strength: '5 mg',
      dosage: '1 tablet',
      frequency: 'Once daily',
      route: 'ORAL',
      durationDays: 30,
      quantity: 30,
      instructions: 'Legacy row.',
      status: 'ACTIVE',
      signedAt: new Date(),
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
    },
  });
  return publicId;
}

function check(token: string, patientId: string, medicationId: string) {
  return request(harness.server)
    .post(SAFETY_CHECK)
    .set('Authorization', `Bearer ${token}`)
    .send({ patientId, medicationId });
}

function auditRows(patientPublicId: string) {
  return harness.prisma.auditEvent.findMany({
    where: { eventType: ACTION, target: `patient:${patientPublicId}` },
    select: { actorId: true, hospitalId: true, payload: true, severity: true },
  });
}

async function userIdOf(email: string): Promise<string> {
  return (await harness.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } }))
    .id;
}

async function hospitalOf(userId: string): Promise<string> {
  const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
    where: { doctor: { userId }, endedAt: null },
    select: { hospitalId: true },
  });
  return employment.hospitalId;
}

beforeAll(async () => {
  harness = await createAuthHarness('legacy-safety', { clinicalDoctors: true });
  const byName = async (name: string): Promise<string> =>
    (await harness.prisma.medication.findFirstOrThrow({ where: { name }, select: { id: true } }))
      .id;
  amoxilId = await byName('Amoxil');
  coumadinId = await byName('Coumadin');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  if (createdCharts.length > 0) {
    const owned = { publicId: { in: createdCharts } };
    await harness.prisma.prescription.deleteMany({ where: { patient: owned } });
    await harness.prisma.patientAllergy.deleteMany({ where: { patient: owned } });
    await deletePatients(harness.prisma, { where: owned });
  }
  await harness.reset();
  await harness.close();
});

describe('legacy allergies and medications in the prescription safety screen', () => {
  it('a legacy penicillin allergy triggers the blocking allergy warning, marked as legacy, and is audited', async () => {
    const doctor = await signedInDoctor('legacy-allergy');
    const chart = await chartFor(doctor.token);
    const allergyId = await legacyAllergy(chart.id, 'Penicillin');

    const response = await check(doctor.token, chart.publicId, amoxilId);

    expect(response.status).toBe(200);
    const body = dataOf<{ warnings: SafetyWarningView[]; blocking: boolean }>(response);
    expect(body.blocking).toBe(true);
    const allergy = body.warnings.find((warning) => warning.kind === 'allergy');
    expect(allergy).toBeDefined();
    expect(allergy!.severity).toBe('critical');
    expect(allergy!.blocking).toBe(true);
    expect(allergy!.against).toEqual([`Recorded allergy: Penicillin (${MARK})`]);
    expect(allergy!.detail).toContain(MARK);

    const doctorUserId = await userIdOf(doctor.email);
    const rows = await auditRows(chart.publicId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: doctorUserId,
      hospitalId: await hospitalOf(doctorUserId),
      severity: 'WARNING',
    });
    expect(rows[0]!.payload).toMatchObject({
      purpose: 'prescription_safety_screen',
      legacyAllergyCount: 1,
      legacyAllergyIds: allergyId,
      legacyPrescriptionCount: 0,
    });
  });

  it('a legacy live prescription takes part in the interaction check, marked as legacy, and is audited', async () => {
    const doctor = await signedInDoctor('legacy-medication');
    const chart = await chartFor(doctor.token);
    const prescriptionId = await legacyPrescription(chart.id, coumadinId);

    const response = await check(doctor.token, chart.publicId, amoxilId);

    expect(response.status).toBe(200);
    const body = dataOf<{ warnings: SafetyWarningView[] }>(response);
    const interaction = body.warnings.find((warning) => warning.kind === 'interaction');
    expect(interaction).toBeDefined();
    expect(interaction!.against).toHaveLength(1);
    expect(interaction!.against[0]).toContain(MARK);
    expect(interaction!.detail).toContain(MARK);

    const rows = await auditRows(chart.publicId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({
      legacyAllergyCount: 0,
      legacyPrescriptionCount: 1,
      legacyPrescriptionIds: prescriptionId,
    });
  });

  it('a doctor without an assignment sees nothing: 404, and nothing is read or audited', async () => {
    const owner = await signedInDoctor('legacy-owner');
    const outsider = await signedInDoctor('legacy-outsider');
    const chart = await chartFor(owner.token);
    await legacyAllergy(chart.id, 'Penicillin');

    const response = await check(outsider.token, chart.publicId, amoxilId);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Penicillin');
    expect(await auditRows(chart.publicId)).toHaveLength(0);
  });

  it('writes no audit row when the patient has no legacy allergy or medication', async () => {
    const doctor = await signedInDoctor('legacy-none');
    const chart = await chartFor(doctor.token);

    expect((await check(doctor.token, chart.publicId, amoxilId)).status).toBe(200);
    expect(await auditRows(chart.publicId)).toHaveLength(0);
  });

  it('audits every read: two screens, two rows', async () => {
    const doctor = await signedInDoctor('legacy-twice');
    const chart = await chartFor(doctor.token);
    await legacyAllergy(chart.id, 'Penicillin');

    await check(doctor.token, chart.publicId, amoxilId);
    await check(doctor.token, chart.publicId, amoxilId);

    expect(await auditRows(chart.publicId)).toHaveLength(2);
  });

  it('is an exception for the screen only: the chart still hides the legacy allergy (#17)', async () => {
    const doctor = await signedInDoctor('legacy-chart');
    const chart = await chartFor(doctor.token);
    await legacyAllergy(chart.id, 'Penicillin');

    const detail = await request(harness.server)
      .get(`${PATIENTS}/${chart.publicId}`)
      .set('Authorization', `Bearer ${doctor.token}`);

    expect(detail.status).toBe(200);
    const allergies = dataOf<{ allergies: { allergen: string }[] }>(detail).allergies;
    expect(allergies.map((allergy) => allergy.allergen)).not.toContain('Penicillin');
    expect(await auditRows(chart.publicId)).toHaveLength(0);
  });
});
