import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CACHE_BACKEND, type CacheBackend, CacheService } from '../src/shared/cache';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * The platform with its cache down (RM M31.1: "a cache that fails is a
 * cache that misses").
 *
 * The application boots with a cache backend that rejects every command —
 * the shape a Redis outage takes once ioredis has given up on the
 * connection. Every cached read must still answer from the database,
 * every write that invalidates must still succeed, and the outage must be
 * counted rather than thrown.
 */
const DOWN: CacheBackend = {
  mget: () => Promise.reject(new Error('cache unavailable')),
  write: () => Promise.reject(new Error('cache unavailable')),
  bump: () => Promise.reject(new Error('cache unavailable')),
};

let harness: AuthHarness;
let token = '';
let userId = '';

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  harness = await createAuthHarness('cache-unavailable-m311', {
    overrides: [{ token: CACHE_BACKEND, value: DOWN }],
  });

  const email = testEmail('cache-down');
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'Medora123!', rememberMe: false }),
  ).accessToken;
  userId = (await harness.prisma.user.findUniqueOrThrow({ where: { email } })).id;
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe('with the cache unavailable', () => {
  it('serves the badge from the database, and stays correct across a write', async () => {
    const notification = await harness.prisma.db.notification.create({
      data: {
        recipientId: userId,
        title: 'Cache down',
        body: 'Open Medora for details.',
        category: 'SYSTEM',
        priority: 'NORMAL',
        kind: 'UPDATE',
        sender: 'Medora',
      },
      select: { id: true },
    });

    const read = async () =>
      dataOf<{ notifications: number }>(
        await request(harness.server)
          .get('/api/v1/notifications/badge-counts')
          .set(auth())
          .expect(200),
      ).notifications;

    expect(await read()).toBe(1);
    // The write's invalidation fails; the write must not.
    await request(harness.server)
      .post(`/api/v1/notifications/${notification.id}/read`)
      .set(auth())
      .expect(204);
    expect(await read()).toBe(0);
  });

  it('serves reference data from the database', async () => {
    const response = await request(harness.server)
      .get('/api/v1/medications')
      .query({ q: 'Amoxil' })
      .set(auth())
      .expect(200);

    expect(
      dataOf<{ items: { name: string }[] }>(response).items.map((item) => item.name),
    ).toContain('Amoxil');
  });

  it('serves the doctor Overview', async () => {
    await request(harness.server).get('/api/v1/dashboard/doctor').set(auth()).expect(200);
  });

  it('counts the outage instead of throwing it', () => {
    const rows = harness.app.get(CacheService).metrics();
    const result = (cache: string, outcome: string) =>
      rows.find((row) => row.cache === cache && row.result === outcome)?.count ?? 0;

    expect(result('badge-counts', 'error')).toBeGreaterThanOrEqual(2);
    expect(result('badge-counts', 'invalidation_error')).toBeGreaterThanOrEqual(1);
    expect(result('reference-data', 'error')).toBeGreaterThanOrEqual(1);
  });
});
