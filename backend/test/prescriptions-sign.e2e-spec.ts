import request from 'supertest';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  purgeHospitalRecords,
  registrationBody,
  testEmail,
  soleRecordOf,
  clinicalStampFor,
} from './support/auth-app';

/**
 * Create a draft, then sign it (RM M13.3 — API §7.6, §7.7).
 *
 * The verify step names four things, and each has its own `describe`:
 * the three 409 branches, and a chaos test proving that with the
 * interaction source disabled **send is impossible but draft save
 * works**.
 *
 * What makes those four worth an end-to-end test rather than a unit one:
 *
 * · **A refusal must write nothing.** The screen runs inside the signing
 *   transaction, so every refusal throws out of it. Each 409 case
 *   re-reads the prescription and asserts it is still a `draft` with no
 *   timeline event and no `patient_medications` row — the states a
 *   partially-applied signature would leave behind.
 * · **`allergy_conflict` has no override.** Sending the acknowledgment
 *   fields that clear the *other* branch must not clear this one, and a
 *   spec asserts exactly that, because "no override path exists" is only
 *   true if nothing in the request body is one.
 * · **An acknowledgment without a reason is not an acknowledgment.**
 * · **The re-run is authoritative.** A conflict introduced *after* the
 *   advisory §7.5 answer came back still stops the signature.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const PRESCRIPTIONS = '/api/v1/prescriptions';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface WarningView {
  id: string;
  kind: string;
  severity: string;
  title: string;
  detail: string;
  acknowledgedReason: string | null;
  acknowledgedAt: string | null;
}

interface PrescriptionDetailView {
  id: string;
  status: string;
  signedAt: string | null;
  refillsAllowed: number;
  refillsRemaining: number;
  refillStatus: string;
  startDate: string;
  endDate: string;
  durationDays: number;
  duration: string;
  medication: { id: string; name: string; strength: string; isControlled: boolean };
  patient: { id: string; name: string; allergies: string[]; hasSevereAllergy: boolean };
  warnings: WarningView[];
  timeline: { kind: string; actor: string; detail: string }[];
  notes: unknown[];
  history: unknown[];
}

const createdCharts: string[] = [];

let amoxilId = '';
let coumadinId = '';
let eltroxinId = '';

async function seedDoctor(local: string, hospital = 'a'): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at a fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email, await fixtureHospital(harness.prisma, hospital));

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

async function seedPatient(
  token: string,
  allergies: { allergen: string; severity: string; reaction: string }[] = [],
): Promise<string> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Layla Morsi',
      dateOfBirth: '1988-04-12',
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 100 777 1234',
      allergies,
      chronicConditions: [],
    });

  expect(response.status).toBe(201);

  const id = dataOf<{ id: string }>(response).id;
  createdCharts.push(id);

  return id;
}

function draftBody(patientId: string, medicationId: string, overrides: Record<string, unknown> = {}) {
  return {
    patientId,
    medicationId,
    strength: '500 mg',
    dosage: '1 capsule',
    frequency: 'Three times daily',
    durationDays: 7,
    quantity: 21,
    refillsAllowed: 0,
    instructions: 'Take with food. Complete the course.',
    startDate: '2026-09-14T00:00:00.000Z',
    ...overrides,
  };
}

async function createDraft(
  token: string,
  patientId: string,
  medicationId: string,
  overrides: Record<string, unknown> = {},
): Promise<PrescriptionDetailView> {
  const response = await request(harness.server)
    .post(PRESCRIPTIONS)
    .set('Authorization', `Bearer ${token}`)
    .send(draftBody(patientId, medicationId, overrides));

  expect(response.status).toBe(201);

  return dataOf<PrescriptionDetailView>(response);
}

function sign(token: string, reference: string, body: Record<string, unknown> = {}) {
  return request(harness.server)
    .post(`${PRESCRIPTIONS}/${reference}/sign`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function detail(token: string, reference: string) {
  return request(harness.server)
    .get(`${PRESCRIPTIONS}/${reference}`)
    .set('Authorization', `Bearer ${token}`);
}

/** Everything a refused signature must NOT have left behind. */
async function expectUntouchedDraft(token: string, reference: string): Promise<void> {
  const view = dataOf<PrescriptionDetailView>(await detail(token, reference));

  expect(view.status).toBe('draft');
  expect(view.signedAt).toBeNull();
  // No `prescribed` event: the prescription was never prescribed.
  expect(view.timeline).toEqual([]);
  // No warning rows either — the screen ran inside the transaction that
  // rolled back, so even its findings are gone.
  expect(view.warnings).toEqual([]);

  const medications = await harness.prisma.patientMedication.count({
    where: { prescription: { publicId: reference } },
  });
  expect(medications).toBe(0);
}

async function livePrescriptionFor(
  patientPublicId: string,
  medicationId: string,
  token: string,
): Promise<void> {
  const patient = await harness.prisma.patient.findFirstOrThrow({
    where: { publicId: patientPublicId },
    select: { id: true },
  });
  const me = dataOf<{ doctor: { id: string } | null }>(
    await request(harness.server).get('/api/v1/me/profile').set('Authorization', `Bearer ${token}`),
  );
  // `/me/profile` nests the practitioner under `doctor`; it has no
  // top-level `id`. This lookup used to read `me.id`, which is undefined,
  // and Prisma drops an undefined filter — so it matched whichever doctor
  // the shared table returned first, and the prescriptions below were
  // written against another suite's doctor, failing that suite's teardown
  // on `prescriptions_prescribing_doctor_id_fkey`.
  if (me.doctor === null) throw new Error('The signed-in account has no doctor profile');
  const doctor = { id: me.doctor.id };

  await harness.prisma.prescription.create({
    data: {
      ...(await clinicalStampFor(harness.prisma, doctor.id, patient.id)),
      publicId: `RX-X${String(Date.now() % 100_000)}${String(Math.floor(Math.random() * 1000))}`,
      patientId: patient.id,
      medicationId,
      prescribingDoctorId: doctor.id,
      strength: '5 mg',
      dosage: '1 tablet',
      frequency: 'Once daily',
      route: 'ORAL',
      durationDays: 30,
      quantity: 30,
      instructions: 'As directed.',
      status: 'ACTIVE',
      signedAt: new Date(),
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-10-01'),
    },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('rx-sign');

  const byName = async (name: string): Promise<string> =>
    (await harness.prisma.medication.findFirstOrThrow({ where: { name }, select: { id: true } }))
      .id;

  amoxilId = await byName('Amoxil');
  coumadinId = await byName('Coumadin');
  eltroxinId = await byName('Eltroxin');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.patientMedication.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await harness.prisma.prescription.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    const charts = await harness.prisma.patient.findMany({
      where: { publicId: { in: createdCharts } },
      select: { id: true },
    });
    await purgeHospitalRecords(
      harness.prisma,
      charts.map((row) => row.id),
    );
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('POST /prescriptions (§7.6) — the draft', () => {
  it('creates a draft that has not been prescribed by anyone', async () => {
    const token = await seedDoctor('draft-create');
    const patientId = await seedPatient(token);

    const view = await createDraft(token, patientId, amoxilId);

    expect(view.id).toMatch(/^RX-\d+$/);
    expect(view.status).toBe('draft');
    // ADR-002 §1: a draft carries no signature, no timeline event, and
    // does not appear in the patient's medication list.
    expect(view.signedAt).toBeNull();
    expect(view.timeline).toEqual([]);

    const medications = await harness.prisma.patientMedication.count({
      where: { prescription: { publicId: view.id } },
    });
    expect(medications).toBe(0);
  });

  it('derives the end date from the start date and the duration', async () => {
    const token = await seedDoctor('draft-dates');
    const patientId = await seedPatient(token);

    const view = await createDraft(token, patientId, amoxilId, { durationDays: 10 });

    expect(view.startDate).toBe('2026-09-14');
    expect(view.endDate).toBe('2026-09-24');
    expect(view.duration).toBe('10 days');
  });

  it('refuses a strength the catalogue does not dispense', async () => {
    const token = await seedDoctor('draft-strength');
    const patientId = await seedPatient(token);

    const response = await request(harness.server)
      .post(PRESCRIPTIONS)
      .set('Authorization', `Bearer ${token}`)
      .send(draftBody(patientId, amoxilId, { strength: '900 mg' }));

    // A free-text strength is how "500mg" and "500 mg" end up on two
    // prescriptions for one drug, and how a strength nobody stocks
    // reaches a pharmacy.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
  });

  it('refuses a non-positive quantity and a zero duration', async () => {
    const token = await seedDoctor('draft-bounds');
    const patientId = await seedPatient(token);

    for (const override of [{ quantity: 0 }, { durationDays: 0 }]) {
      const response = await request(harness.server)
        .post(PRESCRIPTIONS)
        .set('Authorization', `Bearer ${token}`)
        .send(draftBody(patientId, amoxilId, override));

      expect(response.status).toBe(422);
    }
  });

  it('saves a draft even when the patient is allergic to the drug', async () => {
    // The gate is on signing, not on drafting. Refusing to save would
    // lose the clinician's work without preventing any harm.
    const token = await seedDoctor('draft-allergic');
    const patientId = await seedPatient(token, [
      { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
    ]);

    const view = await createDraft(token, patientId, amoxilId);

    expect(view.status).toBe('draft');
  });

  it('refuses a patient outside the caller’s care with 404', async () => {
    const owner = await seedDoctor('draft-owner');
    // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
    const stranger = await seedDoctor('draft-stranger', 'b');
    const patientId = await seedPatient(owner);

    const response = await request(harness.server)
      .post(PRESCRIPTIONS)
      .set('Authorization', `Bearer ${stranger}`)
      .send(draftBody(patientId, amoxilId));

    expect(response.status).toBe(404);
  });
});

describe('POST /prescriptions/{id}/sign (§7.7) — the clean path', () => {
  it('signs a prescription with no findings, and prescribes it', async () => {
    const token = await seedDoctor('sign-clean');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId, amoxilId, { refillsAllowed: 2 });

    const response = await sign(token, draft.id);

    expect(response.status).toBe(200);

    const view = dataOf<PrescriptionDetailView>(response);

    expect(view.status).toBe('active');
    expect(view.signedAt).not.toBeNull();
    // The allowance becomes the remaining count at the moment of
    // authorisation, not at creation.
    expect(view.refillsRemaining).toBe(2);
    expect(view.refillStatus).toBe('available');

    // The timeline starts when the prescription does.
    expect(view.timeline).toHaveLength(1);
    expect(view.timeline[0]?.kind).toBe('prescribed');
    expect(view.timeline[0]?.detail).toContain('Amoxil');
  });

  it('sends a controlled medication to pending-approval instead', async () => {
    const token = await seedDoctor('sign-controlled');
    const patientId = await seedPatient(token);

    await harness.prisma.medication.update({
      where: { id: eltroxinId },
      data: { isControlled: true },
    });

    try {
      const draft = await createDraft(token, patientId, eltroxinId, { strength: '50 mcg' });
      const view = dataOf<PrescriptionDetailView>(await sign(token, draft.id));

      expect(view.status).toBe('pending-approval');
      // ADR-002 §3 reaches `pending-approval` from `draft` through
      // `/sign`, so it is a *signed* prescription awaiting a second
      // decision — the CHECK requires the signature.
      expect(view.signedAt).not.toBeNull();
    } finally {
      await harness.prisma.medication.update({
        where: { id: eltroxinId },
        data: { isControlled: false },
      });
    }
  });

  it('refuses to sign an already-signed prescription', async () => {
    const token = await seedDoctor('sign-twice');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId, amoxilId);

    expect((await sign(token, draft.id)).status).toBe(200);

    const second = await sign(token, draft.id);

    // "Already signed" is a state problem, not a clinical one, and a
    // client must be able to tell them apart.
    expect(second.status).toBe(409);
    expect(errorBody(second).code).toBe('invalid_status_transition');
  });
});

describe('409 branch 1 — allergy_conflict, with no override path', () => {
  it('refuses the signature and leaves the draft untouched', async () => {
    const token = await seedDoctor('sign-allergy');
    const patientId = await seedPatient(token, [
      { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
    ]);
    const draft = await createDraft(token, patientId, amoxilId);

    const response = await sign(token, draft.id);

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('allergy_conflict');
    expect(errorBody(response).detail).toContain('cannot be overridden');

    await expectUntouchedDraft(token, draft.id);
  });

  it('cannot be cleared by the acknowledgment fields', async () => {
    // "No override path exists" is only true if nothing in the request
    // body is one. Sending the fields that clear branch 2 must not clear
    // this.
    const token = await seedDoctor('sign-allergy-ack');
    const patientId = await seedPatient(token, [
      { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
    ]);
    const draft = await createDraft(token, patientId, amoxilId);

    const response = await sign(token, draft.id, {
      acknowledgedWarningIds: ['safety-allergy'],
      reason: 'Patient says the reaction was mild and long ago.',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('allergy_conflict');

    await expectUntouchedDraft(token, draft.id);
  });

  it('stops a signature for an allergy recorded after the draft was saved', async () => {
    // The re-run is authoritative: the advisory §7.5 answer described a
    // patient who has since changed.
    const token = await seedDoctor('sign-allergy-late');
    const patientId = await seedPatient(token);
    const draft = await createDraft(token, patientId, amoxilId);

    const patient = await harness.prisma.patient.findFirstOrThrow({
      where: { publicId: patientId },
      select: { id: true },
    });
    await harness.prisma.patientAllergy.create({
      data: {
        ...(await soleRecordOf(harness.prisma, patient.id)),
        patientId: patient.id,
        allergen: 'Penicillin',
        severity: 'SEVERE',
        reaction: 'Anaphylaxis',
      },
    });

    const response = await sign(token, draft.id);

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('allergy_conflict');
    await expectUntouchedDraft(token, draft.id);
  });
});

describe('409 branch 2 — acknowledgment_required', () => {
  it('refuses a severe interaction with no acknowledgment', async () => {
    const token = await seedDoctor('sign-ack');
    const patientId = await seedPatient(token);
    await livePrescriptionFor(patientId, coumadinId, token);
    const draft = await createDraft(token, patientId, amoxilId);

    const response = await sign(token, draft.id);

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('acknowledgment_required');
    expect(errorBody(response).detail).toContain('Warfarin × Amoxicillin');

    await expectUntouchedDraft(token, draft.id);
  });

  it('refuses a tick with no reason — that is not an acknowledgment', async () => {
    const token = await seedDoctor('sign-ack-noreason');
    const patientId = await seedPatient(token);
    await livePrescriptionFor(patientId, coumadinId, token);
    const draft = await createDraft(token, patientId, amoxilId);

    const response = await sign(token, draft.id, {
      acknowledgedWarningIds: [`safety-interaction-${coumadinId}`],
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('acknowledgment_required');
    expect(errorBody(response).detail).toContain('reason');

    await expectUntouchedDraft(token, draft.id);
  });

  it('accepts a tick with a reason, and audits the reason on the warning', async () => {
    const token = await seedDoctor('sign-ack-ok');
    const patientId = await seedPatient(token);
    await livePrescriptionFor(patientId, coumadinId, token);
    const draft = await createDraft(token, patientId, amoxilId);

    const response = await sign(token, draft.id, {
      acknowledgedWarningIds: [`safety-interaction-${coumadinId}`],
      reason: 'INR will be checked at day 3; benefit outweighs the risk.',
    });

    expect(response.status).toBe(200);

    const view = dataOf<PrescriptionDetailView>(response);
    expect(view.status).toBe('active');

    // The warning is persisted with the reason — the audit trail UX §2.7
    // requires, and what a later review reads.
    const interaction = view.warnings.find((warning) => warning.kind === 'interaction');
    expect(interaction).toBeDefined();
    expect(interaction?.severity).toBe('critical');
    expect(interaction?.acknowledgedReason).toBe(
      'INR will be checked at day 3; benefit outweighs the risk.',
    );
    expect(interaction?.acknowledgedAt).not.toBeNull();
  });

  it('does not require acknowledgment for an info-level finding', async () => {
    const token = await seedDoctor('sign-ack-info');
    const patientId = await seedPatient(token);
    const glucophage = await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Glucophage' },
      select: { id: true },
    });
    await livePrescriptionFor(patientId, glucophage.id, token);
    const draft = await createDraft(token, patientId, eltroxinId, { strength: '50 mcg' });

    // Levothyroxine × Metformin is seeded INFO.
    const response = await sign(token, draft.id);

    expect(response.status).toBe(200);
    const view = dataOf<PrescriptionDetailView>(response);
    expect(view.warnings.some((warning) => warning.severity === 'info')).toBe(true);
    // Recorded on the prescription, but not acknowledged — nobody was
    // asked to tick it.
    expect(view.warnings.find((warning) => warning.severity === 'info')?.acknowledgedAt).toBeNull();
  });
});

describe('409 branch 3 + the chaos test — safety_check_unavailable', () => {
  /**
   * RM M13.3's verify step, literally: "chaos test with the interaction
   * source disabled proves send is impossible but draft save works".
   *
   * A second application is booted with `INTERACTION_SOURCE` bound to an
   * implementation that always throws. That is the only honest way to
   * disable the source — breaking the database instead would take the
   * rest of the request down with it and prove nothing about fail-closed
   * behaviour.
   */
  it('cannot sign, but can still save a draft, with the source down', async () => {
    const { INTERACTION_SOURCE, InteractionSourceUnavailable } = await import(
      '../src/modules/pharmacy/services/interaction-source'
    );
    const { AppModule } = await import('../src/app.module');
    const { PLATFORM_POLICY_SOURCE } = await import('../src/config/policy.types');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PLATFORM_POLICY_SOURCE)
      .useValue({ load: () => Promise.resolve({}) })
      .overrideProvider(INTERACTION_SOURCE)
      .useValue({
        interactionsBetween: () => {
          throw new InteractionSourceUnavailable(new Error('chaos'));
        },
      })
      .compile();

    const chaosApp = moduleRef.createNestApplication();
    chaosApp.setGlobalPrefix('api/v1');
    await chaosApp.init();

    try {
      const server = chaosApp.getHttpServer() as Parameters<typeof request>[0];
      const email = testEmail('chaos');

      await request(server).post(REGISTER).send(registrationBody({ email }));
      await markVerified(harness.prisma, email);
      await makeClinicalDoctor(harness.prisma, email);
      const token = dataOf<SessionPayload>(
        await request(server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
      ).accessToken;

      const patientResponse = await request(server)
        .post(PATIENTS)
        .set('Authorization', `Bearer ${token}`)
        .send({
          fullName: 'Chaos Patient',
          dateOfBirth: '1990-01-01',
          gender: 'female',
          bloodType: 'O+',
          phone: '+20 100 000 0001',
          allergies: [],
          chronicConditions: [],
        });
      expect(patientResponse.status).toBe(201);
      const patientId = dataOf<{ id: string }>(patientResponse).id;
      createdCharts.push(patientId);

      // 1. Draft save still works. The clinician does not lose the work.
      const draftResponse = await request(server)
        .post(PRESCRIPTIONS)
        .set('Authorization', `Bearer ${token}`)
        .send(draftBody(patientId, amoxilId));

      expect(draftResponse.status).toBe(201);
      const draft = dataOf<PrescriptionDetailView>(draftResponse);
      expect(draft.status).toBe('draft');

      // 2. Signing is impossible, and fails closed with the contract's code.
      const signResponse = await request(server)
        .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
        .set('Authorization', `Bearer ${token}`)
        .send({});

      expect(signResponse.status).toBe(409);
      expect(errorBody(signResponse).code).toBe('safety_check_unavailable');

      // 3. And the prescription is still a draft — the fail-closed rule
      //    is a *state*, not just an error code.
      const after = dataOf<PrescriptionDetailView>(
        await request(server)
          .get(`${PRESCRIPTIONS}/${draft.id}`)
          .set('Authorization', `Bearer ${token}`),
      );
      expect(after.status).toBe('draft');
      expect(after.signedAt).toBeNull();
      expect(after.timeline).toEqual([]);

      // 4. Not even an acknowledgment gets past it. There is nothing to
      //    acknowledge, because nothing was checked.
      const forced = await request(server)
        .post(`${PRESCRIPTIONS}/${draft.id}/sign`)
        .set('Authorization', `Bearer ${token}`)
        .send({ acknowledgedWarningIds: ['anything'], reason: 'Proceeding anyway.' });

      expect(forced.status).toBe(409);
      expect(errorBody(forced).code).toBe('safety_check_unavailable');

      // 5. The advisory screen reports the same condition, as 503 — no
      //    prescription exists there whose state the failure decides.
      const advisory = await request(server)
        .post(`${PRESCRIPTIONS}/safety-check`)
        .set('Authorization', `Bearer ${token}`)
        .send({ patientId, medicationId: amoxilId });

      expect(advisory.status).toBe(503);
      expect(errorBody(advisory).code).toBe('safety_check_unavailable');
    } finally {
      await chaosApp.close();
    }
  }, 120_000);
});
