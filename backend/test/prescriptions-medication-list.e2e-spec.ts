import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  makeClinicalDoctor,
  markVerified,
  purgeHospitalRecords,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { PrescriptionSweepService } from '../src/modules/pharmacy/services/prescription-sweep.service';

/**
 * The patient's current-medication list (RM M13.6).
 *
 * RM M13.6's verify step is one sentence — "signing an Rx adds a
 * `patient_medications` row" — and it has its own `describe`. The rest
 * is what "materialisation" has to mean if the list is to stay true:
 *
 * · **Only signing materialises.** A draft adds nothing (ADR-002 §1: "it
 *   does not appear in the patient's medication list"), and a refused
 *   signature adds nothing either, because the row is written by the
 *   same transaction the refusal rolls back.
 * · **The list keeps step with the prescription.** Discontinuing marks
 *   the entry `discontinued`; the expiry sweep marks it `completed`. The
 *   two are different acts and the list says which.
 * · **External entries survive.** A medication the patient reported,
 *   with no `prescription_id`, is never touched by any prescription
 *   operation — every lifecycle write filters on the prescription that
 *   owns the row.
 * · **The reader can tell them apart.** `prescriptionId` is `null` for
 *   an external entry, and that distinction is clinical: an Rx-linked
 *   row went through the M13.2 screen at signing and an external one
 *   never did.
 */
let harness: AuthHarness;
let sweeper: PrescriptionSweepService;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const PRESCRIPTIONS = '/api/v1/prescriptions';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface MedicationEntry {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  status: string;
  startDate: string;
  endDate: string | null;
  prescriptionId: string | null;
}

interface Page<T> {
  items: T[];
  totalItems: number;
}

interface PrescriptionView {
  id: string;
  status: string;
}

const createdCharts: string[] = [];
let amoxilId = '';
let eltroxinId = '';

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email);

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

async function seedPatient(token: string): Promise<{ publicId: string; id: string }> {
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
    });

  expect(response.status).toBe(201);
  const publicId = dataOf<{ id: string }>(response).id;
  createdCharts.push(publicId);

  const patient = await harness.prisma.patient.findFirstOrThrow({
    where: { publicId },
    select: { id: true },
  });

  return { publicId, id: patient.id };
}

async function createDraft(
  token: string,
  patientId: string,
  medicationId = amoxilId,
  overrides: Record<string, unknown> = {},
): Promise<PrescriptionView> {
  const response = await request(harness.server)
    .post(PRESCRIPTIONS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      patientId,
      medicationId,
      strength: '500 mg',
      dosage: '1 capsule',
      frequency: 'Three times daily',
      durationDays: 7,
      quantity: 21,
      refillsAllowed: 0,
      instructions: 'Take with food.',
      startDate: '2026-09-14T00:00:00.000Z',
      ...overrides,
    });

  expect(response.status).toBe(201);

  return dataOf<PrescriptionView>(response);
}

function sign(token: string, reference: string, body: Record<string, unknown> = {}) {
  return request(harness.server)
    .post(`${PRESCRIPTIONS}/${reference}/sign`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function medicationList(token: string, patientPublicId: string): Promise<MedicationEntry[]> {
  const response = await request(harness.server)
    .get(`${PATIENTS}/${patientPublicId}/medications?pageSize=100`)
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);

  return dataOf<Page<MedicationEntry>>(response).items;
}

/** A medication the patient reported: no prescription behind it. */
async function giveExternalEntry(patientId: string, name = 'Aspirin (self-reported)'): Promise<void> {
  await harness.prisma.patientMedication.create({
    data: {
      patientId,
      name,
      dosage: '75 mg',
      frequency: 'Once daily',
      startDate: new Date('2024-01-01'),
      status: 'ACTIVE',
    },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('rx-medlist');
  sweeper = harness.app.get(PrescriptionSweepService);

  const byName = async (name: string): Promise<string> =>
    (await harness.prisma.medication.findFirstOrThrow({ where: { name }, select: { id: true } }))
      .id;

  amoxilId = await byName('Amoxil');
  eltroxinId = await byName('Eltroxin');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  /*
   * Cleared by **prescribing doctor**, not only by patient.
   *
   * `harness.reset()` deletes this suite's accounts, and the constraint
   * that refuses that delete is
   * `prescriptions_prescribing_doctor_id_fkey` — an FK to `doctors`, not
   * to `patients`. Deleting by patient therefore clears the rows this
   * suite happens to track and leaves any it does not, and the failure
   * surfaces as an unrelated-looking foreign-key violation inside
   * `reset()`. Narrowing by this suite's own email domain keeps it
   * parallel-safe: it can never reach another file's rows.
   */
  const mine = { prescriber: { user: { email: { endsWith: `@${harness.domain}` } } } };

  await harness.prisma.patientMedication.deleteMany({
    where: { prescription: mine },
  });
  await harness.prisma.prescription.deleteMany({ where: mine });

  if (createdCharts.length > 0) {
    await harness.prisma.patientMedication.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await harness.prisma.prescription.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await purgeHospitalRecords(
      harness.prisma,
      (
        await harness.prisma.patient.findMany({
          where: { publicId: { in: createdCharts } },
          select: { id: true },
        })
      ).map((row) => row.id),
    );
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('RM M13.6 verify — signing an Rx adds a patient_medications row', () => {
  it('adds the row, carrying the prescription’s own dosing', async () => {
    const token = await seedDoctor('medlist-verify');
    const patient = await seedPatient(token);
    const draft = await createDraft(token, patient.publicId);

    // Before: nothing. A draft has not been prescribed (ADR-002 §1).
    expect(await medicationList(token, patient.publicId)).toEqual([]);

    expect((await sign(token, draft.id)).status).toBe(200);

    const after = await medicationList(token, patient.publicId);

    expect(after).toHaveLength(1);
    expect(after[0]?.name).toBe('Amoxil');
    expect(after[0]?.dosage).toBe('1 capsule');
    expect(after[0]?.frequency).toBe('Three times daily');
    expect(after[0]?.status).toBe('active');
    expect(after[0]?.startDate).toBe('2026-09-14');
    expect(after[0]?.endDate).toBe('2026-09-21');
    // Rx-linked, and the list says which prescription.
    expect(after[0]?.prescriptionId).toBe(draft.id);
  });

  it('adds nothing for a draft that is never signed', async () => {
    const token = await seedDoctor('medlist-draft');
    const patient = await seedPatient(token);

    await createDraft(token, patient.publicId);

    expect(await medicationList(token, patient.publicId)).toEqual([]);
  });

  it('adds nothing when the signature is refused', async () => {
    // The row is written by the same transaction the refusal rolls back,
    // so a blocked signature cannot leave a drug on the patient's list.
    const token = await seedDoctor('medlist-refused');
    const patient = await seedPatient(token);
    const draft = await createDraft(token, patient.publicId);

    await harness.prisma.patientAllergy.create({
      data: {
        patientId: patient.id,
        allergen: 'Penicillin',
        severity: 'SEVERE',
        reaction: 'Anaphylaxis',
      },
    });

    expect((await sign(token, draft.id)).status).toBe(409);
    expect(await medicationList(token, patient.publicId)).toEqual([]);
  });

  it('adds a second row when a renewal is signed', async () => {
    const token = await seedDoctor('medlist-renew');
    const patient = await seedPatient(token);
    const first = await createDraft(token, patient.publicId);
    await sign(token, first.id);

    const renewed = dataOf<PrescriptionView>(
      await request(harness.server)
        .post(`${PRESCRIPTIONS}/${first.id}/renew`)
        .set('Authorization', `Bearer ${token}`)
        .send({}),
    );

    // The renewal duplicates the therapy, so the screen reports duplicate
    // therapy — a critical, non-blocking finding that must be
    // acknowledged. That is the screen working, not an obstacle.
    const response = await sign(token, renewed.id, {
      acknowledgedWarningIds: ['safety-duplicate'],
      reason: 'Continuing the same course; the first is ending.',
    });
    expect(response.status).toBe(200);

    const after = await medicationList(token, patient.publicId);

    expect(after).toHaveLength(2);
    expect(after.map((entry) => entry.prescriptionId).sort()).toEqual(
      [first.id, renewed.id].sort(),
    );
  });
});

describe('the list keeps step with the prescription', () => {
  it('marks the entry discontinued when the therapy is stopped', async () => {
    const token = await seedDoctor('medlist-stop');
    const patient = await seedPatient(token);
    const draft = await createDraft(token, patient.publicId);
    await sign(token, draft.id);

    await request(harness.server)
      .post(`${PRESCRIPTIONS}/${draft.id}/discontinue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Rash developed on day two.' });

    const after = await medicationList(token, patient.publicId);

    expect(after[0]?.status).toBe('discontinued');
  });

  it('marks the entry completed when the course expires', async () => {
    const token = await seedDoctor('medlist-expire');
    const patient = await seedPatient(token);
    const draft = await createDraft(token, patient.publicId, amoxilId, {
      startDate: '2025-06-01T00:00:00.000Z',
      durationDays: 5,
    });
    await sign(token, draft.id);

    // Clock-controlled, as M13.5's job is: the course ended 2025-06-06.
    // Dated to 2025 for the reason `prescriptions-sweep.e2e-spec.ts`
    // records: the sweep selects across the whole table, so a 2026 clock
    // here would expire another spec's fixtures mid-run.
    await sweeper.sweep(new Date('2025-06-30T09:00:00.000Z'));

    const after = await medicationList(token, patient.publicId);

    // `completed`, not `discontinued`: the course ran its length, which
    // is not the same act as someone deciding to stop it. The list has
    // to be able to tell a clinician which happened.
    expect(after[0]?.status).toBe('completed');
  });
});

describe('external entries', () => {
  it('serves them alongside Rx-linked ones, distinguishable by the link', async () => {
    const token = await seedDoctor('medlist-external');
    const patient = await seedPatient(token);

    await giveExternalEntry(patient.id);
    const draft = await createDraft(token, patient.publicId);
    await sign(token, draft.id);

    const after = await medicationList(token, patient.publicId);

    expect(after).toHaveLength(2);

    const external = after.find((entry) => entry.prescriptionId === null);
    const linked = after.find((entry) => entry.prescriptionId !== null);

    expect(external?.name).toBe('Aspirin (self-reported)');
    expect(linked?.prescriptionId).toBe(draft.id);

    // The distinction is clinical: the linked row went through the M13.2
    // screen at signing, and the external one never did.
    expect(external?.prescriptionId).toBeNull();
  });

  it('leaves an external entry alone when a prescription is discontinued', async () => {
    const token = await seedDoctor('medlist-external-stop');
    const patient = await seedPatient(token);

    await giveExternalEntry(patient.id);
    const draft = await createDraft(token, patient.publicId);
    await sign(token, draft.id);

    await request(harness.server)
      .post(`${PRESCRIPTIONS}/${draft.id}/discontinue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Switched to a different antibiotic.' });

    const after = await medicationList(token, patient.publicId);
    const external = after.find((entry) => entry.prescriptionId === null);

    // Every lifecycle write filters on the prescription that owns the
    // row, so a drug the clinic never prescribed cannot be stopped by
    // stopping one it did.
    expect(external?.status).toBe('active');
  });

  it('leaves an external entry alone when the sweep expires a prescription', async () => {
    const token = await seedDoctor('medlist-external-sweep');
    const patient = await seedPatient(token);

    await giveExternalEntry(patient.id, 'Vitamin D (self-reported)');
    const draft = await createDraft(token, patient.publicId, eltroxinId, {
      strength: '50 mcg',
      startDate: '2025-06-01T00:00:00.000Z',
      durationDays: 5,
    });
    await sign(token, draft.id);

    await sweeper.sweep(new Date('2025-06-30T09:00:00.000Z'));

    const after = await medicationList(token, patient.publicId);
    const external = after.find((entry) => entry.prescriptionId === null);

    expect(external?.status).toBe('active');
    expect(external?.name).toBe('Vitamin D (self-reported)');
  });
});

describe('the profile summary card', () => {
  it('carries the same provenance as the tab', async () => {
    const token = await seedDoctor('medlist-profile');
    const patient = await seedPatient(token);

    await giveExternalEntry(patient.id);
    const draft = await createDraft(token, patient.publicId);
    await sign(token, draft.id);

    const profile = dataOf<{ medications: MedicationEntry[] }>(
      await request(harness.server)
        .get(`${PATIENTS}/${patient.publicId}/profile`)
        .set('Authorization', `Bearer ${token}`),
    );

    // The card shows only active entries, and both of these are.
    expect(profile.medications).toHaveLength(2);
    expect(profile.medications.some((entry) => entry.prescriptionId === draft.id)).toBe(true);
    expect(profile.medications.some((entry) => entry.prescriptionId === null)).toBe(true);
  });
});
