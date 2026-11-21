import request from 'supertest';
import { expect } from 'vitest';

import {
  type AuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './auth-app';

/**
 * The lab suite's shared plumbing (RM M14).
 *
 * Four e2e files drive the same pipeline — order, collect, process,
 * result, review — and by the time one of them can assert anything about
 * a critical value there is a doctor, a patient, a care assignment, an
 * order, a specimen and a batch of results behind it. Building that
 * inline in every case buries the assertion; building it differently in
 * each file makes a shared failure read as four unrelated ones.
 *
 * Everything created carries the caller's suite tag, so the cleanup at
 * the end of a file deletes exactly what that file made and two lab
 * suites can run against one database without colliding. That matters
 * more here than elsewhere: Vitest runs files in parallel, and
 * `GET /lab-orders/summary` counts across the caller's whole scope —
 * so a suite whose fixtures leaked into another's doctor would change
 * that doctor's counts mid-run.
 */

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
export const LAB_ORDERS = '/api/v1/lab-orders';
export const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

export interface LabResultItemView {
  id: string;
  analyte: string;
  value: string;
  numericValue: number | null;
  unit: string;
  referenceRange: { low: number | null; high: number | null; text: string };
  flag: string;
  resultedAt: string;
}

export interface LabOrderView {
  id: string;
  patient: { id: string; name: string; mrn: string; age: number };
  testName: string;
  testCode: string;
  category: string;
  department: string | null;
  orderedBy: string;
  clinicalIndication: string;
  status: string;
  priority: string;
  requestedDate: string;
  collectedDate: string | null;
  completedDate: string | null;
  hasCriticalResult: boolean;
  resultSummary: { total: number; abnormal: number; critical: number };
  reviewStatus: string;
  review: { reviewedAt: string; reviewedBy: string } | null;
  specimen: {
    type: string;
    container: string;
    collectionSite: string;
    collectedBy: string;
    collectedAt: string;
    receivedAt: string | null;
    condition: string;
    volume: string;
  } | null;
  results: LabResultItemView[];
  interpretation: string | null;
  attachments: { id: string; name: string; kind: string; sizeKb: number }[];
  timeline: { id: string; kind: string; at: string; actor: string; detail: string }[];
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/**
 * A verified, logged-in doctor.
 *
 * Every lab suite needs at least two — one who owns the chart and one
 * who does not — because the care-scope assertions are only meaningful
 * against a real second clinician.
 */
export async function seedDoctor(harness: AuthHarness, local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

/**
 * A patient chart, created by this doctor — which is what establishes
 * the care assignment every read is scoped by.
 */
export async function seedPatient(
  harness: AuthHarness,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; name: string; mrn: string }> {
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

  // `PatientView` spells the name `fullName`; the lab order's own
  // snapshot spells it `name` (`LabPatientSnapshot`, the frontend's).
  // The fixture speaks the identity-check's vocabulary, which is §8.9's
  // `confirmedPatient.name`.
  const created = dataOf<{ id: string; fullName: string; mrn: string }>(response);

  return { id: created.id, name: created.fullName, mrn: created.mrn };
}

export function post(
  harness: AuthHarness,
  token: string,
  path: string,
  body: Record<string, unknown> = {},
): request.Test {
  return request(harness.server)
    .post(`${LAB_ORDERS}${path}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

export function get(harness: AuthHarness, token: string, path: string): request.Test {
  return request(harness.server)
    .get(`${LAB_ORDERS}${path}`)
    .set('Authorization', `Bearer ${token}`);
}

/** §8.4 — place an order for the Basic Metabolic Panel unless told otherwise. */
export async function orderTest(
  harness: AuthHarness,
  token: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<LabOrderView> {
  const response = await post(harness, token, '', {
    patientId,
    testCode: '51990-0',
    priority: 'routine',
    clinicalIndication: 'Hypertension follow-up; check electrolytes and renal function.',
    ...overrides,
  });

  expect(response.status).toBe(201);

  return dataOf<LabOrderView>(response);
}

/** The specimen body §8.5 requires on the `collected` move. */
export function specimenBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'Serum',
    container: 'SST (gold top)',
    collectionSite: 'Left antecubital fossa',
    volume: '5 mL',
    condition: 'Acceptable',
    ...overrides,
  };
}

/** Drives an order to `processing`, which is where results may be entered. */
export async function toProcessing(
  harness: AuthHarness,
  token: string,
  reference: string,
  specimen: Record<string, unknown> = specimenBody(),
): Promise<LabOrderView> {
  const collected = await post(harness, token, `/${reference}/transition`, {
    to: 'collected',
    specimen,
  });
  expect(collected.status).toBe(200);

  const processing = await post(harness, token, `/${reference}/transition`, {
    to: 'processing',
  });
  expect(processing.status).toBe(200);

  return dataOf<LabOrderView>(processing);
}

/**
 * Removes a suite's lab fixtures.
 *
 * Order matters: `lab_orders` is RESTRICT on both the patient and the
 * doctor (DB §9), so the orders go before the chart — which is the
 * deletion policy working as designed rather than an inconvenience.
 * `lab_results`, `lab_specimens`, `lab_attachments` and
 * `lab_timeline_events` all CASCADE from the order and need no line here.
 */
export async function destroyLabFixtures(
  harness: AuthHarness,
  patientPublicIds: readonly string[],
): Promise<void> {
  if (patientPublicIds.length === 0) return;

  const patients = { publicId: { in: [...patientPublicIds] } };
  const owned = { patient: patients };

  // The `files` rows these attachments cite, collected before anything
  // is deleted: `files` is RESTRICT from both attachment tables, so the
  // citing rows have to go first and the file ids are unreachable once
  // they have.
  const labFiles = await harness.prisma.labAttachment.findMany({
    where: { order: owned },
    select: { fileId: true },
  });
  const recordFiles = await harness.prisma.recordAttachment.findMany({
    where: { record: owned },
    select: { fileId: true },
  });

  await harness.prisma.recordAttachment.deleteMany({ where: { record: owned } });
  await harness.prisma.labAttachment.deleteMany({ where: { order: owned } });
  await harness.prisma.labOrder.deleteMany({ where: owned });
  await harness.prisma.medicalRecord.deleteMany({ where: owned });
  await harness.prisma.patient.deleteMany({ where: patients });

  const fileIds = [...new Set([...labFiles, ...recordFiles].map((row) => row.fileId))];
  if (fileIds.length > 0) {
    // `deleteMany` on the base client, not `db`: the soft-delete
    // extension would leave the row in place, and a test database that
    // accumulates a file per run is one whose `files` table grows
    // without bound.
    await harness.prisma.file.deleteMany({ where: { id: { in: fileIds } } });
  }
}
