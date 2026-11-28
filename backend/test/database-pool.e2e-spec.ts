import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { resetEnvForTesting } from '../src/config/env';
import { DatabaseModule, PrismaService } from '../src/shared/database';

/**
 * OPS-03 — the pool and session bounds reach the real server. Boots the
 * database module with a small pool and short timeouts and proves them
 * against PostgreSQL, including that a transaction-local timeout still wins.
 */
const OVERRIDES = {
  DATABASE_POOL_MAX: '3',
  DATABASE_STATEMENT_TIMEOUT_MS: '300',
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS: '1500',
  DATABASE_CONNECTION_TIMEOUT_MS: '500',
};

describe('database pool and session bounds (OPS-03)', () => {
  let prisma: PrismaService;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [k, v] of Object.entries(OVERRIDES)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    resetEnvForTesting();
    const moduleRef = await Test.createTestingModule({ imports: [ConfigModule, DatabaseModule] }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnvForTesting();
  });

  it('applies the session statement_timeout and idle_in_transaction_session_timeout', async () => {
    const rows = await prisma.$queryRawUnsafe<{ st: string; it: string }[]>(
      `SELECT current_setting('statement_timeout') AS st,
              current_setting('idle_in_transaction_session_timeout') AS it`,
    );
    expect(rows[0]).toEqual({ st: '300ms', it: '1500ms' });
  });

  it('cancels a statement beyond the session timeout with 57014', async () => {
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM pg_sleep(3)')).rejects.toSatisfy((e: unknown) => JSON.stringify(e).includes('57014') || String(e).includes('57014'));
  });

  it('lets a transaction-local statement_timeout override the session default', async () => {
    const rows = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('statement_timeout', '5s', true)`;
      await tx.$queryRawUnsafe('SELECT 1 FROM pg_sleep(0.6)');
      return tx.$queryRawUnsafe<{ st: string }[]>(`SELECT current_setting('statement_timeout') AS st`);
    });
    expect(rows[0]?.st).toBe('5s');
    const after = await prisma.$queryRawUnsafe<{ st: string }[]>(`SELECT current_setting('statement_timeout') AS st`);
    expect(after[0]?.st).toBe('300ms');
  });

  it('never uses more server connections than DATABASE_POOL_MAX', async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        prisma.$queryRawUnsafe<{ pid: number }[]>('SELECT pg_backend_pid() AS pid FROM pg_sleep(0.05)'),
      ),
    );
    const pids = new Set(results.map((r) => r[0]?.pid));
    expect(results).toHaveLength(12);
    expect(pids.size).toBeLessThanOrEqual(3);
  });
});
