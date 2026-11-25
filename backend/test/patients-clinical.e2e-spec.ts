import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
 * The clinician's patient surface (RM M10 — API §4.1–4.6, §4.8).
 *
 * The cases that matter here are not the CRUD round trips; they are the
 * two authorization properties this module inherits and the derived
 * fields the safety strip depends on.
 *
 * · **Care scoping, and it is 404 rather than 403.** A doctor who is not
 *   assigned to a patient gets a refusal byte-identical to the one a
 *   patient who does not exist produces (ADR-022). The list and the
 *   per-record check are asserted to *agree*, because they are two
 *   different queries over one rule and a disagreement between them is a
 *   disclosure on one side or a lockout on the other.
 * · **Masking, and it has no clear-value field.** An administrator
 *   holding `patients.view` sees `MaskedIdentity`, and the test looks for
 *   the actual full name and MRN in the serialized body rather than
 *   trusting the shape.
 * · **`hasSevereAllergy` is derived.** Adding a severe allergy flips it
 *   on the next read of §4.3 and §4.4 — the exact verify step M10.4
 *   states, and the reason a stored flag would be a patient-safety
 *   failure rather than a stale cache.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

interface AllergyView {
  id: string;
  allergen: string;
  severity: string;
  reaction: string;
  notes: string | null;
  recordedAt: string;
  recordedBy: string | null;
}

interface AlertView {
  id: string;
  severity: string;
  message: string;
  active: boolean;
  resolutionReason: string | null;
  createdAt: string;
}

interface PatientView {
  id: string;
  mrn: string;
  fullName: string;
  dateOfBirth: string;
  age: number;
  gender: string;
  bloodType: string;
  phone: string;
  status: string;
  riskLevel: string;
  lastVisit: string | null;
  nextAppointment: string | null;
  assignedDoctor: { id: string; fullName: string } | null;
  allergies: AllergyView[];
  hasSevereAllergy: boolean;
  hasPortalAccount: boolean;
}

interface MaskedView {
  patientId: string;
  name: string;
  mrn: string;
  revealed: false;
}

interface ProfileBundle {
  patient: PatientView;
  latestVitals: unknown;
  medications: unknown[];
  chronicConditions: string[];
  emergencyContacts: unknown[];
  clinicalAlerts: AlertView[];
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function seedDoctor(local: string, hospital = 'a'): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at a fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email, await fixtureHospital(harness.prisma, hospital));

  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}

async function adminToken(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<SessionPayload>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
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
  const admin = await harness.prisma.user.update({
    where: { email },
    data: { roleId: adminRole.id },
    select: { id: true },
  });
  // The masked directory is a hospital's own (F-08, OD-07): the fixture
  // hospital's Hospital Admin, where the patients here are registered.
  await harness.prisma.hospitalRoleAssignment.create({
    data: { userId: admin.id, hospitalId: await fixtureHospital(harness.prisma), roleId: adminRole.id },
  });

  // The account was registered through the doctor branch to get a
  // bootstrap token, so it carries a `doctors` row. A real administrator
  // does not, and this module's clear/masked branch keys on that row
  // rather than on the role string — deliberately, since "is this account
  // a practitioner" is what the row answers. Leaving it in place would
  // make this fixture a doctor wearing an admin role and would test
  // nothing about administrators.
  await harness.prisma.doctor.deleteMany({ where: { user: { email } } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  return dataOf<SessionPayload>(verified).accessToken;
}

function registration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fullName: 'Layla Morsi',
    dateOfBirth: '1988-04-12',
    gender: 'female',
    bloodType: 'A+',
    phone: '+20 100 777 1234',
    allergies: [],
    chronicConditions: [],
    ...overrides,
  };
}

async function createPatient(
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<PatientView> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send(registration(overrides));

  expect(response.status).toBe(201);

  const view = dataOf<PatientView>(response);
  createdCharts.push(view.id);

  return view;
}

beforeAll(async () => {
  harness = await createAuthHarness('patients-clinical');
}, 60_000);

/**
 * The charts **this suite** created, deleted by id rather than by prefix.
 *
 * Both patient suites allocate `PT-…` handles from one shared sequence,
 * so a prefix sweep deletes the other file's fixtures mid-run — and
 * Vitest runs spec files in parallel, which makes that a failure that
 * appears only in a full-suite run and never when the file is run alone.
 * Tracking the ids is the only cleanup that is actually this suite's.
 *
 * Charts go **before** accounts: several child tables reference `users`
 * with `onDelete: Restrict` (`patient_notes.author_id` among them), so
 * deleting a doctor while their clinical rows exist violates the
 * constraint. `harness.reset()` cannot know that — it deletes accounts
 * by email suffix, and a patient has no account to be found by.
 */
const createdCharts: string[] = [];

async function clearCharts(): Promise<void> {
  // Guarded: `beforeAll` can fail before the harness exists, and an
  // `afterAll` that then threw would replace the real failure with a
  // `TypeError` and hide it.
  if (harness === undefined || createdCharts.length === 0) return;

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
  createdCharts.length = 0;
}

afterAll(async () => {
  await clearCharts();
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await clearCharts();
  await harness.reset();
});

describe('POST /patients (§4.2)', () => {
  it('registers a chart, generates the identifiers and assigns the doctor', async () => {
    const token = await seedDoctor('registrar');

    const patient = await createPatient(token, {
      email: 'layla@example.test',
      address: '12 Nile Street',
      allergies: [
        { allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' },
        { allergen: 'Latex', severity: 'mild', reaction: 'Rash' },
      ],
    });

    expect(patient.id).toMatch(/^PT-\d+$/);
    // The MRN is random rather than drawn from the same sequence: an
    // administrator sees it masked to its last four digits, and an MRN
    // derivable from the never-masked handle would protect nothing.
    expect(patient.mrn).toMatch(/^\d{4}-\d{2}$/);
    expect(patient.mrn).not.toContain(patient.id.replace('PT-', ''));

    expect(patient.allergies).toHaveLength(2);
    // Derived, not stored.
    expect(patient.hasSevereAllergy).toBe(true);
    expect(patient.age).toBeGreaterThan(30);
    expect(patient.hasPortalAccount).toBe(false);
    expect(patient.assignedDoctor).not.toBeNull();

    // The care relationship exists, which is what makes the chart the
    // registering clinician just created actually reachable.
    const assignment = await harness.prisma.patientDoctorAssignment.findFirst({
      where: { patient: { publicId: patient.id }, revokedAt: null },
      select: { role: true },
    });
    expect(assignment?.role).toBe('primary');
  });

  it('rejects a future date of birth', async () => {
    const token = await seedDoctor('future');

    const response = await request(harness.server)
      .post(PATIENTS)
      .set('Authorization', `Bearer ${token}`)
      .send(registration({ dateOfBirth: '2999-01-01' }));

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['dateOfBirth']).toBeDefined();
  });

  it('rejects a chronic condition outside the canonical vocabulary', async () => {
    const token = await seedDoctor('freetext');

    const response = await request(harness.server)
      .post(PATIENTS)
      .set('Authorization', `Bearer ${token}`)
      .send(registration({ chronicConditions: ['Something I made up'] }));

    // ADR-004 makes `chronic_conditions` the single source; an orphan
    // string cannot be matched by the safety screen or the filters.
    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['chronicConditions']).toBeDefined();
  });

  it('accepts conditions from the canonical vocabulary', async () => {
    const token = await seedDoctor('conditions');
    const condition = await harness.prisma.chronicCondition.findFirstOrThrow({
      select: { name: true },
    });

    const patient = await createPatient(token, { chronicConditions: [condition.name] });

    const profile = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}/profile`)
      .set('Authorization', `Bearer ${token}`);

    expect(dataOf<ProfileBundle>(profile).chronicConditions).toContain(condition.name);
  });

  it('refuses an administrator, who has nobody to assign the chart to', async () => {
    const token = await adminToken('adminregistrar');

    const response = await request(harness.server)
      .post(PATIENTS)
      .set('Authorization', `Bearer ${token}`)
      .send(registration());

    // Registration creates the care relationship that makes the chart
    // reachable, and an account with no `doctors` row has none to create.
    expect(response.status).toBe(403);
  });
});

describe('GET /patients (§4.1)', () => {
  it('shows a doctor only their own assigned patients', async () => {
    const mine = await seedDoctor('mine');
    // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
    const theirs = await seedDoctor('theirs', 'b');

    const patient = await createPatient(mine, { fullName: 'Only Mine' });

    const ownList = await request(harness.server)
      .get(`${PATIENTS}?pageSize=100`)
      .set('Authorization', `Bearer ${mine}`);
    expect(dataOf<Page<PatientView>>(ownList).items.map((row) => row.id)).toContain(patient.id);

    const otherList = await request(harness.server)
      .get(`${PATIENTS}?pageSize=100`)
      .set('Authorization', `Bearer ${theirs}`);
    expect(dataOf<Page<PatientView>>(otherList).items.map((row) => row.id)).not.toContain(
      patient.id,
    );
  });

  it('agrees with the per-record scope check', async () => {
    const mine = await seedDoctor('agreeing');
    // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
    const theirs = await seedDoctor('excluded', 'b');
    const patient = await createPatient(mine);

    // A patient absent from a doctor's list must be a patient whose
    // chart answers 404 — two queries over one rule, and a disagreement
    // is a disclosure on one side or a lockout on the other.
    const detail = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${theirs}`);

    expect(detail.status).toBe(404);

    const mineDetail = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${mine}`);

    expect(mineDetail.status).toBe(200);
  });

  it('answers the same 404 for an out-of-scope chart and a missing one', async () => {
    const mine = await seedDoctor('owner');
    // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
    const theirs = await seedDoctor('stranger', 'b');
    const patient = await createPatient(mine);

    const outOfScope = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${theirs}`);

    const missing = await request(harness.server)
      .get(`${PATIENTS}/PT-000000`)
      .set('Authorization', `Bearer ${theirs}`);

    // Byte-identical (ADR-022): walking PT-1000, PT-1001, … against a
    // 403/404 split would disclose the roster without opening a chart.
    expect(outOfScope.status).toBe(missing.status);
    expect(errorBody(outOfScope)).toEqual(errorBody(missing));
  });

  it('masks every identifier for an administrator', async () => {
    const doctor = await seedDoctor('charted');
    const admin = await adminToken('masker');
    const patient = await createPatient(doctor, { fullName: 'Distinctive Name' });

    const response = await request(harness.server)
      .get(`${PATIENTS}?pageSize=100`)
      .set('Authorization', `Bearer ${admin}`);

    expect(response.status).toBe(200);

    const row = dataOf<Page<MaskedView>>(response).items.find(
      (entry) => entry.patientId === patient.id,
    );

    expect(row).toBeDefined();
    expect(row?.revealed).toBe(false);
    // The shape is one thing; the serialized body is the evidence.
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('Distinctive Name');
    expect(raw).not.toContain(patient.mrn);
    // The handle is not masked — every subsequent request is keyed by it.
    expect(raw).toContain(patient.id);
  });

  it('masks the detail for an administrator too', async () => {
    const doctor = await seedDoctor('detailcharted');
    const admin = await adminToken('detailmasker');
    const patient = await createPatient(doctor, { fullName: 'Another Distinctive Name' });

    const response = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${admin}`);

    expect(response.status).toBe(200);
    expect(dataOf<MaskedView>(response).revealed).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain('Another Distinctive Name');
  });

  it('refuses the profile bundle to an administrator', async () => {
    const doctor = await seedDoctor('bundleowner');
    const admin = await adminToken('bundleadmin');
    const patient = await createPatient(doctor);

    const response = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}/profile`)
      .set('Authorization', `Bearer ${admin}`);

    // Holding a capability is not a care relationship (reconciliation
    // §5 rule 5). An administrator who needs an identifier elevates
    // through the audited reveal of M7.3, not through the chart.
    expect(response.status).toBe(404);
  });

  it('auto-detects the identifier a search term looks like', async () => {
    const token = await seedDoctor('searcher');
    const patient = await createPatient(token, {
      fullName: 'Findable Person',
      phone: '+20 100 555 9876',
    });

    for (const q of [patient.id, patient.mrn, 'Findable', '555 9876']) {
      const response = await request(harness.server)
        .get(`${PATIENTS}?q=${encodeURIComponent(q)}&pageSize=100`)
        .set('Authorization', `Bearer ${token}`);

      expect(dataOf<Page<PatientView>>(response).items.map((row) => row.id)).toContain(patient.id);
    }
  });

  it('honours an explicit scope override', async () => {
    const token = await seedDoctor('scoped');
    const patient = await createPatient(token, { fullName: 'Scoped Person' });

    // The term looks like a name, and the override says treat it as an
    // MRN — so it must find nothing rather than the patient.
    const response = await request(harness.server)
      .get(`${PATIENTS}?q=Scoped&scope=mrn&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);

    expect(dataOf<Page<PatientView>>(response).items.map((row) => row.id)).not.toContain(
      patient.id,
    );
  });

  it('filters by status, risk level and age range', async () => {
    const token = await seedDoctor('filters');
    const young = await createPatient(token, {
      fullName: 'Young Patient',
      dateOfBirth: '2010-01-01',
    });
    const older = await createPatient(token, {
      fullName: 'Older Patient',
      dateOfBirth: '1950-01-01',
    });

    await request(harness.server)
      .patch(`${PATIENTS}/${older.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'critical', riskLevel: 'high' });

    const critical = await request(harness.server)
      .get(`${PATIENTS}?status=critical&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);
    const criticalIds = dataOf<Page<PatientView>>(critical).items.map((row) => row.id);
    expect(criticalIds).toContain(older.id);
    expect(criticalIds).not.toContain(young.id);

    // `ageMin` is the older bound, so it becomes the earlier birth date.
    // Getting that backwards silently returns the complement.
    const seniors = await request(harness.server)
      .get(`${PATIENTS}?ageMin=60&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);
    const seniorIds = dataOf<Page<PatientView>>(seniors).items.map((row) => row.id);
    expect(seniorIds).toContain(older.id);
    expect(seniorIds).not.toContain(young.id);

    const juniors = await request(harness.server)
      .get(`${PATIENTS}?ageMax=20&pageSize=100`)
      .set('Authorization', `Bearer ${token}`);
    const juniorIds = dataOf<Page<PatientView>>(juniors).items.map((row) => row.id);
    expect(juniorIds).toContain(young.id);
    expect(juniorIds).not.toContain(older.id);
  });

  it('rejects a sort key outside the whitelist', async () => {
    const token = await seedDoctor('sorter');

    const response = await request(harness.server)
      .get(`${PATIENTS}?sort=medicalNotes:asc`)
      .set('Authorization', `Bearer ${token}`);

    // An open sort is a slow, reliable oracle over a column the
    // projection deliberately does not return.
    expect(response.status).toBe(422);
  });
});

describe('the derived fields (M10.6)', () => {
  it('derives nextAppointment from the appointment book', async () => {
    const token = await seedDoctor('nextappt');
    const patient = await createPatient(token);

    expect(patient.nextAppointment).toBeNull();

    const doctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: testEmail('nextappt') } },
      select: { id: true },
    });
    const record = await harness.prisma.patient.findFirstOrThrow({
      where: { publicId: patient.id },
      select: { id: true },
    });
    const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });

    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const later = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);

    for (const startsAt of [later, soon]) {
      await harness.prisma.appointment.create({
        data: {
          // Stamped as a booking at the doctor's hospital is (F-06).
          ...(await clinicalStampFor(harness.prisma, doctor.id, record.id)),
          publicId: `APT-NX-${startsAt.getTime().toString(36)}`,
          patientId: record.id,
          doctorId: doctor.id,
          visitTypeId: visitType.id,
          startsAt,
          durationMin: 30,
          status: 'CONFIRMED',
          reason: 'Review',
        },
      });
    }

    const response = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${token}`);

    // The *next* one, not the first written.
    expect(dataOf<PatientView>(response).nextAppointment).toBe(soon.toISOString());

    await harness.prisma.appointment.deleteMany({ where: { patientId: record.id } });
  });

  it('flips hasSevereAllergy when a severe allergy is added (M10.4)', async () => {
    const token = await seedDoctor('severe');
    const patient = await createPatient(token, {
      allergies: [{ allergen: 'Dust', severity: 'mild', reaction: 'Sneezing' }],
    });

    expect(patient.hasSevereAllergy).toBe(false);

    const added = await request(harness.server)
      .post(`${PATIENTS}/${patient.id}/allergies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' });

    expect(added.status).toBe(201);
    expect(dataOf<AllergyView>(added).recordedBy).toMatch(/^usr_/);

    // The verify step: 4.3 and 4.4 both carry it, because the fixed
    // allergy strip is drawn from whichever the screen loaded.
    const detail = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<PatientView>(detail).hasSevereAllergy).toBe(true);

    const profile = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}/profile`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<ProfileBundle>(profile).patient.hasSevereAllergy).toBe(true);
  });
});

describe('allergy CRUD (§4.6, M10.4)', () => {
  it('refuses a duplicate allergen for one patient', async () => {
    const token = await seedDoctor('dupallergy');
    const patient = await createPatient(token, {
      allergies: [{ allergen: 'Penicillin', severity: 'severe', reaction: 'Anaphylaxis' }],
    });

    const response = await request(harness.server)
      .post(`${PATIENTS}/${patient.id}/allergies`)
      .set('Authorization', `Bearer ${token}`)
      .send({ allergen: 'Penicillin', severity: 'mild', reaction: 'Rash' });

    // Two rows for one allergen would let a chart say both "severe" and
    // "mild" about the same substance.
    expect(response.status).toBe(409);
  });

  it('updates and soft-removes an allergy', async () => {
    const token = await seedDoctor('allergylifecycle');
    const patient = await createPatient(token, {
      allergies: [{ allergen: 'Latex', severity: 'mild', reaction: 'Rash' }],
    });
    const allergyId = patient.allergies[0]?.id ?? '';

    const updated = await request(harness.server)
      .patch(`${PATIENTS}/${patient.id}/allergies/${allergyId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ severity: 'severe', notes: 'Escalated after a second exposure' });

    expect(updated.status).toBe(200);
    expect(dataOf<AllergyView>(updated).severity).toBe('severe');

    const removed = await request(harness.server)
      .delete(`${PATIENTS}/${patient.id}/allergies/${allergyId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(removed.status).toBe(204);

    const listed = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}/allergies`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<AllergyView[]>(listed)).toHaveLength(0);

    // Soft: an allergy once believed is a clinical fact.
    const row = await harness.prisma.patientAllergy.findUnique({
      where: { id: allergyId },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).not.toBeNull();
  });

  it("answers 404 for an allergy on another patient's chart", async () => {
    const token = await seedDoctor('crossallergy');
    const first = await createPatient(token, {
      fullName: 'First Chart',
      allergies: [{ allergen: 'Peanuts', severity: 'severe', reaction: 'Anaphylaxis' }],
    });
    const second = await createPatient(token, { fullName: 'Second Chart' });

    const response = await request(harness.server)
      .patch(`${PATIENTS}/${second.id}/allergies/${first.allergies[0]?.id ?? ''}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ severity: 'mild' });

    expect(response.status).toBe(404);
  });

  it('refuses every allergy write from a doctor with no care relationship', async () => {
    const owner = await seedDoctor('allergyowner');
    // DR-05: a colleague at the same hospital reaches the chart; isolation is across hospitals.
    const stranger = await seedDoctor('allergystranger', 'b');
    const patient = await createPatient(owner);

    const response = await request(harness.server)
      .post(`${PATIENTS}/${patient.id}/allergies`)
      .set('Authorization', `Bearer ${stranger}`)
      .send({ allergen: 'Injected', severity: 'severe', reaction: 'None' });

    expect(response.status).toBe(404);
    expect(
      await harness.prisma.patientAllergy.count({ where: { allergen: 'Injected' } }),
    ).toBe(0);
  });
});

describe('clinical alerts (§4.5, M10.5)', () => {
  it('adds an alert and surfaces it in the profile bundle', async () => {
    const token = await seedDoctor('alerts');
    const patient = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patient.id}/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ severity: 'critical', message: 'Do not administer NSAIDs' });

    expect(created.status).toBe(201);

    const profile = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}/profile`)
      .set('Authorization', `Bearer ${token}`);

    const alerts = dataOf<ProfileBundle>(profile).clinicalAlerts;
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('critical');
  });

  it('resolves an alert without deleting the row', async () => {
    const token = await seedDoctor('resolvealert');
    const patient = await createPatient(token);

    const created = await request(harness.server)
      .post(`${PATIENTS}/${patient.id}/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ severity: 'warning', message: 'Fall risk' });
    const alertId = dataOf<AlertView>(created).id;

    await request(harness.server)
      .patch(`${PATIENTS}/${patient.id}/alerts/${alertId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ active: false });

    const active = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}/alerts`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<AlertView[]>(active)).toHaveLength(0);

    // A resolved alert is history, not a warning — but it is still there.
    const all = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}/alerts?includeResolved=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<AlertView[]>(all)).toHaveLength(1);
    expect(dataOf<AlertView[]>(all)[0]?.active).toBe(false);
    // No reason was given, which is still allowed (BR-DEC-003 is
    // optional-or-mandatory here, and the client sends none today).
    expect(dataOf<AlertView[]>(all)[0]?.resolutionReason).toBeNull();
  });

  describe('BR-DEC-003 — the reason for resolving', () => {
    async function openAlert(token: string, patientId: string): Promise<string> {
      const created = await request(harness.server)
        .post(`${PATIENTS}/${patientId}/alerts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ severity: 'warning', message: 'Fall risk' });
      return dataOf<AlertView>(created).id;
    }

    function patchAlert(token: string, patientId: string, alertId: string, body: object) {
      return request(harness.server)
        .patch(`${PATIENTS}/${patientId}/alerts/${alertId}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);
    }

    it('persists it, and serves it back on the resolved alert', async () => {
      const token = await seedDoctor('reasoned-alert');
      const patient = await createPatient(token);
      const alertId = await openAlert(token, patient.id);

      const resolved = await patchAlert(token, patient.id, alertId, {
        active: false,
        reason: 'Mobility assessed; no longer at risk',
      });
      expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
      expect(dataOf<AlertView>(resolved).resolutionReason).toBe(
        'Mobility assessed; no longer at risk',
      );

      const all = await request(harness.server)
        .get(`${PATIENTS}/${patient.id}/alerts?includeResolved=true`)
        .set('Authorization', `Bearer ${token}`);
      expect(dataOf<AlertView[]>(all)[0]?.resolutionReason).toBe(
        'Mobility assessed; no longer at risk',
      );

      // The audit row names the field, never the text (audit.types).
      const audit = await harness.prisma.auditEvent.findFirstOrThrow({
        where: { eventType: 'patient.alert_update', target: `patient:${patient.id}` },
        select: { payload: true },
      });
      expect(JSON.stringify(audit.payload)).toContain('reason');
      expect(JSON.stringify(audit.payload)).not.toContain('no longer at risk');
    });

    it.each([
      ['without resolving', { reason: 'Why not' }],
      ['while keeping it active', { active: true, reason: 'Why not' }],
      ['blank', { active: false, reason: '   ' }],
    ])('refuses a reason sent %s, and changes nothing', async (label, body) => {
      const token = await seedDoctor(`alert-reason-${label.replace(/\W+/g, '-')}`);
      const patient = await createPatient(token);
      const alertId = await openAlert(token, patient.id);

      const response = await patchAlert(token, patient.id, alertId, body);

      expect(response.status, JSON.stringify(response.body)).toBe(422);
      const row = await harness.prisma.patientClinicalAlert.findUniqueOrThrow({
        where: { id: alertId },
        select: { active: true, resolutionReason: true },
      });
      expect(row).toEqual({ active: true, resolutionReason: null });
    });
  });

  it('rejects an alert message longer than the banner can carry', async () => {
    const token = await seedDoctor('longalert');
    const patient = await createPatient(token);

    const response = await request(harness.server)
      .post(`${PATIENTS}/${patient.id}/alerts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ severity: 'warning', message: 'x'.repeat(301) });

    expect(response.status).toBe(422);
  });
});

describe('PATCH and DELETE /patients/{id} (§4.8)', () => {
  it('updates status, risk level and contact details', async () => {
    const token = await seedDoctor('updater');
    const patient = await createPatient(token);

    const response = await request(harness.server)
      .patch(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'under-treatment', riskLevel: 'medium', phone: '+20 100 000 1111' });

    expect(response.status).toBe(200);
    expect(dataOf<PatientView>(response).status).toBe('under-treatment');
    expect(dataOf<PatientView>(response).riskLevel).toBe('medium');
    expect(dataOf<PatientView>(response).phone).toBe('+20 100 000 1111');
  });

  it('ignores an attempt to change the identity a chart is filed under', async () => {
    const token = await seedDoctor('identity');
    const patient = await createPatient(token);

    await request(harness.server)
      .patch(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ fullName: 'Someone Else', mrn: '0000-00', dateOfBirth: '1900-01-01', status: 'active' });

    const after = await request(harness.server)
      .get(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${token}`);

    // Unknown keys are stripped. Changing a name, MRN or birth date
    // silently re-points every downstream reference, so it is a
    // governance action rather than a profile edit.
    const view = dataOf<PatientView>(after);
    expect(view.fullName).toBe(patient.fullName);
    expect(view.mrn).toBe(patient.mrn);
    expect(view.dateOfBirth).toBe(patient.dateOfBirth);
  });

  it('rejects an empty patch', async () => {
    const token = await seedDoctor('emptypatch');
    const patient = await createPatient(token);

    const response = await request(harness.server)
      .patch(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(422);
  });

  it('deactivates softly — the row and its history survive', async () => {
    const token = await seedDoctor('deactivator');
    const patient = await createPatient(token);

    const response = await request(harness.server)
      .delete(`${PATIENTS}/${patient.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(204);

    // API §4: "patient deletion does not exist"; DB §7: PHI is never
    // hard-deleted, and the row is referenced by appointments and orders.
    const row = await harness.prisma.patient.findUnique({
      where: { publicId: patient.id },
      select: { deletedAt: true, status: true },
    });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();

    // And it is gone from every ordinary read.
    const listed = await request(harness.server)
      .get(`${PATIENTS}?pageSize=100`)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<Page<PatientView>>(listed).items.map((entry) => entry.id)).not.toContain(
      patient.id,
    );
  });
});
