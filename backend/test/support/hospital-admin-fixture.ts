/**
 * Shared fixtures for the hospital-administration and insurance e2e specs
 * (ADM-01, ADM-03): signed-in administrators of each tier, a doctor and a
 * patient, and throw-away hospitals.
 */

import { randomUUID } from 'node:crypto';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';

import {
  type AuthHarness,
  dataOf,
  grantPlatformAdmin,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
} from './auth-app';

export const PASSWORD = 'Medora123!';
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';

export const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function currentCode(secret: string): string {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) }).generate();
}

async function accessToken(harness: AuthHarness, email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ accessToken: string }>(response).accessToken;
}

/** A registered, verified, unemployed doctor: signed in, no clinical standing. */
export async function seedDoctorToken(harness: AuthHarness, local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return accessToken(harness, email);
}

export async function seedPatientToken(harness: AuthHarness, local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(patientRegistrationBody({ email }));
  await markVerified(harness.prisma, email);
  return accessToken(harness, email);
}

/** An administrator with a second factor; scope as given. */
export async function seedAdminToken(
  harness: AuthHarness,
  local: string,
  scope: { platform: true } | { hospitalId: string } | 'none',
): Promise<{ email: string; token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const bootstrap = await accessToken(harness, email);
  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set(as(bootstrap))
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;
  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const user = await harness.prisma.user.update({
    where: { email },
    data: { roleId: adminRole.id },
    select: { id: true },
  });
  if (scope !== 'none' && 'platform' in scope) await grantPlatformAdmin(harness.prisma, email);
  if (scope !== 'none' && 'hospitalId' in scope) {
    await harness.prisma.hospitalRoleAssignment.create({
      data: { userId: user.id, hospitalId: scope.hospitalId, roleId: adminRole.id },
    });
  }

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });
  return { email, token: dataOf<{ accessToken: string }>(verified).accessToken, userId: user.id };
}

/** An ACTIVE hospital written straight to the database. */
export async function makeHospital(harness: AuthHarness, name: string): Promise<string> {
  const row = await harness.prisma.hospital.create({
    data: { publicId: 'hsp_' + randomUUID(), name: `${name} ${randomUUID().slice(0, 8)}` },
    select: { id: true },
  });
  return row.id;
}

/** Removes the role assignments that would block deleting the suite's accounts. */
export async function cleanupAdmins(harness: AuthHarness): Promise<void> {
  const users = await harness.prisma.user.findMany({
    where: { email: { endsWith: testEmail('x').slice(1) } },
    select: { id: true },
  });
  await harness.prisma.hospitalRoleAssignment.deleteMany({
    where: { userId: { in: users.map((user) => user.id) } },
  });
}
