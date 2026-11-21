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
 * A patient's own appointments — contract §4.1/§4.2, reads only.
 *
 * The security property under test is **isolation**: patient A must not
 * see, address or count patient B's appointments, and the response must
 * not tell the difference between "not yours" and "does not exist".
 *
 * The write routes (book, cancel, confirm, slots) are deliberately not
 * implemented — each needs a policy no source states — so there is
 * nothing here to test for them, and their absence is asserted rather
 * than assumed.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const VERIFY = '/api/v1/auth/verify-email';
const APPOINTMENTS = '/api/v1/me/appointments';
const PASSWORD = 'Medora123!';

interface Session {
  readonly token: string;
  readonly userId: string;
}

/**
 * This file's own clinical records.
 *
 * `linkTo` used to reach for the seeded `PT-1001`/`PT-1002` by index,
 * which is the same pair `patient-api` and `patient-identity` reached
 * for. The `beforeEach` note below was already careful not to unlink
 * another suite's fixtures — but borrowing the row in the first place
 * was the other half of that hazard. See `support/patient-fixture.ts`.
 */
let records: PatientRecord[];
const PATIENT_TAG = 'appt';

/**
 * This file's own practitioner (RA-M10.1).
 *
 * `seedAppointment` used to reach for `doctor.findFirstOrThrow()` with
 * no `where` at all, which is the doctor-shaped form of the hazard the
 * records above already fixed for patients: the row it returns belongs
 * to whichever suite happens to be running, and hanging a `CONFIRMED`
 * appointment off it makes that suite's `harness.reset()` fail with
 * `appointments_doctor_id_fkey` while every test in *this* file passes.
 * See `support/doctor-fixture.ts`.
 */
let doctor: DoctorRecord;
const DOCTOR_TAG = 'appt';

beforeAll(async () => {
  harness = await createAuthHarness('patient-appts');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 2);
  doctor = await createTestDoctor(harness.prisma, DOCTOR_TAG);
});

afterAll(async () => {
  await clearSeededAppointments();
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await destroyTestDoctor(harness.prisma, DOCTOR_TAG);
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  // `harness.reset()` deletes this suite's users by email suffix, and
  // `patients.user_id` is `ON DELETE SET NULL` (ADR-030) — so every link
  // this suite made is released automatically, without touching a row
  // another spec file is using. Vitest runs files in parallel, so a
  // blanket `updateMany({ data: { userId: null } })` would unlink
  // another suite's fixtures mid-run: a failure that appears only in a
  // full-suite run and never when this file runs alone.
  await harness.reset();
  await clearSeededAppointments();
});

/**
 * Appointments outlive `reset()` on purpose.
 *
 * `appointments.patient_id` is `ON DELETE RESTRICT` (DB §9) — a patient
 * with appointments is deactivated, never deleted — so deleting this
 * suite's users leaves its appointments behind, and they accumulate
 * across cases until a "newest first" assertion starts reading a
 * neighbour's fixture.
 *
 * The prefix is this file's own. It used to be the bare `APT-T`, which
 * every suite's test appointments share (`doctor-dashboard` writes
 * `APT-Td27…`, `search` writes `APT-Ts26…`), so this cleanup deleted
 * theirs whenever the files ran together: the dashboard spec then read a
 * doctor with no appointments and failed five cases, in a full-suite run
 * only (2026-10-31). The trailing hyphen keeps any other tag from
 * extending it.
 */
const APPOINTMENT_PREFIX = 'APT-Tappt-';

async function clearSeededAppointments(): Promise<void> {
  await harness.prisma.appointment.deleteMany({
    where: { publicId: { startsWith: APPOINTMENT_PREFIX } },
  });
}

async function signUp(local: string, role = 'patient'): Promise<Session> {
  const email = testEmail(local);

  await request(harness.server).post(REGISTER).send(registrationBody({ email, role })).expect(201);

  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD })
    .expect(200);

  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return { token: dataOf<{ accessToken: string }>(login).accessToken, userId: row.id };
}

/** Links a session to one of this file's own records, returning its `PT-…` id. */
async function linkTo(session: Session, index: number): Promise<string> {
  const record = records[index]!;

  await harness.prisma.db.patient.update({
    where: { id: record.id },
    data: { userId: session.userId },
  });

  return record.publicId;
}

/** Creates an appointment for a patient, returning its `APT-…` id. */
async function seedAppointment(patientPublicId: string, startsAt: Date): Promise<string> {
  const patient = await harness.prisma.db.patient.findUniqueOrThrow({
    where: { publicId: patientPublicId },
  });
  const visitType = await harness.prisma.db.visitType.findFirstOrThrow();
  const publicId = `${APPOINTMENT_PREFIX}${Math.floor(Math.random() * 1_000_000)}`;

  await harness.prisma.db.appointment.create({
    data: {
      publicId,
      patientId: patient.id,
      doctorId: doctor.id,
      visitTypeId: visitType.id,
      startsAt,
      durationMin: 30,
      status: 'CONFIRMED',
      reason: 'Follow-up on blood pressure',
    },
  });

  return publicId;
}

describe('GET /me/appointments', () => {
  it('refuses an unauthenticated request', async () => {
    await request(harness.server).get(APPOINTMENTS).expect(401);
  });

  it('returns an empty page for an account with no clinical record', async () => {
    // The normal state after registration. An empty list, not a 404 —
    // a 404 on one's own collection reads as a broken session.
    const session = await signUp('sara');

    const response = await request(harness.server)
      .get(APPOINTMENTS)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    const page = dataOf<{ items: unknown[]; totalItems: number; clinicTimezone: string }>(response);

    expect(page.items).toEqual([]);
    expect(page.totalItems).toBe(0);
    expect(page.clinicTimezone).toBeTruthy();
  });

  it('returns only the caller’s own appointments', async () => {
    const mine = await signUp('sara');
    const theirs = await signUp('omar');

    const minePt = await linkTo(mine, 0);
    const theirsPt = await linkTo(theirs, 1);

    const mineApt = await seedAppointment(minePt, new Date('2026-10-01T09:00:00Z'));
    const theirsApt = await seedAppointment(theirsPt, new Date('2026-10-02T09:00:00Z'));

    const response = await request(harness.server)
      .get(`${APPOINTMENTS}?pageSize=100`)
      .set('Authorization', `Bearer ${mine.token}`)
      .expect(200);

    const ids = dataOf<{ items: { id: string }[] }>(response).items.map((item) => item.id);

    expect(ids).toContain(mineApt);
    expect(ids).not.toContain(theirsApt);
  });

  it('serves ISO-8601 UTC timestamps alongside the clinic timezone', async () => {
    // Audit R-12: the client formats, never computes. "Today" is a
    // question about the clinic's zone, not the device's.
    const session = await signUp('sara');
    const pt = await linkTo(session, 0);
    await seedAppointment(pt, new Date('2026-10-01T09:00:00Z'));

    const response = await request(harness.server)
      .get(APPOINTMENTS)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    const page = dataOf<{ items: { startsAt: string; status: string }[]; clinicTimezone: string }>(
      response,
    );

    expect(page.items[0]!.startsAt).toBe('2026-10-01T09:00:00.000Z');
    expect(page.clinicTimezone).toBe('UTC');
    // ADR-023: the wire vocabulary, never the Prisma member name.
    expect(page.items[0]!.status).toBe('confirmed');
  });

  it('filters by status using the wire vocabulary', async () => {
    const session = await signUp('sara');
    const pt = await linkTo(session, 0);
    const apt = await seedAppointment(pt, new Date('2026-10-01T09:00:00Z'));

    const match = await request(harness.server)
      .get(`${APPOINTMENTS}?status=confirmed`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    expect(dataOf<{ items: { id: string }[] }>(match).items.map((i) => i.id)).toContain(apt);

    const miss = await request(harness.server)
      .get(`${APPOINTMENTS}?status=cancelled`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    expect(dataOf<{ items: { id: string }[] }>(miss).items.map((i) => i.id)).not.toContain(apt);
  });

  it('rejects a status outside the ADR-001 vocabulary', async () => {
    const session = await signUp('sara');

    await request(harness.server)
      .get(`${APPOINTMENTS}?status=no_show`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(422);
  });

  it('rejects an over-cap pageSize and an unwhitelisted sort', async () => {
    const session = await signUp('sara');

    await request(harness.server)
      .get(`${APPOINTMENTS}?pageSize=5000`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(422);

    await request(harness.server)
      .get(`${APPOINTMENTS}?sort=doctorId:asc`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(422);
  });

  it('honours upcoming=true against the server clock', async () => {
    const session = await signUp('sara');
    const pt = await linkTo(session, 0);

    const past = await seedAppointment(pt, new Date('2020-01-01T09:00:00Z'));
    const future = await seedAppointment(pt, new Date('2030-01-01T09:00:00Z'));

    const response = await request(harness.server)
      .get(`${APPOINTMENTS}?upcoming=true&pageSize=100`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    const ids = dataOf<{ items: { id: string }[] }>(response).items.map((i) => i.id);

    expect(ids).toContain(future);
    expect(ids).not.toContain(past);
  });
});

describe('GET /me/appointments/:id', () => {
  it('answers 404 for another patient’s appointment — never 403', async () => {
    // A 403 would confirm the appointment exists, letting a patient walk
    // `APT-…` ids and learn the clinic's booking volume without reading
    // one. The enumeration is the disclosure.
    const mine = await signUp('sara');
    const theirs = await signUp('omar');

    await linkTo(mine, 0);
    const theirsPt = await linkTo(theirs, 1);
    const theirsApt = await seedAppointment(theirsPt, new Date('2026-10-02T09:00:00Z'));

    const response = await request(harness.server)
      .get(`${APPOINTMENTS}/${theirsApt}`)
      .set('Authorization', `Bearer ${mine.token}`);

    expect(response.status).toBe(404);
  });

  it('answers 404 identically for an id that does not exist', async () => {
    const session = await signUp('sara');
    await linkTo(session, 0);

    await request(harness.server)
      .get(`${APPOINTMENTS}/APT-does-not-exist`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(404);
  });

  it('returns the detail with an event history carrying no staff identity', async () => {
    // An appointment history is not a route into the clinic's staff
    // directory: `actor` is a coarse category and `actorName` is never
    // projected.
    const session = await signUp('sara');
    const pt = await linkTo(session, 0);
    const apt = await seedAppointment(pt, new Date('2026-10-01T09:00:00Z'));

    const appointment = await harness.prisma.db.appointment.findUniqueOrThrow({
      where: { publicId: apt },
    });

    // The actor is deliberately an ADMIN, not the treating doctor. The
    // treating doctor's name is *legitimately* in this payload — a
    // patient must be able to see who they are seeing — so using them as
    // the actor would make the assertion below pass for the wrong
    // reason. An administrator who touched the booking appears nowhere
    // else, so their name is a clean probe for the leak.
    const actor = await harness.prisma.user.findFirstOrThrow({
      where: { role: { code: 'admin' } },
    });

    await harness.prisma.db.appointmentEvent.create({
      data: {
        appointmentId: appointment.id,
        action: 'APPROVE',
        fromStatus: 'PENDING',
        toStatus: 'CONFIRMED',
        actorId: actor.id,
        actorName: actor.displayName,
        reason: 'Approved',
      },
    });

    const response = await request(harness.server)
      .get(`${APPOINTMENTS}/${apt}`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    const detail = dataOf<{ events: { actor: string; action: string }[] }>(response);
    const raw = JSON.stringify(response.body);

    expect(detail.events).toHaveLength(1);
    expect(detail.events[0]!.actor).toBe('clinic');
    expect(detail.events[0]!.action).toBe('approve');
    expect(raw).not.toContain(actor.displayName);
    expect(raw).not.toContain(actor.email);
    expect(raw).not.toContain('actorName');
    expect(raw).not.toContain(actor.id);
  });

  it('does not leak the doctor’s internal fields through the appointment', async () => {
    // The embedded doctor is contract §3's safe projection. A widened
    // select here would leak a licence number through the appointments
    // route instead of the doctors one.
    const session = await signUp('sara');
    const pt = await linkTo(session, 0);
    const apt = await seedAppointment(pt, new Date('2026-10-01T09:00:00Z'));

    const response = await request(harness.server)
      .get(`${APPOINTMENTS}/${apt}`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    // The doctor actually **on** the appointment, by id. Reading an
    // arbitrary row here would make the three assertions below vacuous:
    // a response can hardly leak the licence number of a practitioner it
    // never mentions, so the test would pass whatever the projection did.
    const attending = await harness.prisma.db.doctor.findUniqueOrThrow({
      where: { id: doctor.id },
    });
    const raw = JSON.stringify(response.body);

    expect(raw).not.toContain(attending.licenseNumber);
    expect(raw).not.toContain(attending.contactPhone);
    expect(raw).not.toContain(attending.contactEmail);
    expect(raw).not.toContain('licenseNumber');
  });
});

describe('the write routes are absent, not half-built', () => {
  it('does not expose booking, cancel or confirm', async () => {
    // Each needs a policy no source states (contract §4). Their absence
    // is asserted so that adding one is a deliberate act with a decision
    // behind it, rather than something that appears by accident.
    const session = await signUp('sara');
    const pt = await linkTo(session, 0);
    const apt = await seedAppointment(pt, new Date('2026-10-01T09:00:00Z'));

    for (const path of [
      APPOINTMENTS,
      `${APPOINTMENTS}/${apt}/cancel`,
      `${APPOINTMENTS}/${apt}/confirm`,
    ]) {
      const response = await request(harness.server)
        .post(path)
        .set('Authorization', `Bearer ${session.token}`)
        .send({});

      expect([403, 404], `POST ${path}`).toContain(response.status);
    }
  });
});
