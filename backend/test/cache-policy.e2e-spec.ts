import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NO_STORE, REVALIDATE_PRIVATELY } from '../src/common/http/cache-policy';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * The HTTP cache policy (RM M32.3, `common/http/cache-policy.ts`).
 *
 * `no-store` on everything, including errors and auth, except four routes of
 * PHI-free reference data, which are `private, no-cache`: the browser
 * revalidates, and no shared cache keeps a copy. These cases walk one route
 * of every response category the API has.
 */
let harness: AuthHarness;
let token = '';
let refreshCookie: string[] = [];

const API = '/api/v1';
const as = () => ({ Authorization: `Bearer ${token}` });

/** One authenticated GET per category of sensitive response. */
const SENSITIVE: readonly string[] = [
  '/patients',
  '/medical-records',
  '/prescriptions',
  '/lab-orders',
  '/lab-orders/summary',
  '/appointments?view=list',
  '/dashboard/doctor',
  '/notifications',
  '/notifications/badge-counts',
  '/conversations',
  '/me/profile',
  '/me/account',
  '/patients/export',
];

const REFERENCE: readonly string[] = ['/meta/enums', '/medications?q=Am', '/lab-tests/catalogue'];

beforeAll(async () => {
  harness = await createAuthHarness('cache-policy-m32', { clinicalDoctors: true });

  const email = testEmail('cache-policy');
  await request(harness.server).post(`${API}/auth/register`).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const login = await request(harness.server)
    .post(`${API}/auth/login`)
    .send({ email, password: 'Medora123!', rememberMe: true });
  token = dataOf<{ accessToken: string }>(login).accessToken;
  const cookies = login.headers['set-cookie'];
  refreshCookie = Array.isArray(cookies) ? cookies : [];
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.reset();
  await harness.close();
});

describe('sensitive responses are never stored', () => {
  for (const path of SENSITIVE) {
    it(`GET ${path} → no-store`, async () => {
      const response = await request(harness.server).get(`${API}${path}`).set(as());

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe(NO_STORE);
    });
  }

  it('a sign-in response, which carries the tokens, is no-store', async () => {
    const response = await request(harness.server)
      .post(`${API}/auth/login`)
      .send({ email: testEmail('cache-policy'), password: 'Medora123!', rememberMe: false });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe(NO_STORE);
  });

  it('a refresh response is no-store', async () => {
    const response = await request(harness.server)
      .post(`${API}/auth/refresh`)
      .set('Cookie', refreshCookie)
      .send({});

    expect([200, 201]).toContain(response.status);
    expect(response.headers['cache-control']).toBe(NO_STORE);
  });
});

describe('errors are never stored either', () => {
  it('401 without a token', async () => {
    const response = await request(harness.server).get(`${API}/patients`);

    expect(response.status).toBe(401);
    expect(response.headers['cache-control']).toBe(NO_STORE);
  });

  it('404 on an unknown route', async () => {
    const response = await request(harness.server).get(`${API}/no-such-route`).set(as());

    expect(response.status).toBe(404);
    expect(response.headers['cache-control']).toBe(NO_STORE);
  });

  it('a 404 from a reference route keeps no-store, not the route’s revalidate policy', async () => {
    const response = await request(harness.server)
      .get(`${API}/medications/00000000-0000-4000-8000-000000000000/monograph`)
      .set(as());

    expect(response.status).toBe(404);
    expect(response.headers['cache-control']).toBe(NO_STORE);
  });
});

describe('reference data is revalidated, privately', () => {
  for (const path of REFERENCE) {
    it(`GET ${path} → private, no-cache, and a matching ETag answers 304`, async () => {
      const first = await request(harness.server).get(`${API}${path}`).set(as());

      expect(first.status).toBe(200);
      expect(first.headers['cache-control']).toBe(REVALIDATE_PRIVATELY);
      const etag = first.headers['etag'];
      expect(etag).toBeTruthy();

      const again = await request(harness.server)
        .get(`${API}${path}`)
        .set(as())
        .set('If-None-Match', etag ?? '');
      expect(again.status).toBe(304);
      expect(again.text ?? '').toBe('');
    });
  }
});

describe('nothing is public', () => {
  it('no response, of any route walked here, allows a shared cache to store it', async () => {
    const paths = [...SENSITIVE, ...REFERENCE, '/health'];

    for (const path of paths) {
      const response = await request(harness.server).get(`${API}${path}`).set(as());
      const policy = String(response.headers['cache-control'] ?? '');

      expect(policy, path).not.toMatch(/public|s-maxage|max-age=[1-9]/);
      expect(policy === NO_STORE || policy === REVALIDATE_PRIVATELY, path).toBe(true);
    }
  });
});
