import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MAINTENANCE_MESSAGE } from '../src/modules/auth/guards/maintenance-mode.guard';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * Maintenance mode (RM M38.3, API §19.7).
 *
 * > ✅ Verify: flag on → non-admin 503, admin passes.
 *
 * The flag is steered through the harness's in-memory policy source —
 * the same layer `PolicyService` resolves the `general` slice through —
 * so this suite never writes the shared `platform_settings` row that
 * other suites read concurrently.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PROFILE = '/api/v1/me/profile';
const SETTINGS = '/api/v1/platform-settings';
const HEALTH = '/api/v1/health';
const PASSWORD = 'Medora123!';

let doctorToken = '';
let adminToken = '';

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function signUpDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).accessToken;
}

/** ADR-035 §7's bootstrap: enrol a factor, take the role, step up. */
async function signUpAdmin(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(harness.server)
      .post('/api/v1/me/2fa/setup')
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ password: PASSWORD }),
  ).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const otpToken = dataOf<{ otpToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function maintenance(on: boolean, message = ''): void {
  harness.policy.overrides = { maintenanceMode: on, maintenanceMessage: message };
}

beforeAll(async () => {
  harness = await createAuthHarness('maintenance');
  doctorToken = await signUpDoctor('maint-doctor');
  adminToken = await signUpAdmin('maint-admin');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(() => {
  maintenance(false);
});

describe('flag off — nothing changes', () => {
  it('serves a doctor normally', async () => {
    const response = await request(harness.server).get(PROFILE).set(as(doctorToken));

    expect(response.status).toBe(200);
  });
});

describe('flag on — non-administrators get 503 + message (API §19.7)', () => {
  it('refuses a doctor with 503 service_unavailable and the configured message', async () => {
    maintenance(true, 'Scheduled upgrade until 22:00 UTC.');

    const response = await request(harness.server).get(PROFILE).set(as(doctorToken));

    expect(response.status).toBe(503);
    expect(errorBody(response).code).toBe('service_unavailable');
    expect(errorBody(response).message).toBe('Scheduled upgrade until 22:00 UTC.');
    // 5xx carries the support `ref` (API §0.3).
    expect(errorBody(response).ref).toEqual(expect.any(String));
  });

  it('falls back to a default message when none is configured', async () => {
    maintenance(true, '   ');

    const response = await request(harness.server).get(PROFILE).set(as(doctorToken));

    expect(response.status).toBe(503);
    expect(errorBody(response).message).toBe(DEFAULT_MAINTENANCE_MESSAGE);
  });

  it('refuses writes as well as reads', async () => {
    maintenance(true, 'Down for maintenance.');

    const response = await request(harness.server)
      .patch(PROFILE)
      .set(as(doctorToken))
      .send({ bio: 'Written during maintenance' });

    expect(response.status).toBe(503);
  });

  it('takes effect immediately and lifts immediately — no restart, no cache', async () => {
    maintenance(true);
    expect((await request(harness.server).get(PROFILE).set(as(doctorToken))).status).toBe(503);

    maintenance(false);
    expect((await request(harness.server).get(PROFILE).set(as(doctorToken))).status).toBe(200);
  });
});

describe('flag on — who still passes', () => {
  it('lets an administrator through, so they can switch it off again', async () => {
    maintenance(true, 'Down for maintenance.');

    const response = await request(harness.server).get(SETTINGS).set(as(adminToken));

    expect(response.status).toBe(200);
  });

  it('keeps the health probe answering, so an orchestrator does not restart-loop', async () => {
    maintenance(true);

    const response = await request(harness.server).get(HEALTH);

    expect(response.status).not.toBe(503);
  });

  it('keeps sign-in open, because the caller has not yet said who they are', async () => {
    maintenance(true);

    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email: testEmail('maint-doctor'), password: PASSWORD });

    expect(response.status).toBe(200);
  });

  it('still answers an unauthenticated call 401, not 503', async () => {
    // Authentication runs first; the maintenance window does not reveal
    // anything to a caller with no token, nor change ADR-013's semantics.
    maintenance(true);

    const response = await request(harness.server).get(PROFILE);

    expect(response.status).toBe(401);
  });
});
