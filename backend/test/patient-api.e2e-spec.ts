import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FORBIDDEN_DOCTOR_FIELDS } from '../src/modules/doctors/dto/patient-doctor.dto';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import {
  createTestDoctor,
  destroyTestDoctor,
  employTestDoctor,
  type DoctorRecord,
} from './support/doctor-fixture';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

/**
 * The patient-facing API surface — `PATIENT_MOBILE_API_CONTRACT.md` §§2–3.
 *
 * Two routes' worth of behaviour and one property that matters more than
 * either: **the internal Doctor entity must not reach a patient.**
 *
 * `doctors` carries `license_number`, `contact_phone`,
 * `emergency_contact_phone`, `employee_id` and more. API §3.4's
 * `GET /doctors` returns them to `can:doctors.manage`. If the patient
 * routes ever serve that shape — through a widened `select`, a spread, a
 * refactor that reuses the admin repository — a practitioner's licence
 * number and personal mobile go to every patient in the clinic.
 *
 * The test below is deliberately written against the **serialized
 * response body**, not against a TypeScript type. A type proves what the
 * compiler was told; only the wire proves what a client receives.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const VERIFY = '/api/v1/auth/verify-email';
const PROFILE = '/api/v1/me/profile';
const DOCTORS = '/api/v1/patient/doctors';
const SPECIALTIES = '/api/v1/patient/specialties';

/**
 * This file's own clinical records — never the seeded ones.
 *
 * Three specs link an account to a `patients` row, and while they all
 * reached for the seeded `PT-1001`/`PT-1002` they raced: Vitest runs
 * files in parallel, and one file's unlink nulled the link another was
 * mid-request on. See `support/patient-fixture.ts`.
 *
 * `harness.reset()` deletes this suite's users between cases, and
 * `patients.user_id` is `SET NULL` on user delete — so these records
 * arrive at every test unlinked, with no teardown of their own.
 */
let records: PatientRecord[];
const PATIENT_TAG = 'api';

/**
 * This file's own verified practitioner.
 *
 * The directory tests used to take the first verified, active doctor in
 * the shared table — and one of them *suspends* it for the length of the
 * test. Under a parallel run that row belongs to another suite, which then
 * sees its doctor vanish from `/patient/doctors` mid-test. RA-M10.1's rule:
 * a suite mutates only rows it created.
 */
let practitioner: DoctorRecord;
const DOCTOR_TAG = 'papi';

/** The practitioner's full row, for the forbidden-field assertions. */
function practitionerRow() {
  return harness.prisma.db.doctor.findUniqueOrThrow({ where: { id: practitioner.id } });
}

beforeAll(async () => {
  harness = await createAuthHarness('patient-api');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 2);
  practitioner = await createTestDoctor(harness.prisma, DOCTOR_TAG);
  await harness.prisma.doctor.update({
    where: { id: practitioner.id },
    data: { verificationStatus: 'VERIFIED', practiceStatus: 'ACTIVE' },
  });
  // And employed (L6): the patient directory offers only employed doctors.
  await employTestDoctor(harness.prisma, practitioner.id);
});

afterAll(async () => {
  await destroyTestDoctor(harness.prisma, DOCTOR_TAG);
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

async function patientToken(local = 'sara'): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);

  await request(harness.server)
    .post(REGISTER)
    .send(registrationBody({ firstName: 'Sara', lastName: 'Al-Amin', email, role: 'patient' }))
    .expect(201);

  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: 'Medora123!' })
    .expect(200);

  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return { token: dataOf<{ accessToken: string }>(login).accessToken, userId: row.id };
}

/** Every string that appears as an object key anywhere in a payload. */
function keysDeep(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
    return found;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      keysDeep(nested, found);
    }
  }

  return found;
}

describe('GET /me/profile (contract §2.1)', () => {
  it('refuses an unauthenticated request', async () => {
    await request(harness.server).get(PROFILE).expect(401);
  });

  it('answers 200 with patient: null for an account with no clinical record', async () => {
    // The normal state straight after registration. It must be a success:
    // a 404 on one's own profile is indistinguishable from a broken
    // session, and a mobile client's response to that is to log out.
    const { token } = await patientToken();

    const response = await request(harness.server)
      .get(PROFILE)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const view = dataOf<{ account: { email: string }; patient: unknown }>(response);

    expect(view.account.email).toBe(testEmail('sara'));
    expect(view.patient).toBeNull();
  });

  it('returns the linked clinical record, with a derived age', async () => {
    const { token, userId } = await patientToken();
    const record = records[0]!;

    await harness.prisma.db.patient.update({ where: { id: record.id }, data: { userId } });

    const response = await request(harness.server)
      .get(PROFILE)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const view = dataOf<{
      patient: { id: string; age: number; dateOfBirth: string; gender: string; bloodType: string };
    }>(response);

    expect(view.patient.id).toBe(record.publicId);
    expect(view.patient.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(view.patient.age).toBeGreaterThan(0);
    // ADR-023 §2: the wire speaks the mapped value, not the Prisma member
    // name. `FEMALE` and `O_POSITIVE` must never reach a client.
    expect(['female', 'male']).toContain(view.patient.gender);
    expect(view.patient.bloodType).toMatch(/^(A|B|AB|O)[+-]$/);
  });

  it('never exposes the internal clinical fields', async () => {
    // `mrn`, `medicalNotes`, `status` and `riskLevel` are clinician-owned
    // or triage classifications; `assignedDoctorId` belongs to the care
    // surface. None is a profile field.
    const { token, userId } = await patientToken();
    const record = records[0]!;

    await harness.prisma.db.patient.update({ where: { id: record.id }, data: { userId } });

    const response = await request(harness.server)
      .get(PROFILE)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const keys = keysDeep(response.body);

    for (const forbidden of [
      'mrn',
      'medicalNotes',
      'medical_notes',
      'riskLevel',
      'risk_level',
      'status',
      'assignedDoctorId',
      'assigned_doctor_id',
      'createdBy',
      'updatedBy',
      'deletedAt',
    ]) {
      expect(keys, `\`${forbidden}\` must not reach a patient`).not.toContain(forbidden);
    }
  });

  it('shows one patient their own record and never another’s', async () => {
    const mine = await patientToken('sara');
    const theirs = await patientToken('omar');
    const [a, b] = records;

    await harness.prisma.db.patient.update({ where: { id: a!.id }, data: { userId: mine.userId } });
    await harness.prisma.db.patient.update({
      where: { id: b!.id },
      data: { userId: theirs.userId },
    });

    const response = await request(harness.server)
      .get(PROFILE)
      .set('Authorization', `Bearer ${mine.token}`)
      .expect(200);

    const view = dataOf<{ patient: { id: string } }>(response);

    expect(view.patient.id).toBe(a!.publicId);
    expect(view.patient.id).not.toBe(b!.publicId);
  });
});

describe('GET /patient/doctors (contract §3)', () => {
  it('refuses an unauthenticated request', async () => {
    // Not because the roster is PHI, but because no rate limiting exists
    // yet (audit BE-17/R-9) and an open route is an enumeration surface.
    await request(harness.server).get(DOCTORS).expect(401);
  });

  it('returns a paginated list in the contract’s envelope', async () => {
    const { token } = await patientToken();

    const response = await request(harness.server)
      .get(DOCTORS)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = dataOf<{
      items: { id: string; fullName: string }[];
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
    }>(response);

    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(Array.isArray(page.items)).toBe(true);
  });

  it('rejects a pageSize above the cap rather than honouring it', async () => {
    // The cap is the only thing between a mobile client and pulling the
    // whole roster in one round trip, since nothing rate-limits this yet.
    const { token } = await patientToken();

    await request(harness.server)
      .get(`${DOCTORS}?pageSize=5000`)
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
  });

  it('rejects a sort field that is not whitelisted', async () => {
    const { token } = await patientToken();

    await request(harness.server)
      .get(`${DOCTORS}?sort=licenseNumber:asc`)
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
  });

  it('shows only verified, actively practising doctors', async () => {
    // A safety property, not a filter preference: an unverified or
    // suspended practitioner must not appear to a patient, and there is
    // no parameter that turns this off.
    const { token } = await patientToken();
    const visible = await practitionerRow();

    // Visible first, so the 404 below is caused by the suspension.
    await request(harness.server)
      .get(`${DOCTORS}/${visible.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await harness.prisma.db.doctor.update({
      where: { id: visible.id },
      data: { practiceStatus: 'SUSPENDED' },
    });

    const response = await request(harness.server)
      .get(`${DOCTORS}?pageSize=100`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const page = dataOf<{ items: { id: string }[] }>(response);
    expect(page.items.map((item) => item.id)).not.toContain(visible.id);

    // And the detail route agrees — a suspended doctor is a 404, not a
    // 403, so the response cannot confirm that they exist.
    await request(harness.server)
      .get(`${DOCTORS}/${visible.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    await harness.prisma.db.doctor.update({
      where: { id: visible.id },
      data: { practiceStatus: 'ACTIVE' },
    });
  });

  it('shows only doctors holding an active employment (L6)', async () => {
    const { token } = await patientToken();
    const visible = await practitionerRow();
    const listed = async (): Promise<string[]> =>
      dataOf<{ items: { id: string }[] }>(
        await request(harness.server)
          .get(`${DOCTORS}?pageSize=100`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200),
      ).items.map((item) => item.id);

    expect(await listed()).toContain(visible.id);

    // The employment ends: verified and practising, but nowhere to see a
    // patient — neither listed nor reachable by id (404, never 403).
    await harness.prisma.doctorEmployment.updateMany({
      where: { doctorId: visible.id, endedAt: null },
      data: { endedAt: new Date() },
    });
    try {
      expect(await listed()).not.toContain(visible.id);
      await request(harness.server)
        .get(`${DOCTORS}/${visible.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    } finally {
      await employTestDoctor(harness.prisma, visible.id);
    }

    expect(await listed()).toContain(visible.id);
  });

  it('answers 404 for an unknown id and for a malformed one alike', async () => {
    const { token } = await patientToken();

    await request(harness.server)
      .get(`${DOCTORS}/00000000-0000-4000-8000-000000000000`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    // A non-uuid must not reach Postgres as a uuid literal, which would
    // turn a legitimate "not found" into a 500.
    await request(harness.server)
      .get(`${DOCTORS}/not-a-uuid`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('returns the specialty filter chips', async () => {
    const { token } = await patientToken();

    const response = await request(harness.server)
      .get(SPECIALTIES)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const specialties = dataOf<{ id: string; name: string }[]>(response);

    expect(specialties.length).toBeGreaterThan(0);
    expect(specialties[0]).toHaveProperty('name');
  });
});

describe('the Doctor projection cannot leak internal fields (ADR-030 §10)', () => {
  it('keeps every forbidden field out of the list response body', async () => {
    const { token } = await patientToken();

    const response = await request(harness.server)
      .get(`${DOCTORS}?pageSize=100`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const keys = keysDeep(response.body);

    for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
      expect(keys, `\`${forbidden}\` must never reach a patient`).not.toContain(forbidden);
    }
  });

  it('keeps every forbidden field out of the detail response body', async () => {
    const { token } = await patientToken();
    const doctor = await practitionerRow();

    const response = await request(harness.server)
      .get(`${DOCTORS}/${doctor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const keys = keysDeep(response.body);

    for (const forbidden of FORBIDDEN_DOCTOR_FIELDS) {
      expect(keys, `\`${forbidden}\` must never reach a patient`).not.toContain(forbidden);
    }
  });

  it('does not leak a forbidden VALUE under a renamed key', async () => {
    // The keys test above catches a widened `select`. This one catches
    // the subtler failure: someone maps `licenseNumber` into a field
    // called `credentials` or `registration`. The value is what matters,
    // so the value is what is searched for in the raw serialized body.
    const { token } = await patientToken();
    const doctor = await practitionerRow();

    const response = await request(harness.server)
      .get(`${DOCTORS}/${doctor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const raw = JSON.stringify(response.body);

    expect(raw).not.toContain(doctor.licenseNumber);
    expect(raw).not.toContain(doctor.contactEmail);
    expect(raw).not.toContain(doctor.contactPhone);
    expect(raw).not.toContain(doctor.userId);
    if (doctor.employeeId !== null) expect(raw).not.toContain(doctor.employeeId);
    if (doctor.emergencyContactPhone !== null) {
      expect(raw).not.toContain(doctor.emergencyContactPhone);
    }
  });
});
