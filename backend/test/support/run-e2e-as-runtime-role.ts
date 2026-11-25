/**
 * The whole e2e suite with the application connected as the restricted
 * runtime role (multi-hospital §2.15; final verification of the security
 * remediation).
 *
 * 1. Provisions a LOGIN role from the real template
 *    (`prisma/roles/provision-runtime-role.sql`): NOSUPERUSER, NOBYPASSRLS,
 *    owning nothing. It is never made an owner and never given BYPASSRLS.
 * 2. Runs `vitest run test` with `E2E_RUNTIME_DATABASE_URL` pointing at it:
 *    every harness then boots the application as that role with
 *    `DATABASE_TENANT_CONTEXT=true`, while migrations, fixtures, cleanup and
 *    assertions keep the owner connection (`DATABASE_URL`).
 * 3. Drops the role again, whatever the outcome.
 *
 * Usage: `npm run test:e2e:runtime-role [-- <vitest args>]`.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

const OWNER_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://medora:medora@localhost:5432/medora_test?schema=public';
const ROLE = 'medora_e2e_app_runtime';
const PASSWORD = `rt_${randomUUID().replace(/-/g, '')}`;

async function main(): Promise<number> {
  const owner = new Client({ connectionString: OWNER_URL.replace(/\?.*$/, '') });
  await owner.connect();
  try {
    const ownerRole = (await owner.query<{ r: string }>('SELECT current_user AS r')).rows[0]?.r ?? '';
    await owner.query(`DROP OWNED BY ${ROLE}`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
    await owner.query(
      readFileSync(join(__dirname, '../../prisma/roles/provision-runtime-role.sql'), 'utf8')
        .replaceAll('__RUNTIME_ROLE__', ROLE)
        .replaceAll('__OWNER_ROLE__', ownerRole),
    );
    await owner.query(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
    const facts = (
      await owner.query<{ super: boolean; bypass: boolean }>(
        'SELECT rolsuper AS super, rolbypassrls AS bypass FROM pg_roles WHERE rolname = $1',
        [ROLE],
      )
    ).rows[0];
    if (facts === undefined || facts.super || facts.bypass) throw new Error('the runtime role is not restricted');

    const runtime = new URL(OWNER_URL);
    runtime.username = ROLE;
    runtime.password = PASSWORD;

    // Named files narrow the run; with none, the whole e2e directory.
    const targets = process.argv.slice(2);
    const result = spawnSync('npx', ['vitest', 'run', ...(targets.length > 0 ? targets : ['test'])], {
      cwd: join(__dirname, '../..'),
      stdio: 'inherit',
      env: { ...process.env, CI: 'true', DATABASE_URL: OWNER_URL, E2E_RUNTIME_DATABASE_URL: runtime.toString() },
    });
    return result.status ?? 1;
  } finally {
    // Not left behind (F-16): its grants in this database, then the role.
    await owner.query(`DROP OWNED BY ${ROLE}`).catch(() => undefined);
    await owner.query(`DROP ROLE IF EXISTS ${ROLE}`).catch(() => undefined);
    await owner.end();
  }
}

main().then(
  (status) => process.exit(status),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
