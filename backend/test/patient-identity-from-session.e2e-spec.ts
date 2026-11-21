import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import { createTestDoctor, destroyTestDoctor, type DoctorRecord } from './support/doctor-fixture';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

/**
 * The patient is the session, never an argument (AST-F1; DR-08, ADR-030).
 *
 * > AST-F1 — "No patient route or tool takes `patientId`; a supplied one
 * > is refused as an unknown key."
 *
 * This suite proves the **first half** against every patient route that
 * exists today: no route declares a patient parameter, and a `patientId`
 * smuggled in through the query string or a header — as another
 * patient's uuid or their `PT-…` handle — changes nothing. The caller
 * still sees only their own record and appointments, and another
 * patient's appointment is the same 404 as one that does not exist.
 *
 * The **second half** — *refused* (422) rather than *ignored* — is not
 * asserted here. Every query schema in the backend strips unknown keys,
 * and `account.schema.ts` records that as a deliberate convention.
 * Reversing it for patient routes is a contract change awaiting a
 * decision (batch report, BE-005); until then an unknown key is dropped
 * before it reaches a service, which is what the cases below rely on and
 * pin.
 */
let harness: AuthHarness;
let doctor: DoctorRecord;
let records: PatientRecord[];

const PREFIX = '/api/v1';
const PROFILE = `${PREFIX}/me/profile`;
const APPOINTMENTS = `${PREFIX}/me/appointments`;
const DOCTORS = `${PREFIX}/patient/doctors`;
const PATIENT_TAG = 'idss';
const DOCTOR_TAG = 'idss';
/**
 * Not `APT-T`: `patient-appointments.e2e-spec.ts` deletes every `APT-T*`
 * row between its cases, and Vitest runs the two files in parallel.
 */
const APPOINTMENT_PREFIX = 'APT-U';

interface Session {
  readonly token: string;
  readonly userId: string;
}

let alice: Session;
let bob: Session;
let aliceAppointment = '';
let bobAppointment = '';

async function signUp(local: string): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server)
    .post(`${PREFIX}/auth/register`)
    .send(registrationBody({ email, role: 'patient' }))
    .expect(201);
  await request(harness.server)
    .post(`${PREFIX}/auth/verify-email`)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);
  const login = await request(harness.server)
    .post(`${PREFIX}/auth/login`)
    .send({ email, password: 'Medora123!' })
    .expect(200);
  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
  return { token: dataOf<{ accessToken: string }>(login).accessToken, userId: row.id };
}

/**
 * Alice's and Bob's appointments are with the same doctor, so each takes
 * its own slot: two confirmed bookings in one slot are a double booking
 * that `appointments_no_overlap` refuses (DR-11).
 */
let nextSlot = 0;

async function seedAppointment(record: PatientRecord): Promise<string> {
  const visitType = await harness.prisma.db.visitType.findFirstOrThrow();
  const publicId = `${APPOINTMENT_PREFIX}${Math.floor(Math.random() * 1_000_000)}`;
  await harness.prisma.db.appointment.create({
    data: {
      publicId,
      patientId: record.id,
      doctorId: doctor.id,
      visitTypeId: visitType.id,
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + nextSlot++ * 60 * 60_000),
      durationMin: 30,
      status: 'CONFIRMED',
      reason: 'Routine review',
    },
  });
  return publicId;
}

async function clearAppointments(): Promise<void> {
  await harness.prisma.appointment.deleteMany({
    where: { publicId: { startsWith: APPOINTMENT_PREFIX } },
  });
}

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

beforeAll(async () => {
  harness = await createAuthHarness('patient-identity-session');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 2);
  doctor = await createTestDoctor(harness.prisma, DOCTOR_TAG);
});

afterAll(async () => {
  await clearAppointments();
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await destroyTestDoctor(harness.prisma, DOCTOR_TAG);
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  // `patients.user_id` is ON DELETE SET NULL (ADR-030): resetting this
  // suite's users releases every link it made, and nothing else.
  await harness.reset();
  await clearAppointments();

  alice = await signUp('alice');
  bob = await signUp('bob');
  await harness.prisma.db.patient.update({
    where: { id: records[0]!.id },
    data: { userId: alice.userId },
  });
  await harness.prisma.db.patient.update({
    where: { id: records[1]!.id },
    data: { userId: bob.userId },
  });
  aliceAppointment = await seedAppointment(records[0]!);
  bobAppointment = await seedAppointment(records[1]!);
});

/** The ways a client could try to name a patient other than itself. */
function smuggled(): Record<string, string>[] {
  const bobRecord = records[1]!;
  return [
    { patientId: bobRecord.id },
    { patientId: bobRecord.publicId },
    { patient_id: bobRecord.id },
    { userId: bob.userId },
  ];
}

describe('no patient route declares a patient parameter', () => {
  it('has no :patientId (or :userId) segment under /me or /patient', () => {
    const instance = harness.app.getHttpAdapter().getInstance() as {
      _router: { stack: { route?: { path: string } }[] };
    };
    const patientPaths = instance._router.stack
      .map((layer) => layer.route?.path)
      .filter((path): path is string => path !== undefined)
      .filter((path) => path.startsWith(`${PREFIX}/me`) || path.startsWith(`${PREFIX}/patient/`));

    expect(patientPaths.length).toBeGreaterThan(0);
    expect(patientPaths.filter((path) => /:(patientId|userId)\b/.test(path))).toEqual([]);
  });
});

describe('a smuggled patient id is never honoured (DR-08)', () => {
  it('GET /me/profile returns the caller’s own record whatever the query names', async () => {
    for (const query of smuggled()) {
      const response = await request(harness.server)
        .get(PROFILE)
        .query(query)
        .set(as(alice))
        .expect(200);

      const view = dataOf<{ patient: { id: string } | null }>(response);
      expect(view.patient?.id).toBe(records[0]!.publicId);
    }
  });

  it('GET /me/appointments lists only the caller’s appointments whatever the query names', async () => {
    for (const query of smuggled()) {
      const response = await request(harness.server)
        .get(APPOINTMENTS)
        .query(query)
        .set(as(alice))
        .expect(200);

      const ids = dataOf<{ items: { id: string }[] }>(response).items.map((item) => item.id);
      expect(ids).toEqual([aliceAppointment]);
      expect(ids).not.toContain(bobAppointment);
    }
  });

  it('GET /me/appointments/:id answers another patient’s appointment 404, even when the query names them', async () => {
    const unknown = await request(harness.server)
      .get(`${APPOINTMENTS}/${APPOINTMENT_PREFIX}000000`)
      .set(as(alice))
      .expect(404);

    for (const query of smuggled()) {
      const foreign = await request(harness.server)
        .get(`${APPOINTMENTS}/${bobAppointment}`)
        .query(query)
        .set(as(alice))
        .expect(404);

      // Non-disclosing (AST-F5): indistinguishable from an id that names
      // nothing, so the 404 does not confirm Bob's appointment exists.
      expect(foreign.body).toEqual(unknown.body);
    }
  });

  it('ignores a patient id carried in a header', async () => {
    const response = await request(harness.server)
      .get(APPOINTMENTS)
      .set(as(alice))
      .set('X-Patient-Id', records[1]!.id)
      .expect(200);

    const ids = dataOf<{ items: { id: string }[] }>(response).items.map((item) => item.id);
    expect(ids).toEqual([aliceAppointment]);
  });

  it('GET /patient/doctors is unaffected by a patient id — discovery is not patient-scoped', async () => {
    // Not compared against a plain request: the directory is platform-wide,
    // and suites running in parallel verify and suspend doctors between any
    // two calls, so two pages taken a moment apart can legitimately differ.
    // What must hold is that a smuggled id neither fails the request nor
    // brings any patient into the response.
    const bobRecord = records[1]!;

    for (const query of smuggled()) {
      const response = await request(harness.server)
        .get(DOCTORS)
        .query(query)
        .set(as(alice))
        .expect(200);

      expect(response.text).not.toContain(bobRecord.id);
      expect(response.text).not.toContain(bobRecord.publicId);
      expect(response.text).not.toContain(bob.userId);
      expect(Object.keys(dataOf<Record<string, unknown>>(response))).not.toContain('patient');
    }
  });
});
