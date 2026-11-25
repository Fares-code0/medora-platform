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
  purgeHospitalRecords,
  registrationBody,
  testEmail,
  clinicalStampFor,
} from './support/auth-app';

/**
 * The safety screen, end to end (RM M13.2 — API §7.5).
 *
 * `safety-screen.spec.ts` proves the rules against a table of inputs and
 * holds the 100% coverage gate. This spec proves the half that unit test
 * cannot: that the rules are wired to the right rows.
 *
 * · **The verify step itself** — a penicillin-allergic patient and Amoxil
 *   answer `blocking: true` with a critical allergy warning, through
 *   HTTP, against the real seeded formulary.
 * · **The interaction source is the table, not the canned note.** The
 *   seeded Warfarin × Amoxicillin row is graded `critical` by the pair;
 *   `medications.interaction_note` is one string per drug and cannot
 *   grade anything (ADR-010 §8, RM M13.2).
 * · **Both directions of the ordered pair are found.** DB §F9 stores the
 *   pair once under `medication_a_id < medication_b_id`, so a query
 *   against one column would miss half the interactions depending on
 *   which uuid sorted first.
 * · **Drafts are not "current therapy"** (ADR-002 §1), so they raise no
 *   duplicate warning — and a signed prescription does.
 * · **Scope.** A patient outside the caller's care answers 404, not 403,
 *   and reveals no allergy.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const SAFETY_CHECK = '/api/v1/prescriptions/safety-check';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface SafetyWarningView {
  id: string;
  kind: string;
  severity: string;
  title: string;
  detail: string;
  against: string[];
  blocking: boolean;
}

interface SafetyCheckView {
  warnings: SafetyWarningView[];
  blocking: boolean;
  requiresAcknowledgment: string[];
}

interface Doctor {
  readonly token: string;
}

const createdCharts: string[] = [];

/** Resolved from the seed once, so the ids are the real catalogue's. */
let amoxilId = '';
let coumadinId = '';
let lipitorId = '';
let eltroxinId = '';
let glucophageId = '';

async function seedDoctor(local: string, hospital = 'a'): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at a fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email, await fixtureHospital(harness.prisma, hospital));

  const token = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  return { token };
}

async function seedPatient(
  token: string,
  allergies: { allergen: string; severity: string; reaction: string }[] = [],
  fullName = 'Layla Morsi',
): Promise<string> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName,
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

function check(token: string, patientId: string, medicationId: string) {
  return request(harness.server)
    .post(SAFETY_CHECK)
    .set('Authorization', `Bearer ${token}`)
    .send({ patientId, medicationId });
}

/**
 * A live prescription, written straight to the database.
 *
 * §7.6 and §7.7 arrive with M13.3; this spec needs a patient who is
 * *already on* a drug, and the shortest honest way to say that at M13.2
 * is a row in the state those endpoints will produce. The CHECK
 * constraints still apply, so a row that could not exist cannot be
 * created here either.
 */
async function givePatientAMedication(
  patientPublicId: string,
  medicationId: string,
  doctorToken: string,
  status: 'ACTIVE' | 'DRAFT' = 'ACTIVE',
): Promise<void> {
  const patient = await harness.prisma.patient.findFirstOrThrow({
    where: { publicId: patientPublicId },
    select: { id: true },
  });
  const doctorId = await doctorIdFor(doctorToken);
  const medication = await harness.prisma.medication.findUniqueOrThrow({
    where: { id: medicationId },
    select: { strengths: { select: { strength: true }, take: 1 } },
  });

  await harness.prisma.prescription.create({
    data: {
      ...(await clinicalStampFor(harness.prisma, doctorId, patient.id)),
      publicId: `RX-T${String(Date.now() % 100_000)}${String(Math.floor(Math.random() * 1000))}`,
      patientId: patient.id,
      medicationId,
      prescribingDoctorId: doctorId,
      strength: medication.strengths[0]?.strength ?? '500 mg',
      dosage: '1 tablet',
      frequency: 'Once daily',
      route: 'ORAL',
      durationDays: 30,
      quantity: 30,
      instructions: 'Take with food.',
      status,
      // The biconditional CHECK: every status past draft carries a
      // signature, and a draft carries none.
      ...(status === 'DRAFT' ? {} : { signedAt: new Date() }),
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-10-01'),
    },
  });
}

async function doctorIdFor(token: string): Promise<string> {
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

  return doctor.id;
}

beforeAll(async () => {
  harness = await createAuthHarness('rx-safety');

  const byName = async (name: string): Promise<string> =>
    (
      await harness.prisma.medication.findFirstOrThrow({
        where: { name },
        select: { id: true },
      })
    ).id;

  amoxilId = await byName('Amoxil');
  coumadinId = await byName('Coumadin');
  lipitorId = await byName('Lipitor');
  eltroxinId = await byName('Eltroxin');
  glucophageId = await byName('Glucophage');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.prescription.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    const patients = await harness.prisma.patient.findMany({
      where: { publicId: { in: createdCharts } },
      select: { id: true },
    });
    await purgeHospitalRecords(
      harness.prisma,
      patients.map((row) => row.id),
    );
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('RM M13.2 verify — penicillin-allergic patient + Amoxil', () => {
  it('answers blocking:true with a critical allergy warning', async () => {
    const doctor = await seedDoctor('verify');
    const patientId = await seedPatient(doctor.token, [
      { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
    ]);

    const response = await check(doctor.token, patientId, amoxilId);

    expect(response.status).toBe(200);

    const view = dataOf<SafetyCheckView>(response);

    expect(view.blocking).toBe(true);

    const allergy = view.warnings.find((warning) => warning.kind === 'allergy');
    expect(allergy).toBeDefined();
    expect(allergy?.severity).toBe('critical');
    expect(allergy?.blocking).toBe(true);
    expect(allergy?.title).toBe('Allergy conflict — Penicillin');
    expect(allergy?.detail).toContain('Amoxil (Amoxicillin)');
    expect(allergy?.detail).toContain('cannot be overridden');

    // An allergy is not acknowledgeable: offering a tick box would
    // suggest the prescription becomes signable, and it never does.
    expect(view.requiresAcknowledgment).not.toContain(allergy?.id);
  });

  it('does not block the same patient for an unrelated drug', async () => {
    const doctor = await seedDoctor('verify-clear');
    const patientId = await seedPatient(doctor.token, [
      { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
    ]);

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, eltroxinId));

    expect(view.blocking).toBe(false);
    expect(view.warnings).toEqual([]);
  });
});

describe('interactions come from `drug_interactions`, graded by the pair', () => {
  it('finds the seeded Warfarin × Amoxicillin pair and grades it critical', async () => {
    const doctor = await seedDoctor('interaction');
    const patientId = await seedPatient(doctor.token);
    await givePatientAMedication(patientId, coumadinId, doctor.token);

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, amoxilId));

    const interaction = view.warnings.find((warning) => warning.kind === 'interaction');
    expect(interaction).toBeDefined();
    expect(interaction?.severity).toBe('critical');
    expect(interaction?.title).toBe('Warfarin × Amoxicillin');
    expect(interaction?.against).toEqual(['Coumadin (Warfarin)']);
    // The pair grades it; `interaction_note` is one string per drug and
    // would say the same thing whatever the other drug was.
    expect(interaction?.detail).toContain('Check INR within 3–5 days');
    expect(interaction?.detail).toContain('a high-alert medication');

    // Not blocking — but it must be acknowledged before signing (§7.7).
    expect(interaction?.blocking).toBe(false);
    expect(view.blocking).toBe(false);
    expect(view.requiresAcknowledgment).toContain(interaction?.id);
  });

  it('finds the pair with the candidate on the other side of the row', async () => {
    // DB §F9 stores the pair once under `medication_a_id <
    // medication_b_id`. Screening Coumadin against a patient on Amoxil
    // exercises whichever column order the seed happened to produce —
    // between the two cases, both directions are covered.
    const doctor = await seedDoctor('interaction-reverse');
    const patientId = await seedPatient(doctor.token);
    await givePatientAMedication(patientId, amoxilId, doctor.token);

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, coumadinId));

    const interaction = view.warnings.find((warning) => warning.kind === 'interaction');
    expect(interaction).toBeDefined();
    expect(interaction?.title).toBe('Warfarin × Amoxicillin');
    expect(interaction?.against).toEqual(['Amoxil (Amoxicillin)']);
  });

  it('grades a warning-level pair as warning, not as critical', async () => {
    const doctor = await seedDoctor('interaction-warning');
    const patientId = await seedPatient(doctor.token);
    await givePatientAMedication(patientId, coumadinId, doctor.token);

    // Atorvastatin × Warfarin is seeded WARNING.
    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, lipitorId));

    const interaction = view.warnings.find((warning) => warning.kind === 'interaction');
    expect(interaction?.severity).toBe('warning');
    expect(interaction?.title).toBe('Atorvastatin × Warfarin');
  });

  it('grades an info-level pair as info, and does not require acknowledgment', async () => {
    // The third grade, and the one that proves the mapping rather than
    // the fallback: `toSeverity` grades anything it cannot recognise as
    // `critical`, so a Prisma enum member leaking through untranslated
    // would report every pair — this one included — as critical. All
    // three seeded grades are asserted for exactly that reason.
    const doctor = await seedDoctor('interaction-info');
    const patientId = await seedPatient(doctor.token);
    await givePatientAMedication(patientId, glucophageId, doctor.token);

    // Levothyroxine × Metformin is seeded INFO.
    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, eltroxinId));

    const interaction = view.warnings.find((warning) => warning.kind === 'interaction');
    expect(interaction?.severity).toBe('info');
    expect(interaction?.title).toBe('Levothyroxine × Metformin');
    // `info` findings are not acknowledged before signing (§7.7).
    expect(view.requiresAcknowledgment).not.toContain(interaction?.id);
  });

  it('raises one warning per interacting pair', async () => {
    const doctor = await seedDoctor('interaction-many');
    const patientId = await seedPatient(doctor.token);
    await givePatientAMedication(patientId, coumadinId, doctor.token);
    await givePatientAMedication(patientId, eltroxinId, doctor.token);

    // Amoxicillin interacts with Warfarin (critical) but not with
    // Levothyroxine, so exactly one pair is found.
    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, amoxilId));
    const interactions = view.warnings.filter((warning) => warning.kind === 'interaction');

    expect(interactions).toHaveLength(1);
    expect(interactions[0]?.against).toEqual(['Coumadin (Warfarin)']);
  });

  it('reports nothing when the patient is on no other medication', async () => {
    const doctor = await seedDoctor('interaction-none');
    const patientId = await seedPatient(doctor.token);

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, amoxilId));

    expect(view.warnings).toEqual([]);
    expect(view.blocking).toBe(false);
  });
});

describe('duplicate therapy', () => {
  it('flags the same generic as critical, naming the existing script', async () => {
    const doctor = await seedDoctor('duplicate');
    const patientId = await seedPatient(doctor.token);
    await givePatientAMedication(patientId, amoxilId, doctor.token);

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, amoxilId));

    const duplicate = view.warnings.find((warning) => warning.kind === 'duplicate');
    expect(duplicate).toBeDefined();
    expect(duplicate?.severity).toBe('critical');
    expect(duplicate?.title).toBe('Duplicate therapy — Amoxicillin is already active');
    expect(duplicate?.against[0]).toMatch(/^Amoxil · RX-/);
    expect(duplicate?.blocking).toBe(false);
  });

  it('does not count a draft as current therapy', async () => {
    // ADR-002 §1: "A draft has not been prescribed." Two drafts for one
    // drug are one clinician thinking, not duplicate therapy.
    const doctor = await seedDoctor('duplicate-draft');
    const patientId = await seedPatient(doctor.token);
    await givePatientAMedication(patientId, amoxilId, doctor.token, 'DRAFT');

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, amoxilId));

    expect(view.warnings.filter((warning) => warning.kind === 'duplicate')).toEqual([]);
  });
});

describe('the screen is a scoped clinical read', () => {
  it('refuses a patient outside the caller’s care with 404, disclosing nothing', async () => {
    const owner = await seedDoctor('scope-owner');
    // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
    const stranger = await seedDoctor('scope-stranger', 'b');
    const patientId = await seedPatient(owner.token, [
      { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
    ]);

    const response = await check(stranger.token, patientId, amoxilId);

    // 404 and not 403: a 403 confirms the chart exists (ADR-022).
    expect(response.status).toBe(404);
    expect(errorBody(response).code).toBe('not_found');
    // And nothing about the allergy leaks into the refusal.
    expect(JSON.stringify(response.body)).not.toContain('Penicillin');
  });

  it('answers 404 for an unknown patient, identically', async () => {
    const doctor = await seedDoctor('scope-unknown');

    const response = await check(doctor.token, 'PT-000000', amoxilId);

    expect(response.status).toBe(404);
    expect(errorBody(response).code).toBe('not_found');
  });

  it('refuses an unknown medication with a 422 naming the field', async () => {
    const doctor = await seedDoctor('unknown-med');
    const patientId = await seedPatient(doctor.token);

    const response = await check(
      doctor.token,
      patientId,
      '00000000-0000-4000-8000-000000000000',
    );

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('validation_failed');
  });

  it('refuses a malformed medication id with a 422, never a 500', async () => {
    const doctor = await seedDoctor('malformed-med');
    const patientId = await seedPatient(doctor.token);

    const response = await check(doctor.token, patientId, 'not-a-uuid');

    expect(response.status).toBe(422);
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(harness.server)
      .post(SAFETY_CHECK)
      .send({ patientId: 'PT-000001', medicationId: '00000000-0000-4000-8000-000000000000' });

    expect(response.status).toBe(401);
  });
});

/**
 * Security remediation H2 — the legacy safety exception (owner decision
 * #17, 2026-11-24). A legacy row (`hospital_id IS NULL`, source hospital
 * unknown) is invisible to every hospital, but the safety screen of a
 * prescriber who already reaches the patient (DR-05) still screens
 * against it: marked as legacy, and audited. Another hospital's
 * attributed rows stay out, and nobody who cannot reach the patient
 * learns anything.
 */
describe('legacy clinical records in the safety screen (H2)', () => {
  const LEGACY = 'legacy record, source hospital unknown';

  async function patientRowId(publicId: string): Promise<string> {
    return (
      await harness.prisma.patient.findFirstOrThrow({ where: { publicId }, select: { id: true } })
    ).id;
  }

  async function legacyAllergy(publicId: string, allergen: string): Promise<void> {
    await harness.prisma.patientAllergy.create({
      data: { patientId: await patientRowId(publicId), allergen, severity: 'SEVERE', reaction: 'Anaphylaxis' },
    });
  }

  async function legacyPrescription(publicId: string, medicationId: string, doctorToken: string): Promise<void> {
    const medication = await harness.prisma.medication.findUniqueOrThrow({
      where: { id: medicationId },
      select: { strengths: { select: { strength: true }, take: 1 } },
    });
    // No hospital, record or employment: written before attribution.
    await harness.prisma.prescription.create({
      data: {
        publicId: `RX-L${String(Date.now() % 100_000)}${String(Math.floor(Math.random() * 1000))}`,
        patientId: await patientRowId(publicId),
        medicationId,
        prescribingDoctorId: await doctorIdFor(doctorToken),
        strength: medication.strengths[0]?.strength ?? '5 mg',
        dosage: '1 tablet',
        frequency: 'Once daily',
        route: 'ORAL',
        durationDays: 30,
        quantity: 30,
        instructions: 'Legacy.',
        status: 'ACTIVE',
        signedAt: new Date(),
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-12-01'),
      },
    });
  }

  function legacyReads(publicId: string) {
    return harness.prisma.auditEvent.findMany({
      where: { eventType: 'legacy_clinical_record.read', target: { contains: publicId } },
    });
  }

  it('blocks on a legacy allergy, names it as legacy, and audits the read at the prescriber’s hospital', async () => {
    const doctor = await seedDoctor('h2-legacy-allergy');
    const patientId = await seedPatient(doctor.token);
    await legacyAllergy(patientId, 'Penicillin');

    const response = await check(doctor.token, patientId, amoxilId);
    expect(response.status).toBe(200);
    const view = dataOf<SafetyCheckView>(response);
    const allergy = view.warnings.find((warning) => warning.kind === 'allergy');
    expect(view.blocking).toBe(true);
    expect(allergy?.blocking).toBe(true);
    expect(allergy?.against).toEqual([`Recorded allergy: Penicillin (${LEGACY})`]);
    expect(allergy?.detail).toContain(LEGACY);

    const audits = await legacyReads(patientId);
    expect(audits).toHaveLength(1);
    const hospitalA = await fixtureHospital(harness.prisma, 'a');
    expect(audits[0]?.hospitalId).toBe(hospitalA);
    expect(audits[0]?.payload).toMatchObject({ legacyAllergies: 1, legacyPrescriptions: 0 });
  });

  it('keeps a hospital-attributed allergy unmarked, and writes no legacy audit without legacy rows', async () => {
    const doctor = await seedDoctor('h2-attributed');
    const patientId = await seedPatient(doctor.token, [
      { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
    ]);

    const allergy = dataOf<SafetyCheckView>(await check(doctor.token, patientId, amoxilId)).warnings.find(
      (warning) => warning.kind === 'allergy',
    );
    expect(allergy?.against).toEqual(['Recorded allergy: Penicillin']);
    expect(await legacyReads(patientId)).toHaveLength(0);
  });

  it('never screens against another hospital’s attributed allergy (no cross-hospital access)', async () => {
    const doctor = await seedDoctor('h2-other-hospital');
    const patientId = await seedPatient(doctor.token);
    const id = await patientRowId(patientId);
    const hospitalB = await fixtureHospital(harness.prisma, 'b');
    const recordB = await harness.prisma.hospitalMedicalRecord.create({
      data: { patientId: id, hospitalId: hospitalB },
      select: { id: true },
    });
    await harness.prisma.patientAllergy.create({
      data: {
        patientId: id,
        hospitalId: hospitalB,
        hospitalMedicalRecordId: recordB.id,
        allergen: 'Penicillin',
        severity: 'SEVERE',
        reaction: 'Anaphylaxis',
      },
    });

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, amoxilId));
    expect(view.warnings.find((warning) => warning.kind === 'allergy')).toBeUndefined();
    expect(await legacyReads(patientId)).toHaveLength(0);
  });

  it('marks a legacy live prescription in the duplicate-therapy finding', async () => {
    const doctor = await seedDoctor('h2-legacy-rx');
    const patientId = await seedPatient(doctor.token);
    await legacyPrescription(patientId, coumadinId, doctor.token);

    const view = dataOf<SafetyCheckView>(await check(doctor.token, patientId, coumadinId));
    const duplicate = view.warnings.find((warning) => warning.kind === 'duplicate');
    expect(duplicate?.severity).toBe('critical');
    expect(duplicate?.against.join(' ')).toContain(LEGACY);
    const audits = await legacyReads(patientId);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({ legacyAllergies: 0, legacyPrescriptions: 1 });
  });

  it('discloses nothing, and audits nothing, to a doctor who cannot reach the patient', async () => {
    const owner = await seedDoctor('h2-owner');
    const stranger = await seedDoctor('h2-stranger', 'b');
    const patientId = await seedPatient(owner.token);
    await legacyAllergy(patientId, 'Penicillin');

    const response = await check(stranger.token, patientId, amoxilId);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain('Penicillin');
    expect(await legacyReads(patientId)).toHaveLength(0);
  });

  it('keeps the legacy row out of the ordinary chart: the exception is the safety screen only', async () => {
    const doctor = await seedDoctor('h2-chart');
    const patientId = await seedPatient(doctor.token);
    await legacyAllergy(patientId, 'Sulfa');

    const list = await request(harness.server)
      .get(`${PATIENTS}/${patientId}/allergies`)
      .set('Authorization', `Bearer ${doctor.token}`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain('Sulfa');
  });
});
