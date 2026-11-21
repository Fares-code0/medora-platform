import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness } from './support/auth-app';

/**
 * Response headers and CORS — RM M37.1.
 *
 * > ✅ Verify: header snapshot test; audit report clean.
 *
 * The harness registers `applySecurityHeaders` and `applyCors` exactly as
 * `main.ts` does, so these are the headers that ship. The health route is
 * used because it is public and touches no fixture; an authenticated
 * route and an error response are checked too, because a policy applied
 * only to successful public responses is a policy with holes.
 */
let harness: AuthHarness;

const HEALTH = '/api/v1/health';
const ALLOWED_ORIGIN = 'http://localhost:5173';

beforeAll(async () => {
  harness = await createAuthHarness('http-hardening-m37');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

/** The headers M37.1 fixes, picked out so the snapshot is exact and stable. */
function policyOf(headers: Record<string, string | string[] | undefined>) {
  const pick = (name: string) => headers[name];

  return {
    'content-security-policy': pick('content-security-policy'),
    'strict-transport-security': pick('strict-transport-security'),
    'x-content-type-options': pick('x-content-type-options'),
    'x-frame-options': pick('x-frame-options'),
    'referrer-policy': pick('referrer-policy'),
    'cross-origin-opener-policy': pick('cross-origin-opener-policy'),
    'cross-origin-resource-policy': pick('cross-origin-resource-policy'),
    'x-powered-by': pick('x-powered-by'),
  };
}

const EXPECTED = {
  'content-security-policy': "default-src 'none';frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-powered-by': undefined,
};

describe('M37.1 — the header policy', () => {
  it('sends the full policy on a public response', async () => {
    const response = await request(harness.server).get(HEALTH);

    expect(policyOf(response.headers)).toEqual(EXPECTED);
  });

  it('sends it on an error response too', async () => {
    // Unauthenticated → 401 from the guard, well after the middleware.
    const response = await request(harness.server).get('/api/v1/patients');

    expect(response.status).toBe(401);
    expect(policyOf(response.headers)).toEqual(EXPECTED);
  });

  it('sends it on a body the parser refuses before any route runs', async () => {
    const response = await request(harness.server)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(200 * 1024) }));

    expect(response.status).toBe(413);
    expect(policyOf(response.headers)).toEqual(EXPECTED);
  });
});

describe('M37.1 — CORS is exact-origin and credentialed', () => {
  it('echoes an allowed origin with credentials, never a wildcard', async () => {
    const response = await request(harness.server).get(HEALTH).set('Origin', ALLOWED_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('gives an unlisted origin no Access-Control-Allow-Origin at all', async () => {
    const response = await request(harness.server)
      .get(HEALTH)
      .set('Origin', 'https://attacker.example');

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers a preflight from an allowed origin, carrying the header policy', async () => {
    const response = await request(harness.server)
      .options('/api/v1/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(policyOf(response.headers)).toEqual(EXPECTED);
  });
});

describe('M32.3 — conditional GET', () => {
  // The badge-polling herd (M32.1) is N clients asking every 10–15 s for
  // an answer that rarely changes. A weak ETag lets a client revalidate
  // and get a bodiless 304 instead of the same JSON again.
  it('tags a JSON response and answers a matching If-None-Match with a bodiless 304', async () => {
    const first = await request(harness.server).get(HEALTH);
    const etag = first.headers['etag'];

    expect(first.status).toBe(200);
    expect(etag).toMatch(/^W\/".+"$/);

    const again = await request(harness.server)
      .get(HEALTH)
      .set('If-None-Match', etag ?? '');
    expect(again.status).toBe(304);
    expect(again.text ?? '').toBe('');
  });

  it('answers 200 with the body when the tag no longer matches', async () => {
    const stale = await request(harness.server).get(HEALTH).set('If-None-Match', 'W/"stale"');
    expect(stale.status).toBe(200);
    expect(stale.body).toHaveProperty('data');
  });
});
