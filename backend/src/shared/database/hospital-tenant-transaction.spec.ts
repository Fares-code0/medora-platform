import { describe, expect, it, vi } from 'vitest';

import type { Prisma } from '../../generated/prisma/client';

import {
  type InteractiveTransactionRunner,
  TENANT_HOSPITAL_SETTING,
  withHospitalTenantContext,
} from './hospital-tenant-transaction';

const HOSPITAL = '3f6c1e2a-9b7d-4c1e-8f2a-0123456789ab';

function fakePrisma(): {
  prisma: InteractiveTransactionRunner;
  calls: { sql: string; values: unknown[] }[];
  options: unknown[];
} {
  const calls: { sql: string; values: unknown[] }[] = [];
  const options: unknown[] = [];
  const tx = {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('?'), values });
      return Promise.resolve([]);
    }),
  } as unknown as Prisma.TransactionClient;
  const prisma: InteractiveTransactionRunner = {
    $transaction: <T>(
      work: (client: Prisma.TransactionClient) => Promise<T>,
      opts?: unknown,
    ): Promise<T> => {
      options.push(opts);
      return work(tx);
    },
  };
  return { prisma, calls, options };
}

describe('withHospitalTenantContext', () => {
  it('names the setting the Database contract defines', () => {
    expect(TENANT_HOSPITAL_SETTING).toBe('app.hospital_id');
  });

  it('sets the hospital transaction-locally before the work runs', async () => {
    const { prisma, calls } = fakePrisma();
    const order: string[] = [];
    await withHospitalTenantContext(prisma, HOSPITAL, () => {
      order.push(`work after ${String(calls.length)} statement(s)`);
      return Promise.resolve();
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("set_config('app.hospital_id', ?, true)");
    expect(calls[0]?.values).toEqual([HOSPITAL]);
    expect(order).toEqual(['work after 1 statement(s)']);
  });

  it('writes an empty value for an unresolved context (matches no row), never a wildcard', async () => {
    const { prisma, calls } = fakePrisma();
    await withHospitalTenantContext(prisma, null, () => Promise.resolve());
    expect(calls[0]?.values).toEqual(['']);
  });

  it('refuses a value that is not a UUID before any statement runs', async () => {
    const { prisma, calls } = fakePrisma();
    const work = vi.fn(() => Promise.resolve());
    for (const bad of ['', 'all', `${HOSPITAL}'; RESET ALL; --`, 'not-a-uuid']) {
      await expect(withHospitalTenantContext(prisma, bad, work)).rejects.toThrow(/UUID/);
    }
    expect(calls).toHaveLength(0);
    expect(work).not.toHaveBeenCalled();
  });

  it('returns the work result and forwards transaction options', async () => {
    const { prisma, options } = fakePrisma();
    const result = await withHospitalTenantContext(prisma, HOSPITAL, () => Promise.resolve(42), {
      timeout: 500,
    });
    expect(result).toBe(42);
    expect(options).toEqual([{ timeout: 500 }]);
  });
});
