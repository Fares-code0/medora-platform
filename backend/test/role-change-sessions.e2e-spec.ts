/**
 * Database contract (approved G4 decision, 2026-11-23): changing an account's
 * role revokes every live session of that account, from any write path, in the
 * same transaction. Migration `20261123150000_role_change_revokes_sessions`.
 *
 * Each case runs in a transaction that is rolled back: nothing persists.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
if (new URL(rawDatabaseUrl).pathname !== '/medora_test' || process.env['APP_ENV'] !== 'test') {
  throw new Error(
    'Refusing role-change session tests outside the disposable medora_test database.',
  );
}

const client = new Client({ connectionString: rawDatabaseUrl });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

async function roleId(code: string): Promise<string> {
  const row = await client.query<{ id: string }>('SELECT id FROM public.roles WHERE code = $1', [
    code,
  ]);
  return row.rows[0]!.id;
}

async function newUser(role: string): Promise<string> {
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  const row = await client.query<{ id: string }>(
    `INSERT INTO public.users (public_id, first_name, last_name, display_name, email, phone,
                               role_id, terms_accepted_at, privacy_accepted_at, updated_at)
     VALUES ($1, 'Role', 'Change', 'Role Change', $2, '+1 555 000 0000', $3, now(), now(), now())
     RETURNING id`,
    [`usr_rc_${tag}`, `rc-${tag}@role-change.test`, await roleId(role)],
  );
  return row.rows[0]!.id;
}

async function newSession(userId: string): Promise<string> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO public.sessions (user_id, refresh_token_hash, expires_at)
     VALUES ($1, $2, now() + interval '1 day') RETURNING id`,
    [userId, randomUUID()],
  );
  return row.rows[0]!.id;
}

async function live(userId: string): Promise<number> {
  const row = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM public.sessions WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return row.rows[0]!.n;
}

async function rolledBack(work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('users.role_id change revokes sessions (database trigger)', () => {
  it('revokes every live session of the account whose role changes, and only that account', async () => {
    await rolledBack(async () => {
      const subject = await newUser('doctor');
      const bystander = await newUser('doctor');
      await newSession(subject);
      await newSession(subject);
      await newSession(bystander);

      await client.query('UPDATE public.users SET role_id = $1 WHERE id = $2', [
        await roleId('laboratory'),
        subject,
      ]);

      expect(await live(subject)).toBe(0);
      expect(await live(bystander)).toBe(1);
      const cleared = await client.query<{ rotated: boolean; successor: boolean }>(
        `SELECT bool_or(rotated_at IS NOT NULL) AS rotated, bool_or(successor_token_ct IS NOT NULL) AS successor
           FROM public.sessions WHERE user_id = $1`,
        [subject],
      );
      expect(cleared.rows[0]).toEqual({ rotated: false, successor: false });
    });
  });

  it('does not revoke when the role is written unchanged or another column changes', async () => {
    await rolledBack(async () => {
      const subject = await newUser('doctor');
      await newSession(subject);
      await client.query('UPDATE public.users SET role_id = role_id WHERE id = $1', [subject]);
      await client.query("UPDATE public.users SET display_name = 'Renamed' WHERE id = $1", [
        subject,
      ]);
      expect(await live(subject)).toBe(1);
    });
  });

  it('leaves already revoked sessions as they were', async () => {
    await rolledBack(async () => {
      const subject = await newUser('doctor');
      const old = await newSession(subject);
      await client.query(
        "UPDATE public.sessions SET revoked_at = timestamptz '2026-01-01' WHERE id = $1",
        [old],
      );
      await client.query('UPDATE public.users SET role_id = $1 WHERE id = $2', [
        await roleId('laboratory'),
        subject,
      ]);
      const row = await client.query<{ revoked: string }>(
        'SELECT revoked_at::text AS revoked FROM public.sessions WHERE id = $1',
        [old],
      );
      expect(row.rows[0]!.revoked.startsWith('2026-01-01')).toBe(true);
    });
  });

  it('revokes nothing when the role change itself is rolled back', async () => {
    let subject = '';
    await client.query('BEGIN');
    try {
      subject = await newUser('doctor');
      await newSession(subject);
      await client.query('SAVEPOINT change');
      await client.query('UPDATE public.users SET role_id = $1 WHERE id = $2', [
        await roleId('laboratory'),
        subject,
      ]);
      expect(await live(subject)).toBe(0);
      await client.query('ROLLBACK TO SAVEPOINT change');
      expect(await live(subject)).toBe(1);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
