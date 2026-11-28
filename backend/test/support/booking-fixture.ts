import { randomUUID } from 'node:crypto';

import request from 'supertest';

import {
  type AuthHarness,
  dataOf,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './auth-app';

/**
 * Fixtures for the published-slot and patient-booking suites (SLT-01…05).
 *
 * Every doctor and patient account is the calling suite's own (its email
 * domain), so `harness.reset()` removes them — and, through
 * `deleteWithDependents` on their employments, the slots and the
 * appointments that reference those employments.
 */

export const PUBLISHED_SLOTS = '/api/v1/me/published-slots';
export const ME_APPOINTMENTS = '/api/v1/me/appointments';
const PASSWORD = 'Medora123!';

export interface DoctorSession {
  readonly token: string;
  readonly doctorId: string;
  readonly hospitalId: string;
  readonly email: string;
}

export interface PatientSession {
  readonly token: string;
  readonly userId: string;
}

async function login(harness: AuthHarness, email: string): Promise<string> {
  const response = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, rememberMe: false });
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${String(response.status)}`);
  }
  return dataOf<{ accessToken: string }>(response).accessToken;
}

/** A verified doctor in clinical standing at fixture hospital `hospitalKey`. */
export async function bookingDoctor(
  harness: AuthHarness,
  local: string,
  hospitalKey = 'a',
): Promise<DoctorSession> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const hospital = await fixtureHospital(harness.prisma, hospitalKey);
  const { doctorId, hospitalId } = await makeClinicalDoctor(harness.prisma, email, hospital);

  return { token: await login(harness, email), doctorId, hospitalId, email };
}

/**
 * A signed-in patient account, linked to `patientId` when given (an
 * unlinked account otherwise — RA-030.1).
 */
export async function bookingPatient(
  harness: AuthHarness,
  local: string,
  patientId?: string,
): Promise<PatientSession> {
  const email = testEmail(local);
  await request(harness.server)
    .post('/api/v1/auth/register')
    .send(patientRegistrationBody({ email }));
  await markVerified(harness.prisma, email);
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
  if (patientId !== undefined) {
    await harness.prisma.patient.update({ where: { id: patientId }, data: { userId: user.id } });
  }

  return { token: await login(harness, email), userId: user.id };
}

/** An instant `days` from now at `HH:MM` UTC — clear of midnight in any sane zone. */
export function futureAt(days: number, time: string): string {
  const day = new Date(Date.now() + days * 86_400_000);
  const date = day.toISOString().slice(0, 10);
  return `${date}T${time}:00.000Z`;
}

export function publish(doctor: { token: string }, body: unknown): Promise<request.Response> {
  return request(app())
    .post(PUBLISHED_SLOTS)
    .set('Authorization', `Bearer ${doctor.token}`)
    .send(body as object)
    .then((response) => response);
}

/** Publishes one slot and returns its id. */
export async function publishOne(
  doctor: { token: string },
  startsAt: string,
  durationMin = 30,
): Promise<string> {
  const response = await publish(doctor, { startsAt, durationMin });
  if (response.status !== 201) {
    throw new Error(`publish failed: ${String(response.status)} ${JSON.stringify(response.body)}`);
  }
  return dataOf<{ id: string }[]>(response)[0]!.id;
}

export function bookSlot(
  patient: { token: string },
  body: Record<string, unknown>,
  key: string | null = randomUUID(),
): Promise<request.Response> {
  let call = request(app()).post(ME_APPOINTMENTS).set('Authorization', `Bearer ${patient.token}`);
  if (key !== null) call = call.set('Idempotency-Key', key);
  return call.send(body).then((response) => response);
}

/**
 * The server the fixtures talk to. Set once per suite by `useServer` —
 * kept module-level so the helpers above read like the requests they make.
 */
let server: AuthHarness['server'] | undefined;

export function useServer(harnessValue: AuthHarness): void {
  server = harnessValue.server;
}

function app(): AuthHarness['server'] {
  if (server === undefined) throw new Error('booking-fixture: call useServer(harness) first');
  return server;
}
