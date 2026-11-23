/**
 * Tenant context propagation to PostgreSQL (S7, #20) through the real
 * `PrismaService` pool (`@prisma/adapter-pg`): what the Backend writes with
 * `withHospitalTenantContext` is visible to every statement of its own
 * transaction, to nothing outside it, and never to the next user of a pooled
 * connection — including after a rollback and under concurrent requests.
 *
 * Read-only against `medora_test`: no table is written and no policy exists.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigService } from '../src/config/config.service';
import { loadEnv } from '../src/config/env';
import { PrismaService, withHospitalTenantContext } from '../src/shared/database';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
if (new URL(rawDatabaseUrl).pathname !== '/medora_test' || process.env['APP_ENV'] !== 'test') {
  throw new Error('Refusing tenant-context tests outside the disposable medora_test database.');
}

let prisma: PrismaService;

/** `current_setting(…, true)`: NULL if never defined on the session, '' once reset. */
async function seen(client: {
  $queryRaw: PrismaService['$queryRaw'];
}): Promise<{ value: string | null; pid: number }> {
  const rows = await client.$queryRaw<{ value: string | null; pid: number }[]>`
    SELECT current_setting('app.hospital_id', true) AS value, pg_backend_pid() AS pid`;
  return rows[0]!;
}

/** Outside any tenant transaction, on every pooled connection, nothing is set. */
async function expectNoContextOnPool(): Promise<void> {
  // More concurrent reads than the pool has connections (pg default: 10), so
  // every pooled connection is exercised.
  const reads = await Promise.all(Array.from({ length: 24 }, () => seen(prisma)));
  for (const read of reads) expect(read.value ?? '').toBe('');
}

beforeAll(async () => {
  prisma = new PrismaService(new ConfigService(loadEnv()));
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('withHospitalTenantContext on PostgreSQL 16', () => {
  it('every statement of the transaction sees the hospital', async () => {
    const hospital = randomUUID();
    const [first, second] = await withHospitalTenantContext(prisma, hospital, async (tx) => [
      await seen(tx),
      await seen(tx),
    ]);
    expect(first.value).toBe(hospital);
    expect(second.value).toBe(hospital);
    expect(second.pid).toBe(first.pid);
  });

  it('an unresolved context is the empty value inside the transaction', async () => {
    const inside = await withHospitalTenantContext(prisma, null, (tx) => seen(tx));
    expect(inside.value).toBe('');
  });

  it('nothing survives COMMIT on the pooled connections', async () => {
    for (let i = 0; i < 12; i += 1) {
      await withHospitalTenantContext(prisma, randomUUID(), (tx) => seen(tx));
    }
    await expectNoContextOnPool();
  });

  it('nothing survives ROLLBACK either', async () => {
    const failure = new Error('rolled back on purpose');
    for (let i = 0; i < 12; i += 1) {
      await expect(
        withHospitalTenantContext(prisma, randomUUID(), async (tx) => {
          await seen(tx);
          throw failure;
        }),
      ).rejects.toBe(failure);
    }
    await expectNoContextOnPool();
  });

  it('concurrent requests each see only their own hospital', async () => {
    const hospitals = Array.from({ length: 8 }, () => randomUUID());
    let arrived = 0;
    let release!: () => void;
    const allInside = new Promise<void>((done) => (release = done));
    const results = await Promise.all(
      hospitals.map((hospital) =>
        withHospitalTenantContext(prisma, hospital, async (tx) => {
          const before = await seen(tx);
          // Hold every transaction open until all have set their context, so
          // they genuinely overlap on different pooled connections.
          arrived += 1;
          if (arrived === hospitals.length) release();
          await allInside;
          const after = await seen(tx);
          return { hospital, before, after };
        }),
      ),
    );
    for (const { hospital, before, after } of results) {
      expect(before.value).toBe(hospital);
      expect(after.value).toBe(hospital);
    }
    expect(new Set(results.map((r) => r.before.pid)).size).toBe(hospitals.length);
    await expectNoContextOnPool();
  });
});
