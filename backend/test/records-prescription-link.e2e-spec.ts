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
import { PrescriptionSweepService } from '../src/modules/pharmacy/services/prescription-sweep.service';

/**
 * Record ↔ prescription linkage (RM M15.2).
 *
 * RM M15.2's verify step is "prescribing from a record links both
 * ways", and the two ways were not symmetric before this milestone.
 * `prescriptions.record_id` has been written since M13.3 — §7.6 accepts
 * an `MR-…` handle and the prescription's own view has always carried
 * `recordId`. The **record** knew nothing: `record_medications` existed,
 * carried a `prescription_id` column, and no code ever set it. So the
 * link read one way, from the prescription to the visit, and the chart —
 * which is the surface a clinician actually opens — could not say what
 * was prescribed at the encounter.
 *
 * Four properties make the link true rather than merely present, and
 * each has its own `describe`:
 *
 * · **Signing materialises the record entry**, in the signing
 *   transaction, exactly as M13.6's `patient_medications` row is. A
 *   draft materialises nothing, because a draft has prescribed nothing
 *   (ADR-002 §1), and a refused signature materialises nothing because
 *   the write is rolled back with the refusal.
 * · **The entry keeps step with the prescription.** Discontinuing marks
 *   it `discontinued`; the expiry sweep marks it `completed`. Different
 *   acts, and the chart says which — the same distinction M13.6 keeps
 *   on the patient's list.
 * · **A hand-documented medication is never touched**, the rule M13.6
 *   established for externally reported drugs, applied on this side.
 * · **A narrative edit cannot delete an Rx-linked entry.** This is the
 *   defect the milestone actually closes: §6.4's `medications` array
 *   replaces the encounter's medication list, and replacing it used to
 *   soft-delete *every* row — so correcting one typed line would drop
 *   the prescribed drugs out of the chart while the prescription still
 *   pointed back at the record. An Rx-linked row leaves the chart by
 *   discontinuing the prescription, an act with a reason and an audit
 *   entry; a typo fix has neither.
 */
let harness: AuthHarness;
let sweeper: PrescriptionSweepService;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';
const PRESCRIPTIONS = '/api/v1/prescriptions';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface RecordMedicationView {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  instructions: string | null;
  status: string;
  prescriptionId: string | null;
}

interface RecordTimelineView {
  id: string;
  kind: string;
  at: string;
  actor: string;
  detail: string;
}

interface RecordDetailView {
  id: string;
  medications: RecordMedicationView[];
  timeline: RecordTimelineView[];
}

interface PrescriptionView {
  id: string;
  status: string;
  recordId: string | null;
}

const createdCharts: string[] = [];
let amoxilId = '';

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

async function seedPatient(token: string): Promise<string> {
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

  return publicId;
}

async function createRecord(
  token: string,
  patientId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(harness.server)
    .post(RECORDS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      patientId,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Hypertension review',
      historyOfPresentIllness: 'Stable on current therapy.',
      physicalExamination: 'BP 128/78. No oedema.',
      ...body,
    });

  expect(response.status).toBe(201);

  return dataOf<{ id: string }>(response).id;
}

async function readRecord(token: string, recordId: string): Promise<RecordDetailView> {
  const response = await request(harness.server)
    .get(`${RECORDS}/${recordId}`)
    .set('Authorization', `Bearer ${token}`);

  expect(response.status).toBe(200);

  return dataOf<RecordDetailView>(response);
}

async function createDraft(
  token: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<PrescriptionView> {
  const response = await request(harness.server)
    .post(PRESCRIPTIONS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      patientId,
      medicationId: amoxilId,
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

/** Signs a prescription written against `recordId`, and returns both. */
async function prescribeFromRecord(
  token: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ recordId: string; prescription: PrescriptionView }> {
  const recordId = await createRecord(token, patientId);
  const draft = await createDraft(token, patientId, { recordId, ...overrides });

  expect((await sign(token, draft.id)).status).toBe(200);

  return { recordId, prescription: draft };
}

beforeAll(async () => {
  harness = await createAuthHarness('rx-record-link', { clinicalDoctors: true });
  sweeper = harness.app.get(PrescriptionSweepService);

  amoxilId = (
    await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Amoxil' },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    const owned = { patient: { publicId: { in: createdCharts } } };

    await harness.prisma.patientMedication.deleteMany({ where: owned });
    // `record_medications` CASCADE from the record, so deleting the
    // records takes them; the prescriptions have to go first because
    // `record_medications.prescription_id` is SET NULL rather than
    // CASCADE and the rows would otherwise outlive nothing.
    await harness.prisma.prescription.deleteMany({ where: owned });
    await harness.prisma.medicalRecord.deleteMany({ where: owned });
    await deletePatients(harness.prisma, {
      where: { publicId: { in: createdCharts } },
    });
  }

  await harness.reset();
  await harness.close();
});

describe('RM M15.2 verify — prescribing from a record links both ways', () => {
  it('links the prescription to the visit and the visit to the prescription', async () => {
    const token = await seedDoctor('link-verify');
    const patient = await seedPatient(token);
    const { recordId, prescription } = await prescribeFromRecord(token, patient);

    // Way one — the prescription names the visit. This half has worked
    // since M13.3; it is asserted here so the pair is proven together
    // rather than in two files that could drift apart.
    const detail = dataOf<PrescriptionView>(
      await request(harness.server)
        .get(`${PRESCRIPTIONS}/${prescription.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
    expect(detail.recordId).toBe(recordId);

    // Way two — the visit names the prescription. This half is M15.2.
    const record = await readRecord(token, recordId);

    expect(record.medications).toHaveLength(1);
    expect(record.medications[0]).toMatchObject({
      name: 'Amoxil',
      dosage: '1 capsule',
      frequency: 'Three times daily',
      instructions: 'Take with food.',
      status: 'active',
      prescriptionId: prescription.id,
    });
  });

  it('writes medication-prescribed on the record’s own timeline', async () => {
    // A drug that appeared in a chart with no timeline entry is the
    // same defect as an attachment that did (§8.9's `attachment-added`):
    // the document changed and the reader cannot see when, or by whom.
    // This is also the first writer of the kind — the enum has carried
    // `medication-prescribed` since M5.7 with nothing producing it.
    const token = await seedDoctor('link-timeline');
    const patient = await seedPatient(token);
    const { recordId } = await prescribeFromRecord(token, patient);

    const record = await readRecord(token, recordId);
    const event = record.timeline.find((entry) => entry.kind === 'medication-prescribed');

    expect(event).toBeDefined();
    expect(event?.detail).toBe('Amoxil — 1 capsule, Three times daily');
    // Attributed to the prescriber, not to "System": somebody signed it.
    expect(event?.actor).not.toBe('System');
  });
});

describe('only a signature materialises the record entry', () => {
  it('adds nothing while the prescription is a draft', async () => {
    // ADR-002 §1 — a draft has prescribed nothing. An entry created at
    // §7.6 would put a drug in the chart that nobody has authorised.
    const token = await seedDoctor('link-draft');
    const patient = await seedPatient(token);
    const recordId = await createRecord(token, patient);

    const draft = await createDraft(token, patient, { recordId });
    expect(draft.recordId).toBe(recordId);

    expect((await readRecord(token, recordId)).medications).toEqual([]);
  });

  it('adds nothing when the signature is refused', async () => {
    // The write is in the signing transaction, so a refusal rolls it
    // back rather than leaving a drug in the chart that was never
    // prescribed. Penicillin against a recorded Penicillin allergy is
    // the refusal with no override path (§7.7).
    const token = await seedDoctor('link-refused');
    const response = await request(harness.server)
      .post(PATIENTS)
      .set('Authorization', `Bearer ${token}`)
      .send({
        fullName: 'Layla Morsi',
        dateOfBirth: '1988-04-12',
        gender: 'female',
        bloodType: 'A+',
        phone: '+20 100 777 1234',
        allergies: [{ allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' }],
        chronicConditions: [],
      });

    expect(response.status).toBe(201);
    const patient = dataOf<{ id: string }>(response).id;
    createdCharts.push(patient);

    const recordId = await createRecord(token, patient);
    const draft = await createDraft(token, patient, { recordId });

    const refused = await sign(token, draft.id);
    expect(refused.status).toBe(409);

    expect((await readRecord(token, recordId)).medications).toEqual([]);
  });

  it('adds nothing to any record when the prescription names none', async () => {
    // The ordinary case: a prescription written from the pharmacy
    // screen rather than from inside an encounter belongs to no visit.
    const token = await seedDoctor('link-unbound');
    const patient = await seedPatient(token);
    const recordId = await createRecord(token, patient);

    const draft = await createDraft(token, patient);
    expect(draft.recordId).toBeNull();
    expect((await sign(token, draft.id)).status).toBe(200);

    expect((await readRecord(token, recordId)).medications).toEqual([]);
  });
});

describe('the record entry keeps step with the prescription', () => {
  it('marks it discontinued when therapy is stopped', async () => {
    const token = await seedDoctor('link-stop');
    const patient = await seedPatient(token);
    const { recordId, prescription } = await prescribeFromRecord(token, patient);

    await request(harness.server)
      .post(`${PRESCRIPTIONS}/${prescription.id}/discontinue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Rash on day three; switching agent.' })
      .expect(200);

    const record = await readRecord(token, recordId);

    expect(record.medications).toHaveLength(1);
    expect(record.medications[0]?.status).toBe('discontinued');
    // Still linked: the chart says which prescription was stopped.
    expect(record.medications[0]?.prescriptionId).toBe(prescription.id);
  });

  it('marks it completed when the course runs its length', async () => {
    // `completed`, not `discontinued`. The course ran out; nobody
    // decided to stop it, and the chart keeps the two apart — the same
    // distinction M13.6 keeps on the patient's list.
    const token = await seedDoctor('link-sweep');
    const patient = await seedPatient(token);
    const { recordId } = await prescribeFromRecord(token, patient, {
      startDate: '2025-01-06T00:00:00.000Z',
      durationDays: 7,
    });

    // Clock-controlled, as M13.5's job is, and dated to 2025 for the
    // reason `prescriptions-sweep.e2e-spec.ts` records: the sweep
    // selects across the whole table, so a 2026 clock here would expire
    // another spec's fixtures mid-run. January is earlier than every
    // other sweeping spec's fixtures, so this one cannot reach them.
    await sweeper.sweep(new Date('2025-03-01T00:00:00.000Z'));

    const record = await readRecord(token, recordId);

    expect(record.medications).toHaveLength(1);
    expect(record.medications[0]?.status).toBe('completed');
  });
});

describe('a hand-documented medication is nobody’s to move', () => {
  it('survives a discontinuation of an unrelated prescription', async () => {
    // M13.6's rule, applied on this side: every lifecycle write filters
    // on the prescription that owns the row, so a drug the clinician
    // typed into the encounter — never screened by §7.5 — is untouched.
    const token = await seedDoctor('link-manual');
    const patient = await seedPatient(token);
    const recordId = await createRecord(token, patient, {
      medications: [
        {
          name: 'Aspirin (patient-reported)',
          dosage: '75 mg',
          frequency: 'Once daily',
          status: 'active',
        },
      ],
    });

    const draft = await createDraft(token, patient, { recordId });
    expect((await sign(token, draft.id)).status).toBe(200);

    await request(harness.server)
      .post(`${PRESCRIPTIONS}/${draft.id}/discontinue`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Course completed early.' })
      .expect(200);

    const record = await readRecord(token, recordId);
    const manual = record.medications.find((entry) => entry.prescriptionId === null);
    const linked = record.medications.find((entry) => entry.prescriptionId === draft.id);

    expect(manual?.name).toBe('Aspirin (patient-reported)');
    expect(manual?.status).toBe('active');
    expect(linked?.status).toBe('discontinued');
  });

  it('tells the reader which entries went through the safety screen', async () => {
    // The distinction is clinical, not bookkeeping: an Rx-linked row
    // was screened for allergies and interactions at signing, and a
    // typed one never was. A list rendering both identically invites a
    // reader to assume the same assurance behind each.
    const token = await seedDoctor('link-provenance');
    const patient = await seedPatient(token);
    const recordId = await createRecord(token, patient, {
      medications: [
        { name: 'Vitamin D', dosage: '1000 IU', frequency: 'Once daily', status: 'active' },
      ],
    });

    const draft = await createDraft(token, patient, { recordId });
    expect((await sign(token, draft.id)).status).toBe(200);

    const record = await readRecord(token, recordId);

    expect(record.medications.map((entry) => [entry.name, entry.prescriptionId]).sort()).toEqual([
      ['Amoxil', draft.id],
      ['Vitamin D', null],
    ]);
  });
});

describe('a narrative edit cannot delete a prescribed medication (§6.4)', () => {
  it('replaces only what the author documented', async () => {
    // The defect this milestone closes. Before M15.2 the `medications`
    // array replaced the whole list, so this edit would have dropped
    // Amoxil out of the chart while `prescriptions.record_id` still
    // pointed at the record — the link would read one way only.
    const token = await seedDoctor('link-edit');
    const patient = await seedPatient(token);
    const recordId = await createRecord(token, patient, {
      medications: [
        { name: 'Vitamn D', dosage: '1000 IU', frequency: 'Once daily', status: 'active' },
      ],
    });

    const draft = await createDraft(token, patient, { recordId });
    expect((await sign(token, draft.id)).status).toBe(200);

    // Correcting the typo in the one line the author typed.
    await request(harness.server)
      .patch(`${RECORDS}/${recordId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        medications: [
          { name: 'Vitamin D', dosage: '1000 IU', frequency: 'Once daily', status: 'active' },
        ],
      })
      .expect(200);

    const record = await readRecord(token, recordId);
    const names = record.medications.map((entry) => entry.name).sort();

    expect(names).toEqual(['Amoxil', 'Vitamin D']);
    expect(record.medications.find((entry) => entry.name === 'Amoxil')?.prescriptionId).toBe(
      draft.id,
    );
  });

  it('still lets the author clear their own entries', async () => {
    // The protection must not over-reach into "you may never remove a
    // medication line again": an empty array clears what was typed.
    const token = await seedDoctor('link-clear');
    const patient = await seedPatient(token);
    const recordId = await createRecord(token, patient, {
      medications: [
        { name: 'Vitamin D', dosage: '1000 IU', frequency: 'Once daily', status: 'active' },
      ],
    });

    const draft = await createDraft(token, patient, { recordId });
    expect((await sign(token, draft.id)).status).toBe(200);

    await request(harness.server)
      .patch(`${RECORDS}/${recordId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ medications: [] })
      .expect(200);

    const record = await readRecord(token, recordId);

    expect(record.medications).toHaveLength(1);
    expect(record.medications[0]?.name).toBe('Amoxil');
  });
});
