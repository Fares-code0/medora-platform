import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DashboardService } from '../src/modules/dashboard/services/dashboard.service';
import { CacheService, DOCTOR_DASHBOARD } from '../src/shared/cache';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * Stampede protection on the doctor Overview (RM M31.1 → M27.1).
 *
 * `GET /dashboard/doctor` is coalesced, never stored. The real composite
 * is slowed by a spy so that a burst of polls deterministically overlaps
 * it — then the assertions are about *how many times the real composite
 * ran, and for whom*:
 *
 *  - a burst from one doctor runs it once, and every poll gets that answer;
 *  - two doctors polling at once never share a computation;
 *  - a poll after the burst has settled runs it again (nothing is kept).
 */
let harness: AuthHarness;
let dashboard: DashboardService;

const PATH = '/api/v1/dashboard/doctor';
const PASSWORD = 'Medora123!';

async function signIn(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
  return { token, userId: user.id };
}

function poll(token: string) {
  return request(harness.server).get(PATH).set('Authorization', `Bearer ${token}`).expect(200);
}

/** Slows the real composite so concurrent polls overlap it for certain. */
function slowComposite() {
  const original = dashboard.composite.bind(dashboard);
  return vi.spyOn(dashboard, 'composite').mockImplementation(async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return original(...args);
  });
}

let doctorA: { token: string; userId: string };
let doctorB: { token: string; userId: string };

beforeAll(async () => {
  harness = await createAuthHarness('dashboard-coalescing-m311');
  dashboard = harness.app.get(DashboardService);
  doctorA = await signIn('dash-a');
  doctorB = await signIn('dash-b');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe('GET /dashboard/doctor under a polling burst', () => {
  it('runs the composite once for a burst from one doctor, and serves everyone its answer', async () => {
    const spy = slowComposite();
    const coalescedBefore = coalescedCount();
    try {
      const responses = await Promise.all(Array.from({ length: 8 }, () => poll(doctorA.token)));

      expect(spy).toHaveBeenCalledTimes(1);
      const bodies = new Set(responses.map((response) => JSON.stringify(response.body)));
      expect(bodies.size).toBe(1);
      expect(coalescedCount() - coalescedBefore).toBe(7);
    } finally {
      spy.mockRestore();
    }
  });

  it('never shares a computation between two doctors', async () => {
    const spy = slowComposite();
    try {
      await Promise.all([
        poll(doctorA.token),
        poll(doctorB.token),
        poll(doctorA.token),
        poll(doctorB.token),
      ]);

      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy.mock.calls.map(([user]) => user.id).sort()).toEqual(
        [doctorA.userId, doctorB.userId].sort(),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps nothing: a poll after the burst settles computes afresh', async () => {
    const spy = vi.spyOn(dashboard, 'composite');
    try {
      await poll(doctorA.token);
      await poll(doctorA.token);

      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

function coalescedCount(): number {
  return (
    harness.app
      .get(CacheService)
      .metrics()
      .find((row) => row.cache === DOCTOR_DASHBOARD && row.result === 'coalesced')?.count ?? 0
  );
}
