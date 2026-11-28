/**
 * The patient-facing information layer (contract §4; ADR-050 draft).
 *
 * `GET /me/lab-orders` is status only: the clinician-only columns are
 * asserted ABSENT as keys (not masked), another patient's rows never appear,
 * and soft-deleted and NULL-hospital rows are excluded. `GET /me/insurance`
 * shows the last four digits of the policy only.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  recordPatientAt,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

const PREFIX = '/api/v1';
const PASSWORD = 'Medora123!';
const TAG = 'inf';
const LAB_PREFIX = 'LAB-TINF';
const POLICY = 'POL-INF-998877665';
const FORBIDDEN_KEYS = [
  'clinicalIndication',
  'clinical_indication',
  'interpretation',
  'flags',
  'flag',
  'hasCriticalResult',
  'has_critical_result',
  'reviewer',
  'reviewedBy',
  'reviewed_by',
  'reviewedAt',
  'orderedBy',
  'notes',
  'values',
];

let harness: AuthHarness;
let records: PatientRecord[];
let hospitalId: string;
let alice: string;
let bob: string;
let unlinked: string;
/** Set only when this file created the insurer, so teardown removes exactly that row. */
let createdProviderId: string | undefined;
let doctor: string;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(`${PREFIX}/auth/login`)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function patientAccount(local: string, record?: PatientRecord): Promise<string> {
  const email = testEmail(local);
  await request(harness.server)
    .post(`${PREFIX}/auth/register`)
    .send(registrationBody({ email, role: 'patient' }))
    .expect(201);
  await request(harness.server)
    .post(`${PREFIX}/auth/verify-email`)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);
  if (record !== undefined) {
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    await harness.prisma.patient.update({ where: { id: record.id }, data: { userId: user.id } });
  }
  return login(email);
}

function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const item of value) collectKeys(item, into);
  else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      collectKeys(inner, into);
    }
  }
  return into;
}

async function clearLabOrders(): Promise<void> {
  await harness.prisma.labOrder.deleteMany({ where: { publicId: { startsWith: LAB_PREFIX } } });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-info-layer');
  await clearLabOrders();
  records = await createPatientRecords(harness.prisma, TAG, 3);
  hospitalId = await fixtureHospital(harness.prisma, 'inf');

  const doctorEmail = testEmail('doctor');
  await request(harness.server).post(`${PREFIX}/auth/register`).send(registrationBody({ email: doctorEmail }));
  await markVerified(harness.prisma, doctorEmail);
  const { doctorId } = await makeClinicalDoctor(harness.prisma, doctorEmail, hospitalId);
  doctor = await login(doctorEmail);
  const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
    where: { doctorId, hospitalId, endedAt: null },
  });
  const test = await harness.prisma.labTestCatalogue.findFirstOrThrow({ where: { active: true } });

  const scoped = async (record: PatientRecord) => ({
    hospitalId,
    hospitalMedicalRecordId: await recordPatientAt(harness.prisma, record.id, hospitalId),
    doctorEmploymentId: employment.id,
  });
  const base = (record: PatientRecord, n: number) => ({
    publicId: `${LAB_PREFIX}${n}`,
    patientId: record.id,
    testId: test.id,
    orderedBy: doctorId,
    clinicalIndication: 'SECRET-INDICATION chest pain workup',
    requestedAt: new Date(Date.now() - n * 3_600_000),
  });

  const aliceScope = await scoped(records[0]!);
  await harness.prisma.labOrder.createMany({
    data: [
      { ...base(records[0]!, 1), ...aliceScope, status: 'ORDERED' },
      { ...base(records[0]!, 2), ...aliceScope, status: 'PROCESSING', collectedAt: new Date() },
      {
        ...base(records[0]!, 3),
        ...aliceScope,
        status: 'COMPLETED',
        collectedAt: new Date(Date.now() - 7_200_000),
        completedAt: new Date(),
        interpretation: 'SECRET-INTERPRETATION markedly abnormal',
        hasCriticalResult: true,
      },
      // Soft-deleted: excluded.
      { ...base(records[0]!, 4), ...aliceScope, status: 'ORDERED', deletedAt: new Date() },
      // Legacy, no hospital (#17): excluded.
      { ...base(records[0]!, 5), status: 'COLLECTED' },
      // Bob's.
      { ...base(records[1]!, 6), ...(await scoped(records[1]!)), status: 'CANCELLED' },
    ],
  });

  const existing = await harness.prisma.insuranceProvider.findFirst({ where: { active: true } });
  const provider =
    existing ?? (await harness.prisma.insuranceProvider.create({ data: { name: 'E2E Info Layer Insurer' } }));
  // `insurance_providers` is seeded empty (DB §5; schema-reference asserts it),
  // so a row this file creates must not outlive it.
  if (existing === null) createdProviderId = provider.id;
  await harness.prisma.patientInsurance.deleteMany({ where: { patientId: records[0]!.id } });
  await harness.prisma.patientInsurance.create({
    data: {
      patientId: records[0]!.id,
      providerId: provider.id,
      policyNumber: POLICY,
      plan: 'Gold',
      validUntil: new Date('2027-12-31'),
    },
  });

  alice = await patientAccount('alice', records[0]);
  bob = await patientAccount('bob', records[1]);
  unlinked = await patientAccount('nobody');
}, 120_000);

afterAll(async () => {
  await clearLabOrders();
  await harness.prisma.patient.updateMany({
    where: { id: { in: records.map((record) => record.id) } },
    data: { userId: null },
  });
  await harness.reset();
  await harness.prisma.patientInsurance.deleteMany({
    where: { patientId: { in: records.map((record) => record.id) } },
  });
  await destroyPatientRecords(harness.prisma, TAG);
  if (createdProviderId !== undefined) {
    await harness.prisma.insuranceProvider.deleteMany({ where: { id: createdProviderId } });
  }
  await harness.close();
});

describe('GET /me/lab-orders', () => {
  it('lists only the caller’s own live, hospital-scoped orders with the contract mapping', async () => {
    const response = await request(harness.server).get(`${PREFIX}/me/lab-orders`).set(as(alice));
    expect(response.status).toBe(200);
    const page = dataOf<{
      items: { id: string; status: string; hospital: unknown; results: unknown; collectedAt: string | null }[];
      totalItems: number;
    }>(response);

    expect(page.totalItems).toBe(3);
    expect(page.items.map((item) => item.id)).toEqual([`${LAB_PREFIX}1`, `${LAB_PREFIX}2`, `${LAB_PREFIX}3`]);
    expect(page.items.map((item) => item.status)).toEqual([
      'awaiting_collection',
      'in_progress',
      'completed',
    ]);
    for (const item of page.items) {
      expect(item.hospital).toEqual({ id: hospitalId, name: 'E2E Fixture Hospital INF' });
      expect(item.results).toEqual({ available: false, reason: 'release_policy_pending' });
      expect(Object.keys(item).sort()).toEqual(
        [
          'id',
          'testName',
          'category',
          'specimenType',
          'status',
          'requestedAt',
          'collectedAt',
          'completedAt',
          'hospital',
          'results',
        ].sort(),
      );
    }
  });

  it('never contains a clinician-only key or value, anywhere in the body', async () => {
    const response = await request(harness.server).get(`${PREFIX}/me/lab-orders`).set(as(alice));
    const keys = collectKeys(response.body);
    for (const key of FORBIDDEN_KEYS) expect(keys.has(key), key).toBe(false);
    const json = JSON.stringify(response.body);
    expect(json).not.toContain('SECRET-');
    expect(json).not.toContain(`${LAB_PREFIX}4`);
    expect(json).not.toContain(`${LAB_PREFIX}5`);
    expect(json).not.toContain(`${LAB_PREFIX}6`);
  });

  it('shows another patient only their own rows', async () => {
    const response = await request(harness.server).get(`${PREFIX}/me/lab-orders`).set(as(bob));
    const page = dataOf<{ items: { id: string; status: string }[] }>(response);
    expect(page.items).toEqual([expect.objectContaining({ id: `${LAB_PREFIX}6`, status: 'cancelled' })]);
  });

  it('pages', async () => {
    const response = await request(harness.server)
      .get(`${PREFIX}/me/lab-orders?page=2&pageSize=2`)
      .set(as(alice));
    const page = dataOf<{ items: { id: string }[]; totalPages: number; page: number }>(response);
    expect(page.page).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.items.map((item) => item.id)).toEqual([`${LAB_PREFIX}3`]);
  });

  it('answers 409 patient_not_linked to an unlinked patient and 403 patient_only to others', async () => {
    const none = await request(harness.server).get(`${PREFIX}/me/lab-orders`).set(as(unlinked));
    expect(none.status).toBe(409);
    expect(errorBody(none).code).toBe('patient_not_linked');

    const staff = await request(harness.server).get(`${PREFIX}/me/lab-orders`).set(as(doctor));
    expect(staff.status).toBe(403);
    expect(errorBody(staff).code).toBe('patient_only');
  });
});

describe('GET /me/insurance', () => {
  it('returns the policy on file with the last four digits only', async () => {
    const response = await request(harness.server).get(`${PREFIX}/me/insurance`).set(as(alice));
    expect(response.status).toBe(200);
    const body = dataOf<{ insurance: Record<string, unknown>; authorizations: unknown }>(response);
    expect(body.insurance).toEqual({
      providerName: expect.any(String) as unknown,
      plan: 'Gold',
      policyNumberLast4: '7665',
      validUntil: '2027-12-31',
      isActive: true,
    });
    expect(body.authorizations).toEqual({ available: false, reason: 'authorization_workflow_undecided' });
    expect(JSON.stringify(response.body)).not.toContain(POLICY);
    expect(JSON.stringify(response.body)).not.toContain('998877');
  });

  it('answers insurance: null for a patient with none, 409 unlinked, 403 non-patient', async () => {
    const none = await request(harness.server).get(`${PREFIX}/me/insurance`).set(as(bob));
    expect(dataOf<{ insurance: unknown }>(none).insurance).toBeNull();

    const unlinkedResponse = await request(harness.server).get(`${PREFIX}/me/insurance`).set(as(unlinked));
    expect(unlinkedResponse.status).toBe(409);
    expect(errorBody(unlinkedResponse).code).toBe('patient_not_linked');

    const staff = await request(harness.server).get(`${PREFIX}/me/insurance`).set(as(doctor));
    expect(staff.status).toBe(403);
    expect(errorBody(staff).code).toBe('patient_only');
  });
});
