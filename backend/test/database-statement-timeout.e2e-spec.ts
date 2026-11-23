/**
 * Condition C1 (database side) — how PostgreSQL 16 bounds a query, proven.
 *
 * The recommendation for the patient-scope shadow queries
 * (backend/docs/DATABASE_ARCHITECTURE.md, "Shadow query resource safety") is a
 * TRANSACTION-LOCAL statement_timeout, not a role- or database-wide one. These
 * tests show the three properties that recommendation depends on:
 *
 * 1. a transaction-local timeout cancels a slow statement (SQLSTATE 57014);
 * 2. it also cancels a statement that is waiting on a lock — the shadow's
 *    realistic hang (DDL holding a table lock);
 * 3. it ends with the transaction, so a pooled connection handed to the next
 *    request carries no timeout — while a session-level SET would leak.
 *
 * Nothing here changes server, role or database configuration.
 */

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
let databaseUrl: URL;
try {
  databaseUrl = new URL(rawDatabaseUrl);
} catch {
  throw new Error('Statement-timeout tests require the disposable medora_test DATABASE_URL.');
}
if (databaseUrl.pathname !== '/medora_test' || process.env['APP_ENV'] !== 'test') {
  throw new Error('Refusing statement-timeout tests outside the disposable medora_test database.');
}

const pooled = new Client({ connectionString: rawDatabaseUrl });
const locker = new Client({ connectionString: rawDatabaseUrl });

beforeAll(async () => {
  await Promise.all([pooled.connect(), locker.connect()]);
}, 15_000);

afterAll(async () => {
  await Promise.all([pooled.end(), locker.end()]);
});

async function setting(client: Client): Promise<string> {
  const result = await client.query<{ statement_timeout: string }>('SHOW statement_timeout');
  return result.rows[0]!.statement_timeout;
}

describe('transaction-local statement_timeout (C1, database side)', () => {
  it('starts with no statement timeout on the application connection (nothing configured today)', async () => {
    expect(await setting(pooled)).toBe('0');
  });

  it('cancels a slow statement with 57014 and lets a fast one through', async () => {
    await pooled.query('BEGIN');
    try {
      await pooled.query("SELECT set_config('statement_timeout', '150ms', true)");
      await expect(pooled.query('SELECT 1 AS ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
      const started = Date.now();
      await expect(pooled.query('SELECT pg_sleep(5)')).rejects.toMatchObject({ code: '57014' });
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      await pooled.query('ROLLBACK');
    }
  });

  it('cancels a statement waiting on a lock held by another session', async () => {
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE public.hospitals IN ACCESS EXCLUSIVE MODE');
    try {
      await pooled.query('BEGIN');
      try {
        await pooled.query('SET LOCAL statement_timeout = 200');
        await expect(pooled.query('SELECT id FROM public.hospitals LIMIT 1')).rejects.toMatchObject(
          {
            code: '57014',
          },
        );
      } finally {
        await pooled.query('ROLLBACK');
      }
    } finally {
      await locker.query('ROLLBACK');
    }
  });

  it('does not leak to the next transaction on the same connection; a session-level SET would', async () => {
    await pooled.query('BEGIN');
    await pooled.query('SET LOCAL statement_timeout = 150');
    expect(await setting(pooled)).toBe('150ms');
    await pooled.query('COMMIT');
    expect(await setting(pooled)).toBe('0');

    // The hazard: a session-level setting survives into the next request.
    await pooled.query('SET statement_timeout = 150');
    try {
      await pooled.query('BEGIN');
      expect(await setting(pooled)).toBe('150ms');
      await pooled.query('COMMIT');
    } finally {
      await pooled.query('RESET statement_timeout');
    }
    expect(await setting(pooled)).toBe('0');
  });
});
