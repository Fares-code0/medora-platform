import type { NestExpressApplication } from '@nestjs/platform-express';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { applyTrustProxy } from '../src/common/http/trust-proxy';
import { RATE_LIMIT_KEY_PREFIX, RATE_LIMITER, RedisRateLimiter } from '../src/shared/rate-limit';
import { type AuthHarness, createAuthHarness, errorBody } from './support/auth-app';

/**
 * The per-client limit on the public credential routes, over HTTP (M37.2).
 *
 * The limit ships **off** (`RATE_LIMIT_ENABLED=false`) until a deployment
 * has verified its proxy, so this file switches it on for its own
 * application, with a limit of three. Every other suite runs with it off,
 * which is why their logins from 127.0.0.1 never touch these counters.
 *
 * What the production network does is not tested here and cannot be: a
 * real load balancer's `X-Forwarded-For` behaviour is the deployment's
 * (`docs/RATE_LIMITING.md`). What is tested is the API's half — that a
 * forwarded header is ignored unless its hop is trusted, and honoured
 * exactly as far as the trust goes when it is.
 *
 * ## Two things this file must do to be deterministic
 *
 * · **Wait for the counter's connection before the first request.** The
 *   limiter has no offline queue, by design: a hit while Redis is not
 *   connected resolves `null` and the guard lets the request through
 *   uncounted (fail-open, `rate-limit.guard.ts`). That is right for
 *   production and wrong for a test that counts to three — a first
 *   attempt that raced the connection would leave the fourth one
 *   allowed. `beforeAll` therefore awaits the application's own
 *   limiter's `ready()`.
 * · **Delete only its own counters.** Redis is shared by every spec file
 *   in the run, and `redis-rate-limiter.spec.ts` counts under the same
 *   prefix (`spec:<uuid>`) at the same time. Clearing the whole prefix
 *   could reset one of its counters between two hits. This file's
 *   counters are all in the `auth` bucket, so that is all it clears.
 */

const LOGIN = '/api/v1/auth/login';
const OTP_VERIFY = '/api/v1/auth/otp/verify';
const REFRESH = '/api/v1/auth/refresh';
const HEALTH = '/api/v1/health';
const LIMIT = 3;
/** Every counter this file's requests create: the `auth` bucket (`@RateLimited('auth')`). */
const OWN_COUNTERS = `${RATE_LIMIT_KEY_PREFIX}auth:*`;
/** How long the counter may take to connect before the file gives up (ms). */
const READY_TIMEOUT_MS = 10_000;

let harness: AuthHarness;
let redis: Redis;

const attempt = (headers: Record<string, string> = {}) =>
  request(harness.server)
    .post(LOGIN)
    .set(headers)
    .send({ email: 'nobody@rate-limit.test', password: 'Wrong-password-1', rememberMe: false });

async function clearCounters(): Promise<void> {
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', OWN_COUNTERS, 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');
}

beforeAll(async () => {
  redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');

  // `loadEnv()` is memoised when the application boots, so these apply to
  // this file's application only; restored at once so the next spec file
  // in this worker does not inherit them.
  const saved = {
    enabled: process.env['RATE_LIMIT_ENABLED'],
    max: process.env['RATE_LIMIT_AUTH_MAX'],
  };
  process.env['RATE_LIMIT_ENABLED'] = 'true';
  process.env['RATE_LIMIT_AUTH_MAX'] = String(LIMIT);
  try {
    harness = await createAuthHarness('rate-limit-m372');
  } finally {
    restore('RATE_LIMIT_ENABLED', saved.enabled);
    restore('RATE_LIMIT_AUTH_MAX', saved.max);
  }

  // The limit must really be on, with a real counter behind it: the
  // disabled limiter would make every assertion below about `not 429`
  // pass vacuously.
  const limiter = harness.app.get<unknown>(RATE_LIMITER);
  if (!(limiter instanceof RedisRateLimiter)) {
    throw new Error('fixture: RATE_LIMIT_ENABLED did not take effect for this application');
  }
  await Promise.race([
    limiter.ready(),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        reject(
          new Error(
            `fixture: the rate-limit counter was not ready in ${String(READY_TIMEOUT_MS)} ms`,
          ),
        );
      }, READY_TIMEOUT_MS).unref(),
    ),
  ]);
}, 90_000);

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(async () => {
  await clearCounters();
  await redis.quit();
  await harness.close();
});

beforeEach(async () => {
  await clearCounters();
  applyTrustProxy(harness.app as NestExpressApplication, false);
});

describe('with TRUST_PROXY unset (the default)', () => {
  it('answers 429 with Retry-After once a client passes the limit', async () => {
    for (let index = 0; index < LIMIT; index++) {
      expect((await attempt()).status).not.toBe(429);
    }

    const refused = await attempt();

    expect(refused.status).toBe(429);
    expect(errorBody(refused).code).toBe('rate_limited');
    const retryAfter = Number(refused.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it('shares one allowance across the credential routes', async () => {
    for (let index = 0; index < LIMIT; index++) await attempt();

    const otp = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken: 'not-a-token', code: '000000' });

    expect(otp.status).toBe(429);
  });

  it('ignores X-Forwarded-For: a client cannot choose a fresh address', async () => {
    for (let index = 0; index < LIMIT; index++) await attempt();

    const spoofed = await attempt({ 'X-Forwarded-For': '198.51.100.23' });

    expect(spoofed.status).toBe(429);
  });

  it('does not limit routes outside the bucket', async () => {
    for (let index = 0; index < LIMIT + 1; index++) await attempt();

    expect((await request(harness.server).get(HEALTH)).status).toBe(200);
    // Refresh is token-bound and called routinely by the web client.
    expect((await request(harness.server).post(REFRESH).send({})).status).not.toBe(429);
  });
});

describe('with the proxy trusted', () => {
  beforeEach(() => {
    // What `TRUST_PROXY=loopback` does: the test client connects from
    // 127.0.0.1, which plays the deployment's load balancer.
    applyTrustProxy(harness.app as NestExpressApplication, ['loopback']);
  });

  it('counts each forwarded client separately', async () => {
    for (let index = 0; index < LIMIT; index++) {
      await attempt({ 'X-Forwarded-For': '198.51.100.1' });
    }

    expect((await attempt({ 'X-Forwarded-For': '198.51.100.1' })).status).toBe(429);
    expect((await attempt({ 'X-Forwarded-For': '198.51.100.2' })).status).not.toBe(429);
  });

  it('trusts the header only as far as the trusted hop — a forged left entry changes nothing', async () => {
    // The trusted proxy appends the address it saw; whatever the client
    // wrote before it is not believed.
    for (let index = 0; index < LIMIT; index++) {
      await attempt({ 'X-Forwarded-For': `10.9.9.${String(index)}, 198.51.100.3` });
    }

    expect((await attempt({ 'X-Forwarded-For': '10.9.9.99, 198.51.100.3' })).status).toBe(429);
  });
});
