/**
 * Outside clinical standing, only the allowlist (multi-hospital §2.6;
 * audit finding F-09).
 *
 * A doctor who is unverified, never employed, or suspended reaches their
 * own account, profile, security settings, session and verification
 * documents — and nothing else: not the `@Authenticated()` routes that ask
 * for no capability (search, notifications, availability, settings,
 * messaging, catalogues, controlled access), and not the clinical or
 * administrative ones. The same doctor in clinical standing reaches them.
 */

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

const PASSWORD = 'Medora123!';
let harness: AuthHarness;

const ALLOWED = [
  '/api/v1/me/profile',
  '/api/v1/me/account',
  '/api/v1/me/2fa',
  '/api/v1/me/sessions',
  '/api/v1/auth/session',
  '/api/v1/me/verification-documents',
  '/api/v1/meta/enums',
];

const REFUSED = [
  '/api/v1/search?q=ab',
  '/api/v1/notifications',
  '/api/v1/me/notification-preferences',
  '/api/v1/me/availability',
  '/api/v1/me/time-off',
  '/api/v1/me/settings',
  '/api/v1/conversations',
  '/api/v1/messages/search?q=ab',
  '/api/v1/lab-tests/catalogue',
  '/api/v1/medications',
  '/api/v1/patients',
  '/api/v1/medical-records',
  '/api/v1/appointments',
  '/api/v1/dashboard/doctor',
];

async function doctor(local: string): Promise<{ token: string; email: string }> {
  const email = testEmail(local);
  expect((await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }))).status).toBe(
    201,
  );
  await markVerified(harness.prisma, email);
  return { token: await login(email), email };
}

async function login(email: string): Promise<string> {
  const response = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function statusOf(token: string, path: string): Promise<{ status: number; code: string | undefined }> {
  const response = await request(harness.server).get(path).set({ Authorization: `Bearer ${token}` });
  return { status: response.status, code: (response.body as { code?: string }).code };
}

beforeAll(async () => {
  harness = await createAuthHarness('standing-allowlist');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe.each([
  ['an unverified, never-employed doctor', 'never'],
  ['a suspended doctor', 'suspended'],
])('%s', (_label, kind) => {
  let token = '';

  beforeAll(async () => {
    const created = await doctor(`allowlist-${kind}`);
    token = created.token;
    if (kind === 'suspended') {
      await makeClinicalDoctor(harness.prisma, created.email, await fixtureHospital(harness.prisma));
      await harness.prisma.doctor.updateMany({
        where: { user: { is: { email: created.email } } },
        data: { practiceStatus: 'SUSPENDED' },
      });
      await harness.prisma.user.update({
        where: { email: created.email },
        data: { authzVersion: { increment: 1 } },
      });
    }
  });

  it.each(ALLOWED)('reaches its own %s', async (path) => {
    const { status } = await statusOf(token, path);
    expect(status, path).toBe(200);
  });

  it.each(REFUSED)('is refused %s', async (path) => {
    const { status, code } = await statusOf(token, path);
    expect(status, path).toBe(403);
    expect(code, path).toBe('clinical_standing_required');
  });

  it('may upload only a verification document', async () => {
    const response = await request(harness.server)
      .post('/api/v1/files')
      .set({ Authorization: `Bearer ${token}` })
      .field('kind', 'patient_document')
      .attach('file', Buffer.from('%PDF-1.4\n%probe\n'), { filename: 'probe.pdf', contentType: 'application/pdf' });
    expect(response.status).toBe(403);
    expect((response.body as { code?: string }).code).toBe('clinical_standing_required');
  });
});

describe('the same doctor in clinical standing', () => {
  it('reaches the routes an account outside standing is refused', async () => {
    const created = await doctor('allowlist-clinical');
    await makeClinicalDoctor(harness.prisma, created.email, await fixtureHospital(harness.prisma));
    const token = await login(created.email);
    for (const path of ['/api/v1/notifications', '/api/v1/me/settings', '/api/v1/search?q=ab', '/api/v1/patients']) {
      const { status } = await statusOf(token, path);
      expect(status, path).toBe(200);
    }
  });
});
