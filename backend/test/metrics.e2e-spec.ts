import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
  makeClinicalDoctor,
} from './support/auth-app';

/**
 * `GET /api/v1/metrics` over HTTP (RM M38.1).
 *
 * What is verified: the token gate, the exposition format, that requests
 * the router never matched and requests a body parser refused are
 * counted, and that a label carries the route **pattern**, never the path
 * a client sent. What is not: any monitoring backend scraping it — none is
 * configured (`docs/EXTERNAL_INTEGRATIONS.md`). The unset-token 404 is
 * `metrics.controller.spec.ts`.
 */

const METRICS = '/api/v1/metrics';
const TOKEN = 'metrics-scrape-token-for-this-suite-only-000';

let harness: AuthHarness;

const scrape = () => request(harness.server).get(METRICS).set('Authorization', `Bearer ${TOKEN}`);

/** The value of one exact series line, or undefined when absent. */
function series(text: string, line: string): number | undefined {
  const found = text.split('\n').find((candidate) => candidate.startsWith(`${line} `));
  return found === undefined ? undefined : Number(found.slice(line.length + 1));
}

beforeAll(async () => {
  // Memoised at boot, so it applies to this file's application only, and is
  // restored at once so the next spec file in this worker does not inherit it.
  const saved = process.env['METRICS_TOKEN'];
  process.env['METRICS_TOKEN'] = TOKEN;
  try {
    harness = await createAuthHarness('metrics-m381');
  } finally {
    if (saved === undefined) delete process.env['METRICS_TOKEN'];
    else process.env['METRICS_TOKEN'] = saved;
  }
}, 90_000);

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

describe('the token gate', () => {
  it('refuses a scrape with no token, or the wrong one', async () => {
    expect((await request(harness.server).get(METRICS)).status).toBe(401);
    expect(
      (await request(harness.server).get(METRICS).set('Authorization', 'Bearer not-the-token'))
        .status,
    ).toBe(401);
  });

  it('serves the Prometheus text format, not the JSON envelope', async () => {
    const response = await scrape();

    expect(response.status).toBe(200);
    // Express orders the parameters itself; both must be there.
    expect(response.headers['content-type']).toMatch(/^text\/plain;/);
    expect(response.headers['content-type']).toContain('version=0.0.4');
    expect(response.text).toContain('# TYPE medora_http_requests_total counter');
    expect(response.text).toContain('# TYPE medora_job_runs_total counter');
    expect(response.text.trimStart().startsWith('{')).toBe(false);
  });
});

describe('what is counted', () => {
  it('counts a request under its route and status class', async () => {
    const line =
      'medora_http_requests_total{method="GET",route="/api/v1/health",status_class="2xx"}';
    const before = series((await scrape()).text, line) ?? 0;

    await request(harness.server).get('/api/v1/health').expect(200);

    expect(series((await scrape()).text, line)).toBe(before + 1);
  });

  it('labels the route pattern, never the identifier in the path', async () => {
    const id = randomUUID();

    // Matched by the router, refused by the access guard: still counted.
    await request(harness.server).get(`/api/v1/patients/${id}`).expect(401);

    const text = (await scrape()).text;
    expect(text).toContain('route="/api/v1/patients/:patientId",status_class="4xx"');
    expect(text).not.toContain(id);
  });

  it('counts a request no route matched under one shared label', async () => {
    const path = `/api/v1/no-such-route-${randomUUID()}`;

    await request(harness.server).get(path).expect(404);

    const text = (await scrape()).text;
    expect(text).toContain('route="<unmatched>",status_class="4xx"');
    expect(text).not.toContain(path);
  });

  it('counts a body the parser refused (413), which no interceptor would see', async () => {
    const line = 'medora_http_requests_total{method="POST",route="<unmatched>",status_class="4xx"}';
    const before = series((await scrape()).text, line) ?? 0;

    await request(harness.server)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'x'.repeat(200_000) }))
      .expect(413);

    expect(series((await scrape()).text, line)).toBe(before + 1);
  });
});

describe('RM M31 exit gate — the cache hit rate is visible', () => {
  it('counts a hot endpoint’s miss and hit by cache name, and exposes no user', async () => {
    const email = testEmail('metrics-cache');
    await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
    await markVerified(harness.prisma, email);
    // Clinical standing (F-09): outside it, this route is refused.
    await makeClinicalDoctor(harness.prisma, email);
    const token = dataOf<{ accessToken: string }>(
      await request(harness.server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'Medora123!', rememberMe: false }),
    ).accessToken;
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

    const hit = 'medora_cache_requests_total{cache="badge-counts",result="hit"}';
    const miss = 'medora_cache_requests_total{cache="badge-counts",result="miss"}';
    const before = (await scrape()).text;

    const badges = () =>
      request(harness.server)
        .get('/api/v1/notifications/badge-counts')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    await badges(); // first poll for a new account: a miss
    await badges(); // the next one: served from Redis

    const after = (await scrape()).text;
    expect(after).toContain('# TYPE medora_cache_requests_total counter');
    expect(series(after, miss)).toBe((series(before, miss) ?? 0) + 1);
    expect(series(after, hit)).toBe((series(before, hit) ?? 0) + 1);
    expect(after).not.toContain(user.id);
    expect(after).not.toContain(user.publicId);
  });
});
