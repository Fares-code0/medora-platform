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

  it('lock_timeout set locally cancels only the lock wait (55P03) and does not leak', async () => {
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE public.hospitals IN ACCESS EXCLUSIVE MODE');
    try {
      await pooled.query('BEGIN');
      try {
        await pooled.query("SELECT set_config('lock_timeout', '150ms', true)");
        await expect(pooled.query('SELECT id FROM public.hospitals LIMIT 1')).rejects.toMatchObject(
          {
            code: '55P03',
          },
        );
      } finally {
        await pooled.query('ROLLBACK');
      }
    } finally {
      await locker.query('ROLLBACK');
    }
    const after = await pooled.query<{ lock_timeout: string }>('SHOW lock_timeout');
    expect(after.rows[0]!.lock_timeout).toBe('0');
  });

  it('idle_in_transaction_session_timeout ends a session left idle inside a transaction (25P03)', async () => {
    const idle = new Client({ connectionString: rawDatabaseUrl });
    idle.on('error', () => undefined); // the server closes this connection on purpose
    await idle.connect();
    try {
      await idle.query('BEGIN');
      await idle.query("SELECT set_config('idle_in_transaction_session_timeout', '150ms', true)");
      await new Promise((done) => setTimeout(done, 600));
      await expect(idle.query('SELECT 1')).rejects.toBeDefined();
      const terminated = await pooled.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1',
        [(idle as unknown as { processID: number }).processID],
      );
      expect(terminated.rows[0]!.n).toBe(0);
    } finally {
      await idle.end().catch(() => undefined);
    }
  });

  it('a global statement_timeout would also cut legitimate long work (why it is not recommended)', async () => {
    await pooled.query('BEGIN');
    try {
      await pooled.query("SELECT set_config('statement_timeout', '100ms', true)");
      // Stands in for a long migration step, export or report: any statement
      // longer than the global limit fails the same way.
      await expect(pooled.query('SELECT pg_sleep(0.5)')).rejects.toMatchObject({ code: '57014' });
    } finally {
      await pooled.query('ROLLBACK');
    }
  });
});
