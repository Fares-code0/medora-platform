/**
 * At least one effective Platform Admin, enforced by the database under
 * concurrency (audit F-10; migration 20261125092000_platform_admin_invariant).
 *
 * Runs on an isolated database so the number of Platform Admins is exactly
 * what each test sets up: the shared `medora_test` holds other suites'
 * administrators, which would make "the last one" meaningless.
 *
 * Two connections race real transactions. The invariant is judged at COMMIT
 * under one advisory lock, so of two commits that would each remove one of
 * the last two Platform Admins, exactly one succeeds.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createIsolatedDatabase, type IsolatedDatabase } from './support/isolated-database';

let isolated: IsolatedDatabase | undefined;
let one: Client;
let two: Client;
let adminRole = '';
let doctorRole = '';

const rawDatabaseUrl = (process.env['DATABASE_URL'] ?? '').replace(/\?.*$/, '');

async function admin(client: Client, granted = true): Promise<string> {
  const id = randomUUID();
  const tag = id.slice(0, 8);
  await client.query(
    `INSERT INTO users (id, public_id, first_name, last_name, display_name, email, phone, role_id,
                        terms_accepted_at, privacy_accepted_at, updated_at)
     VALUES ($1, $2, 'Plat', 'Admin', 'Plat Admin', $3, '+1 555 000 0000', $4, now(), now(), now())`,
    [id, `usr_pai_${tag}`, `pai-${tag}@invariant.test`, adminRole],
  );
  if (granted) {
    await client.query("INSERT INTO platform_admin_grants (user_id, reason) VALUES ($1, 'invariant test')", [id]);
  }
  return id;
}

const count = async (): Promise<number> =>
  (await one.query<{ n: number }>('SELECT public.platform_admin_count() AS n')).rows[0]?.n ?? -1;

/** Runs `sql` on `client` in its own transaction; resolves to 'ok' or the SQLSTATE. */
async function commit(client: Client, sql: string, values: unknown[]): Promise<string> {
  try {
    await client.query('BEGIN');
    await client.query(sql, values);
    await client.query('COMMIT');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    return (error as { code?: string }).code ?? 'error';
  }
}

const REVOKE = 'UPDATE platform_admin_grants SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL';
const DEMOTE = 'UPDATE users SET role_id = $2 WHERE id = $1';
const DEACTIVATE = "UPDATE users SET status = 'inactive' WHERE id = $1";
const SOFT_DELETE = 'UPDATE users SET deleted_at = now() WHERE id = $1';

beforeAll(async () => {
  isolated = await createIsolatedDatabase(rawDatabaseUrl, 'padmin');
  one = new Client({ connectionString: isolated.url });
  two = new Client({ connectionString: isolated.url });
  await one.connect();
  await two.connect();
  const roles = await one.query<{ id: string; code: string }>("SELECT id, code FROM roles WHERE code IN ('admin', 'doctor')");
  adminRole = roles.rows.find((row) => row.code === 'admin')?.id ?? '';
  doctorRole = roles.rows.find((row) => row.code === 'doctor')?.id ?? '';
}, 180_000);

afterAll(async () => {
  await one?.end();
  await two?.end();
  await isolated?.drop();
});

beforeEach(async () => {
  // Each test starts from no effective Platform Admin. Grants are revoked,
  // never deleted (an existing trigger refuses DELETE), and revoking the
  // last one is exactly what the guard refuses — so this isolated database's
  // owner sets the guards aside for the reset only.
  await one.query('BEGIN');
  await one.query('ALTER TABLE platform_admin_grants DISABLE TRIGGER platform_admin_grant_revocation_guard');
  await one.query('ALTER TABLE users DISABLE TRIGGER platform_admin_user_change_guard');
  await one.query('UPDATE platform_admin_grants SET revoked_at = now() WHERE revoked_at IS NULL');
  await one.query("UPDATE users SET deleted_at = now() WHERE deleted_at IS NULL AND role_id = $1", [adminRole]);
  await one.query('ALTER TABLE platform_admin_grants ENABLE TRIGGER platform_admin_grant_revocation_guard');
  await one.query('ALTER TABLE users ENABLE TRIGGER platform_admin_user_change_guard');
  await one.query('COMMIT');
  expect(await count()).toBe(0);
});

describe('the last effective Platform Admin cannot be removed', () => {
  it.each([
    ['revoking the grant', REVOKE, false],
    ['demoting the account', DEMOTE, true],
    ['deactivating the account', DEACTIVATE, false],
    ['soft-deleting the account', SOFT_DELETE, false],
  ])('refuses %s', async (_label, sql, withRole) => {
    const last = await admin(one);
    const values = withRole ? [last, doctorRole] : [last];
    expect(await commit(one, sql, values)).toBe('23514');
    expect(await count()).toBe(1);
  });

  it('allows any of them while another Platform Admin remains', async () => {
    const [a, b, c, d] = [await admin(one), await admin(one), await admin(one), await admin(one)];
    await admin(one);
    expect(await commit(one, REVOKE, [a])).toBe('ok');
    expect(await commit(one, DEMOTE, [b, doctorRole])).toBe('ok');
    expect(await commit(one, DEACTIVATE, [c])).toBe('ok');
    expect(await commit(one, SOFT_DELETE, [d])).toBe('ok');
    expect(await count()).toBe(1);
  });

  it('judges the whole transaction at COMMIT: a hand-over (grant, then revoke) is allowed', async () => {
    const outgoing = await admin(one);
    const incoming = await admin(one, false);
    await one.query('BEGIN');
    await one.query(REVOKE, [outgoing]);
    await one.query("INSERT INTO platform_admin_grants (user_id, reason) VALUES ($1, 'hand-over to the incoming administrator')", [incoming]);
    await one.query('COMMIT');
    expect(await count()).toBe(1);
  });

  it('does not count a grant held by a non-admin account: demotion cannot be bypassed by a grant', async () => {
    const real = await admin(one);
    const demoted = await admin(one);
    expect(await commit(one, DEMOTE, [demoted, doctorRole])).toBe('ok');
    // The demoted account's grant row may survive at the SQL level, but it
    // is not standing: removing the real one is still the last one.
    expect(await count()).toBe(1);
    expect(await commit(one, REVOKE, [real])).toBe('23514');
  });

  it('leaves an empty platform (before bootstrap) alone', async () => {
    const ungranted = await admin(one, false);
    expect(await commit(one, DEACTIVATE, [ungranted])).toBe('ok');
    expect(await count()).toBe(0);
  });
});

describe('concurrent removals of the last two', () => {
  async function race(first: [string, unknown[]], second: [string, unknown[]]): Promise<string[]> {
    // Both transactions make their change before either commits, so each
    // alone would have seen "one remains".
    await one.query('BEGIN');
    await two.query('BEGIN');
    await one.query(first[0], first[1]);
    await two.query(second[0], second[1]);
    const settle = async (client: Client): Promise<string> => {
      try {
        await client.query('COMMIT');
        return 'ok';
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        return (error as { code?: string }).code ?? 'error';
      }
    };
    return (await Promise.all([settle(one), settle(two)])).sort();
  }

  it('lets exactly one of two concurrent grant revocations commit', async () => {
    const [a, b] = [await admin(one), await admin(one)];
    expect(await race([REVOKE, [a]], [REVOKE, [b]])).toEqual(['23514', 'ok']);
    expect(await count()).toBe(1);
  });

  it('lets exactly one of a concurrent revocation and demotion commit', async () => {
    const [a, b] = [await admin(one), await admin(one)];
    expect(await race([REVOKE, [a]], [DEMOTE, [b, doctorRole]])).toEqual(['23514', 'ok']);
    expect(await count()).toBe(1);
  });

  it('lets exactly one of a concurrent deactivation and soft delete commit', async () => {
    const [a, b] = [await admin(one), await admin(one)];
    expect(await race([DEACTIVATE, [a]], [SOFT_DELETE, [b]])).toEqual(['23514', 'ok']);
    expect(await count()).toBe(1);
  });
});
