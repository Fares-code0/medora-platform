/**
 * Role separation (WP-5) — the runtime role produced by
 * `prisma/roles/provision-runtime-role.sql`, verified on PostgreSQL 16.
 *
 * Each test runs the real template (tokens substituted) inside a transaction
 * that is always rolled back: the role, its grants and default privileges
 * disappear with it. The connecting role plays the migration/owner role.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createIsolatedDatabase, type IsolatedDatabase } from './support/isolated-database';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
if (new URL(rawDatabaseUrl).pathname !== '/medora_test' || process.env['APP_ENV'] !== 'test') {
  throw new Error('Refusing role-separation tests outside the disposable medora_test database.');
}

const TEMPLATE = readFileSync(
  resolve(__dirname, '../prisma/roles/provision-runtime-role.sql'),
  'utf8',
);
const PROPOSAL = readFileSync(
  resolve(__dirname, '../prisma/rls-proposal/phase22-rls-proposal.sql'),
  'utf8',
);
// The template and the RLS proposal take ACCESS EXCLUSIVE locks on real
// tables until rollback. They run in a throwaway database of their own
// (test/support/isolated-database.ts), never on the shared medora_test that
// parallel spec files use.
let isolated: IsolatedDatabase | undefined;
let client: Client;
let connected = false;

beforeAll(async () => {
  isolated = await createIsolatedDatabase(rawDatabaseUrl, 'roles');
  client = new Client({ connectionString: isolated.url });
  await client.connect();
  connected = true;
  const identity = await client.query<{ db: string }>('SELECT current_database() AS db');
  if (identity.rows[0]?.db !== isolated.name) {
    throw new Error('Refusing role-separation tests: not connected to the isolated database.');
  }
}, 120_000);

afterAll(async () => {
  if (connected) await client.end();
  await isolated?.drop();
}, 30_000);

const tag = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

/** Provisions a runtime role in a rolled-back transaction and runs `work`. */
async function withRuntimeRole(
  work: (runtime: string, owner: string) => Promise<void>,
): Promise<void> {
  const owner = (await client.query<{ u: string }>('SELECT current_user AS u')).rows[0]!.u;
  const runtime = 'medora_app_test_' + tag();
  await client.query('BEGIN');
  try {
    await client.query(
      TEMPLATE.replaceAll('__RUNTIME_ROLE__', runtime).replaceAll('__OWNER_ROLE__', owner),
    );
    await work(runtime, owner);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function asRuntime(runtime: string): Promise<void> {
  await client.query('RESET ROLE');
  await client.query(`SET LOCAL ROLE ${runtime}`);
}

async function refused(sql: string, values: unknown[] = [], code = '42501'): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  await expect(client.query(sql, values)).rejects.toMatchObject({ code });
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
}

async function hospital(): Promise<string> {
  return (
    await client.query<{ id: string }>(
      "INSERT INTO public.hospitals (public_id, name, updated_at) VALUES ($1, 'Role test', CURRENT_TIMESTAMP) RETURNING id",
      ['hsp_' + randomUUID()],
    )
  ).rows[0]!.id;
}

const insertQueue =
  "INSERT INTO public.queue_entries (ticket, patient_name, reason, estimated_minutes, updated_at, hospital_id) VALUES ($1, 'Role', 'r', 1, CURRENT_TIMESTAMP, $2) RETURNING id";

describe('runtime role (provision-runtime-role.sql)', () => {
  it('is not a superuser, cannot bypass RLS, cannot create roles or databases, and owns nothing', async () => {
    await withRuntimeRole(async (runtime) => {
      const attributes = (
        await client.query<{
          rolsuper: boolean;
          rolbypassrls: boolean;
          rolcreaterole: boolean;
          rolcreatedb: boolean;
          owned: string;
        }>(
          'SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, (SELECT count(*) FROM pg_class c WHERE c.relowner = r.oid) AS owned FROM pg_roles r WHERE rolname = $1',
          [runtime],
        )
      ).rows[0]!;
      expect(attributes).toMatchObject({
        rolsuper: false,
        rolbypassrls: false,
        rolcreaterole: false,
        rolcreatedb: false,
      });
      expect(Number(attributes.owned)).toBe(0);
    });
  });

  it('reads and writes application data, and uses the reference sequences', async () => {
    await withRuntimeRole(async (runtime) => {
      const h = await hospital();
      await asRuntime(runtime);
      const id = (await client.query<{ id: string }>(insertQueue, ['RT' + tag().slice(0, 6), h]))
        .rows[0]!.id;
      expect(
        (await client.query("UPDATE public.queue_entries SET reason = 'u' WHERE id = $1", [id]))
          .rowCount,
      ).toBe(1);
      expect(
        (await client.query('SELECT 1 FROM public.queue_entries WHERE id = $1', [id])).rowCount,
      ).toBe(1);
      expect(
        (await client.query('DELETE FROM public.queue_entries WHERE id = $1', [id])).rowCount,
      ).toBe(1);
      await expect(
        client.query("SELECT nextval('public.patient_identity_seq')"),
      ).resolves.toBeDefined();
    });
  });

  it('can append to the audit ledger but never update or delete it (ADR-007 R2)', async () => {
    await withRuntimeRole(async (runtime) => {
      await asRuntime(runtime);
      await client.query(
        "INSERT INTO public.audit_events (category, event_type, summary) VALUES ('system', 'role.test', 'runtime append')",
      );
      await refused("UPDATE public.audit_events SET summary = 'x' WHERE event_type = 'role.test'");
      await refused("DELETE FROM public.audit_events WHERE event_type = 'role.test'");
    });
  });

  it('cannot run DDL, TRUNCATE or role management', async () => {
    await withRuntimeRole(async (runtime) => {
      await asRuntime(runtime);
      await refused('CREATE TABLE public.runtime_should_not_create (id int)');
      await refused('ALTER TABLE public.queue_entries ADD COLUMN runtime_col int');
      await refused('DROP TABLE public.queue_entries');
      await refused('TRUNCATE public.queue_entries');
      await refused('CREATE ROLE runtime_should_not_create_role');
      // GRANT without grant rights only warns ("no privileges were granted"); prove nothing changed.
      await client.query('GRANT SELECT ON public.users TO PUBLIC');
      await client.query('RESET ROLE');
      expect(
        (
          await client.query(
            "SELECT has_table_privilege('public', 'public.users', 'SELECT') AS granted",
          )
        ).rows[0],
      ).toEqual({ granted: false });
    });
  });

  it('gets access to tables a later migration creates, through default privileges', async () => {
    await withRuntimeRole(async (runtime) => {
      await client.query('CREATE TABLE public.role_test_later_migration (id int PRIMARY KEY)');
      await client.query('INSERT INTO public.role_test_later_migration VALUES (1)');
      await asRuntime(runtime);
      expect((await client.query('SELECT id FROM public.role_test_later_migration')).rowCount).toBe(
        1,
      );
    });
  });

  it('is bound by RLS where the owner is not (proposal applied in the same transaction)', async () => {
    await withRuntimeRole(async (runtime) => {
      const a = await hospital();
      const b = await hospital();
      const qa = (await client.query<{ id: string }>(insertQueue, ['RA' + tag().slice(0, 6), a]))
        .rows[0]!.id;
      const qb = (await client.query<{ id: string }>(insertQueue, ['RB' + tag().slice(0, 6), b]))
        .rows[0]!.id;
      await client.query(PROPOSAL);
      await client.query(`GRANT USAGE ON SCHEMA app_rls TO ${runtime}`);
      await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_rls TO ${runtime}`);

      const visible = async (): Promise<string[]> =>
        (
          await client.query<{ id: string }>(
            'SELECT id FROM public.queue_entries WHERE id = ANY($1::uuid[])',
            [[qa, qb]],
          )
        ).rows
          .map((r) => r.id)
          .sort();

      expect(await visible()).toEqual([qa, qb].sort()); // owner: bypass
      await client.query("SELECT set_config('app.hospital_id', $1, true)", [a]);
      await asRuntime(runtime);
      expect(await visible()).toEqual([qa]);
      await client.query('RESET ROLE');
      await client.query("SELECT set_config('app.hospital_id', '', true)");
      await asRuntime(runtime);
      expect(await visible()).toEqual([]);
    });
  });

  it('cannot run the audit partition jobs as they are written today (finding: needs a decision)', async () => {
    await withRuntimeRole(async (runtime, owner) => {
      await asRuntime(runtime);
      // create_audit_events_partition is SECURITY INVOKER and runs CREATE TABLE.
      await refused("SELECT public.create_audit_events_partition(DATE '2099-01-01')");
      // audit.repository.ts drops expired partitions with DROP TABLE.
      await refused('DROP TABLE IF EXISTS public.audit_events_2026_11');

      // One possible remedy, demonstrated (not adopted): an owner-defined
      // SECURITY DEFINER wrapper. create_audit_events_partition uses
      // UNQUALIFIED names, so the wrapper must pin `public` first (pg_temp
      // last; the runtime role cannot create in public) — with
      // `pg_catalog, public` it tries to create the partition in pg_catalog.
      // Adopting this for real should first schema-qualify the function.
      await client.query('RESET ROLE');
      await client.query(
        'CREATE FUNCTION public.role_test_create_partition(month_start date) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$ SELECT public.create_audit_events_partition(month_start) $$',
      );
      await client.query(
        `ALTER FUNCTION public.role_test_create_partition(date) OWNER TO ${owner}`,
      );
      await client.query(
        `GRANT EXECUTE ON FUNCTION public.role_test_create_partition(date) TO ${runtime}`,
      );
      await asRuntime(runtime);
      await client.query("SELECT public.role_test_create_partition(DATE '2099-01-01')");
      await client.query('RESET ROLE');
      expect(
        (
          await client.query(
            "SELECT to_regclass('public.audit_events_2099_01') IS NOT NULL AS made",
          )
        ).rows[0],
      ).toEqual({ made: true });
    });
  });

  it('leaves the migration/owner role able to run DDL and unaffected by RLS', async () => {
    await withRuntimeRole(async () => {
      await client.query('CREATE TABLE public.role_test_owner_ddl (id int)');
      await client.query('ALTER TABLE public.role_test_owner_ddl ADD COLUMN note text');
      await client.query('DROP TABLE public.role_test_owner_ddl');
    });
  });

  it('leaves no role behind after the transaction', async () => {
    const leftovers = await client.query(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'medora\\_app\\_test\\_%'",
    );
    expect(leftovers.rowCount).toBe(0);
  });
});
