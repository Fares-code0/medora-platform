/**
 * Database contract (S5; OD-07, M-13): the explicit Platform Admin designation,
 * migration `20261124100000_platform_admin_assignments`.
 *
 * - a live grant requires the `admin` role, a non-blank reason, and is unique
 *   per account;
 * - an account cannot hold a live Platform Admin grant and a live hospital
 *   `admin` assignment at the same time (both directions);
 * - a role change away from `admin` revokes the live grant;
 * - grants are history: not rewritten, not un-revoked, not deleted while the
 *   account exists; a hard delete of the account cascades.
 *
 * Plus the explicit reconciliation command
 * (`prisma/backfill/run-platform-admin-designation.ts`).
 *
 * Each table case runs in a transaction that is rolled back; the command
 * cases remove their accounts afterwards (the grants cascade).
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertApplyPermitted,
  runPlatformAdminDesignation,
} from '../prisma/backfill/platform-admin-designation';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
if (new URL(rawDatabaseUrl).pathname !== '/medora_test' || process.env['APP_ENV'] !== 'test') {
  throw new Error(
    'Refusing Platform Admin assignment tests outside the disposable medora_test database.',
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
     VALUES ($1, 'Platform', 'Admin', 'Platform Admin', $2, '+1 555 000 0000', $3, now(), now(), now())
     RETURNING id`,
    [`usr_pa_${tag}`, `pa-${tag}@platform-admin.test`, await roleId(role)],
  );
  return row.rows[0]!.id;
}

async function newHospital(): Promise<string> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO public.hospitals (public_id, name, updated_at)
     VALUES ($1, $2, now()) RETURNING id`,
    [`hsp_pa_${randomUUID().slice(0, 24)}`, `PA Hospital ${randomUUID().slice(0, 8)}`],
  );
  return row.rows[0]!.id;
}

async function grant(userId: string, reason = 'S5 test grant'): Promise<string> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO public.platform_admin_assignments (user_id, grant_reason)
     VALUES ($1, $2) RETURNING id`,
    [userId, reason],
  );
  return row.rows[0]!.id;
}

async function hospitalAdmin(userId: string, hospitalId: string): Promise<string> {
  const row = await client.query<{ id: string }>(
    `INSERT INTO public.hospital_role_assignments (user_id, hospital_id, role_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, hospitalId, await roleId('admin')],
  );
  return row.rows[0]!.id;
}

async function liveGrants(userId: string): Promise<number> {
  const row = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM public.platform_admin_assignments
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
  return row.rows[0]!.n;
}

/** Runs `work` inside a transaction that is always rolled back. */
async function rolledBack(work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Expects `work` to fail with the named constraint, inside a savepoint. */
async function refused(work: () => Promise<unknown>, constraint: string): Promise<void> {
  await client.query('SAVEPOINT refused');
  try {
    await expect(work()).rejects.toMatchObject({ constraint });
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT refused');
  }
}

describe('platform_admin_assignments (explicit Platform Admin designation)', () => {
  it('grants an admin account and keeps at most one live grant per account', async () => {
    await rolledBack(async () => {
      const admin = await newUser('admin');
      await grant(admin);
      expect(await liveGrants(admin)).toBe(1);
      await refused(() => grant(admin), 'platform_admin_assignments_one_live_per_user_key');
    });
  });

  it('refuses a grant for an account that does not hold the admin role', async () => {
    await rolledBack(async () => {
      for (const role of ['doctor', 'reception', 'patient']) {
        const user = await newUser(role);
        await refused(() => grant(user), 'platform_admin_assignments_admin_role_check');
      }
    });
  });

  it('refuses a blank reason and an incomplete revocation', async () => {
    await rolledBack(async () => {
      const admin = await newUser('admin');
      await refused(() => grant(admin, '   '), 'platform_admin_assignments_grant_reason_check');
      const id = await grant(admin);
      await refused(
        () =>
          client.query(
            'UPDATE public.platform_admin_assignments SET revoked_at = now() WHERE id = $1',
            [id],
          ),
        'platform_admin_assignments_revocation_check',
      );
    });
  });

  it('refuses a Platform Admin grant for a live Hospital Admin, and the reverse', async () => {
    await rolledBack(async () => {
      const hospital = await newHospital();

      const hospitalAdminUser = await newUser('admin');
      await hospitalAdmin(hospitalAdminUser, hospital);
      await refused(
        () => grant(hospitalAdminUser),
        'platform_admin_assignments_exclusive_scope_check',
      );

      const platformAdminUser = await newUser('admin');
      await grant(platformAdminUser);
      await refused(
        () => hospitalAdmin(platformAdminUser, hospital),
        'platform_admin_assignments_exclusive_scope_check',
      );
    });
  });

  it('allows the switch once the other designation is revoked', async () => {
    await rolledBack(async () => {
      const hospital = await newHospital();
      const user = await newUser('admin');
      const assignment = await hospitalAdmin(user, hospital);
      await client.query(
        'UPDATE public.hospital_role_assignments SET revoked_at = now() WHERE id = $1',
        [assignment],
      );
      await grant(user);
      expect(await liveGrants(user)).toBe(1);

      // Un-revoking the hospital assignment is refused while the grant is live.
      await refused(
        () =>
          client.query(
            'UPDATE public.hospital_role_assignments SET revoked_at = NULL WHERE id = $1',
            [assignment],
          ),
        'platform_admin_assignments_exclusive_scope_check',
      );
    });
  });

  it('revokes the live grant when the account leaves the admin role', async () => {
    await rolledBack(async () => {
      const admin = await newUser('admin');
      const id = await grant(admin);
      await client.query('UPDATE public.users SET role_id = $1 WHERE id = $2', [
        await roleId('doctor'),
        admin,
      ]);
      const row = await client.query<{ revoked_at: Date | null; revoke_reason: string | null }>(
        'SELECT revoked_at, revoke_reason FROM public.platform_admin_assignments WHERE id = $1',
        [id],
      );
      expect(row.rows[0]!.revoked_at).not.toBeNull();
      expect(row.rows[0]!.revoke_reason).toBe('role_changed');
      expect(await liveGrants(admin)).toBe(0);
    });
  });

  it('keeps grants as history: no rewrite, no un-revoke, no delete; a regrant is a new row', async () => {
    await rolledBack(async () => {
      const admin = await newUser('admin');
      const other = await newUser('admin');
      const id = await grant(admin);

      await refused(
        () =>
          client.query('UPDATE public.platform_admin_assignments SET user_id = $1 WHERE id = $2', [
            other,
            id,
          ]),
        'platform_admin_assignments_history_check',
      );
      await refused(
        () => client.query('DELETE FROM public.platform_admin_assignments WHERE id = $1', [id]),
        'platform_admin_assignments_history_check',
      );

      await client.query(
        `UPDATE public.platform_admin_assignments
            SET revoked_at = now(), revoked_by = $1, revoke_reason = 'mapping review'
          WHERE id = $2`,
        [other, id],
      );
      await refused(
        () =>
          client.query(
            `UPDATE public.platform_admin_assignments
                SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = $1`,
            [id],
          ),
        'platform_admin_assignments_history_check',
      );

      await grant(admin, 'regrant after review');
      const rows = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM public.platform_admin_assignments WHERE user_id = $1',
        [admin],
      );
      expect(rows.rows[0]!.n).toBe(2);
      expect(await liveGrants(admin)).toBe(1);

      // The revoker's own hard delete nulls revoked_by (FK SET NULL) without
      // tripping the history check.
      await client.query('DELETE FROM public.users WHERE id = $1', [other]);
      const revoked = await client.query<{ revoked_by: string | null }>(
        'SELECT revoked_by FROM public.platform_admin_assignments WHERE id = $1',
        [id],
      );
      expect(revoked.rows[0]!.revoked_by).toBeNull();
    });
  });

  it('cascades a hard delete of the account itself', async () => {
    await rolledBack(async () => {
      const admin = await newUser('admin');
      await grant(admin);
      await client.query('DELETE FROM public.users WHERE id = $1', [admin]);
      const rows = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM public.platform_admin_assignments WHERE user_id = $1',
        [admin],
      );
      expect(rows.rows[0]!.n).toBe(0);
    });
  });
});

describe('runPlatformAdminDesignation (explicit reconciliation, one named account)', () => {
  const created: string[] = [];
  const hospitals: string[] = [];

  afterAll(async () => {
    await client.query('DELETE FROM public.hospital_role_assignments WHERE user_id = ANY($1)', [
      created,
    ]);
    // The grant history cascades with the account's hard delete.
    await client.query('DELETE FROM public.users WHERE id = ANY($1)', [created]);
    await client.query('DELETE FROM public.hospitals WHERE id = ANY($1)', [hospitals]);
  });

  async function account(role: string): Promise<{ id: string; email: string }> {
    const id = await newUser(role);
    created.push(id);
    const row = await client.query<{ email: string }>(
      'SELECT email FROM public.users WHERE id = $1',
      [id],
    );
    return { id, email: row.rows[0]!.email };
  }

  const reason = 'M-13 mapping list entry (test)';

  it('dry run reports would_grant and writes nothing; apply grants once', async () => {
    const admin = await account('admin');

    const dry = await runPlatformAdminDesignation(
      client,
      { email: admin.email, reason },
      { apply: false, appEnv: 'test' },
    );
    expect(dry).toMatchObject({ mode: 'dry-run', verdict: 'would_grant', grantId: null });
    expect(await liveGrants(admin.id)).toBe(0);

    const applied = await runPlatformAdminDesignation(
      client,
      { email: admin.email.toUpperCase(), reason },
      { apply: true, appEnv: 'test' },
    );
    expect(applied.verdict).toBe('granted');
    expect(await liveGrants(admin.id)).toBe(1);
    const stored = await client.query<{ grant_reason: string }>(
      'SELECT grant_reason FROM public.platform_admin_assignments WHERE id = $1',
      [applied.grantId],
    );
    expect(stored.rows[0]!.grant_reason).toBe(reason);

    const again = await runPlatformAdminDesignation(
      client,
      { email: admin.email, reason },
      { apply: true, appEnv: 'test' },
    );
    expect(again).toMatchObject({ verdict: 'already_platform_admin', grantId: applied.grantId });
    expect(await liveGrants(admin.id)).toBe(1);
  });

  it('refuses non-admin accounts, Hospital Admins, unknown accounts and granters', async () => {
    const doctor = await account('doctor');
    const asDoctor = await runPlatformAdminDesignation(
      client,
      { email: doctor.email, reason },
      { apply: true, appEnv: 'test' },
    );
    expect(asDoctor.verdict).toBe('not_admin_role');

    const hospitalAdminUser = await account('admin');
    const hospital = await newHospital();
    hospitals.push(hospital);
    await hospitalAdmin(hospitalAdminUser.id, hospital);
    const refusedHospitalAdmin = await runPlatformAdminDesignation(
      client,
      { email: hospitalAdminUser.email, reason },
      { apply: true, appEnv: 'test' },
    );
    expect(refusedHospitalAdmin).toMatchObject({
      verdict: 'holds_hospital_admin_assignment',
      liveHospitalAdminAssignments: 1,
    });
    expect(await liveGrants(hospitalAdminUser.id)).toBe(0);

    const unknown = await runPlatformAdminDesignation(
      client,
      { email: `nobody-${randomUUID()}@platform-admin.test`, reason },
      { apply: true, appEnv: 'test' },
    );
    expect(unknown.verdict).toBe('account_not_found');

    const admin = await account('admin');
    const unknownGranter = await runPlatformAdminDesignation(
      client,
      { email: admin.email, reason, grantedByEmail: `nobody-${randomUUID()}@platform-admin.test` },
      { apply: true, appEnv: 'test' },
    );
    expect(unknownGranter.verdict).toBe('granter_not_found');
    expect(await liveGrants(admin.id)).toBe(0);
  });

  it('refuses --apply in production and a blank reason; a production dry run only reads', async () => {
    const admin = await account('admin');
    expect(() => assertApplyPermitted('production')).toThrow();
    await expect(
      runPlatformAdminDesignation(
        client,
        { email: admin.email, reason },
        { apply: true, appEnv: 'production' },
      ),
    ).rejects.toThrow(/Refusing to apply a Platform Admin designation to a production database/);
    await expect(
      runPlatformAdminDesignation(
        client,
        { email: admin.email, reason: '  ' },
        { apply: false, appEnv: 'test' },
      ),
    ).rejects.toThrow(/--reason is required/);
    expect(await liveGrants(admin.id)).toBe(0);

    const dry = await runPlatformAdminDesignation(
      client,
      { email: admin.email, reason },
      { apply: false, appEnv: 'production' },
    );
    expect(dry.verdict).toBe('would_grant');
    expect(await liveGrants(admin.id)).toBe(0);
  });
});
