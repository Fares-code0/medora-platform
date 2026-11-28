/**
 * R-02 (PR-68): a patient never reads a clinical file at the database layer.
 * Migration 20261127120000_r02_patient_clinical_files_deny; design
 * docs/audits/PR-68-R02-PATIENT-FILE-ACCESS-DESIGN.md §11.
 *
 * Built in the **production order** the migration must survive. The shared
 * runner (`run-e2e-as-runtime-role.ts`) provisions the role only after every
 * migration, so it cannot reproduce that order:
 *
 *   1. a throwaway database next to the disposable `medora_test`, migrated
 *      with every committed migration **before** R-02;
 *   2. the runtime role and the audit-maintenance roles provisioned from the
 *      real templates (unique names per run; the roles are cluster-wide);
 *   3. the R-02 pre-apply checks (`prisma/roles/r02-preapply-check.sql`);
 *   4. the R-02 migration file itself, exactly as committed;
 *   5. function privileges asserted, then every read made **as the
 *      restricted runtime role** (a LOGIN connection, NOSUPERUSER,
 *      NOBYPASSRLS, asserted first), under the same `set_config` statement
 *      the application issues (`src/shared/database/tenant-context.ts`).
 *
 * The migrations are applied with `pg`, one file per query, rather than by
 * spawning `prisma migrate deploy`. That keeps the spec runnable where
 * `spawn npx` is not (Windows). Prisma's own transaction behaviour was
 * verified separately (design §11.5).
 *
 * Fixtures are inserted as the owner with `session_replication_role =
 * replica`, so that only the rows under test exist. That needs a superuser
 * owner, which the disposable test server has.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRoleStatement, withRoleProvisioningLock } from './support/role-provisioning-lock';

const R02 = '20261127120000_r02_patient_clinical_files_deny';
const BACKEND = join(__dirname, '..');
const MIGRATIONS = join(BACKEND, 'prisma/migrations');
const FORWARD_SQL = readFileSync(join(MIGRATIONS, R02, 'migration.sql'), 'utf8');
const ROLLBACK_SQL = readFileSync(join(BACKEND, 'prisma/rollbacks', `${R02}.down.sql`), 'utf8');
const PREAPPLY_SQL = readFileSync(join(BACKEND, 'prisma/roles/r02-preapply-check.sql'), 'utf8');

const TAG = randomUUID().replaceAll('-', '').slice(0, 8);
const RUNTIME = `medora_r02rt_${TAG}`;
const MAINT_GROUP = `medora_r02mg_${TAG}`;
const MAINT_LOGIN = `medora_r02ml_${TAG}`;
const PASSWORD = `rt_${randomUUID().replaceAll('-', '')}`;
const DB = `medora_test_r02files_${TAG}`;

let sharedUrl = '';
let owner: Client;
let runtime: Client;
let ownerRole = '';

// ── Fixture identities ───────────────────────────────────────────────────
const U = (n: string) => `00000000-0000-0000-0000-${n.padStart(12, '0')}`;
const H1 = U('a1');
const H2 = U('a2');
const people = {
  P1: U('b1'), P2: U('b2'), U: U('b3'),
  D1: U('c1'), D2: U('c2'), R1: U('c3'), N1: U('c4'), PA: U('c5'),
};
const PATIENT1 = U('d1');
const PATIENT2 = U('d2');
const file = (n: number) => U(`f${String(n).padStart(2, '0')}`);

interface Context {
  readonly scope: string;
  readonly hospital?: string;
  readonly user?: string;
  readonly patient?: string;
}
const CONTEXTS: Record<string, Context> = {
  'P1/patient': { scope: 'patient', user: people.P1, patient: PATIENT1 },
  'P2/patient': { scope: 'patient', user: people.P2, patient: PATIENT2 },
  'U/self': { scope: 'self', user: people.U },
  'D1/hospital1': { scope: 'hospital', hospital: H1, user: people.D1 },
  'D2/hospital2': { scope: 'hospital', hospital: H2, user: people.D2 },
  'R1/hospital1': { scope: 'hospital', hospital: H1, user: people.R1 },
  'N1/self': { scope: 'self', user: people.N1 },
  'PA/platform': { scope: 'platform', user: people.PA },
  system: { scope: 'system' },
  anonymous: { scope: '' },
};

const ALL = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14', 'F15'];
const STAFF_H1 = ['F1', 'F2', 'F3', 'F7', 'F8', 'F9', 'F10', 'F12', 'F13'];
/** Unchanged by R-02: every non-patient context. */
const NON_PATIENT: Record<string, string[]> = {
  'D1/hospital1': STAFF_H1,
  'D2/hospital2': ['F9', 'F10', 'F11'],
  'R1/hospital1': STAFF_H1,
  'N1/self': ['F9', 'F10', 'F15'],
  'PA/platform': ALL,
  system: ALL,
  anonymous: ['F9', 'F10'],
};
/** Before R-02 (the bypasses, design §11.6). */
const BEFORE: Record<string, string[]> = {
  ...NON_PATIENT,
  'P1/patient': ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F12', 'F13'],
  'P2/patient': ['F9', 'F10', 'F11'],
  'U/self': ['F7', 'F8', 'F9', 'F10', 'F14'],
};
/** After R-02. */
const AFTER: Record<string, string[]> = {
  ...NON_PATIENT,
  'P1/patient': ['F7', 'F10'],
  'P2/patient': ['F10'],
  'U/self': ['F7', 'F10'],
};

// ── Helpers ──────────────────────────────────────────────────────────────
function withDatabase(base: string, name: string, user?: { name: string; password: string }): string {
  const url = new URL(base.replace(/\?.*$/, ''));
  url.pathname = `/${name}`;
  if (user !== undefined) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

async function onServer<T>(work: (admin: Client) => Promise<T>): Promise<T> {
  const admin = new Client({ connectionString: sharedUrl.replace(/\?.*$/, '') });
  await admin.connect();
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
}

/** Runs a script that carries its own BEGIN/COMMIT; on error, clears the aborted transaction. */
async function runScript(client: Client, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function preApply(): Promise<void> {
  await owner.query(
    PREAPPLY_SQL.replaceAll('__RUNTIME_ROLE__', RUNTIME).replaceAll('__OWNER_ROLE__', ownerRole),
  );
}

async function visible(context: Context): Promise<string[]> {
  await runtime.query('BEGIN');
  try {
    await runtime.query(
      "SELECT set_config('app.scope', $1, true), set_config('app.hospital_id', $2, true), " +
        "set_config('app.user_id', $3, true), set_config('app.patient_id', $4, true)",
      [context.scope, context.hospital ?? '', context.user ?? '', context.patient ?? ''],
    );
    const rows = await runtime.query<{ original_name: string }>('SELECT original_name FROM public.files');
    return rows.rows.map((row) => row.original_name).sort(byFileNumber);
  } finally {
    await runtime.query('ROLLBACK');
  }
}

function byFileNumber(a: string, b: string): number {
  return Number(a.slice(1)) - Number(b.slice(1));
}

async function matrix(): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const [name, context] of Object.entries(CONTEXTS)) result[name] = await visible(context);
  return result;
}

function sorted(expected: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, [...v].sort(byFileNumber)]));
}

async function snapshot(): Promise<string> {
  const rows = await owner.query<{ line: string }>(`
    SELECT concat_ws('|', 'policy', polname, polcmd::text, polpermissive::text, polroles::text,
                     COALESCE(pg_get_expr(polqual, polrelid), ''), COALESCE(pg_get_expr(polwithcheck, polrelid), '')) AS line
      FROM pg_policy WHERE polrelid = 'public.files'::regclass
    UNION ALL
    SELECT concat_ws('|', 'function', p.oid::regprocedure::text, p.proowner::regrole::text, p.prosecdef::text,
                     COALESCE(p.proacl::text, 'NULL'), md5(p.prosrc), COALESCE(array_to_string(p.proconfig, ','), ''))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app_rls'
    UNION ALL
    SELECT concat_ws('|', 'rls', relname, relrowsecurity::text, relforcerowsecurity::text)
      FROM pg_class WHERE oid = 'public.files'::regclass
    ORDER BY 1`);
  return rows.rows.map((row) => row.line).join('\n');
}

async function canExecute(role: string): Promise<boolean> {
  const rows = await owner.query<{ ok: boolean }>(
    "SELECT has_function_privilege($1, 'app_rls.file_denied_to_patient(uuid,text)', 'EXECUTE') AS ok",
    [role],
  );
  return rows.rows[0]?.ok === true;
}

async function seedFixtures(): Promise<void> {
  await owner.query('BEGIN');
  await owner.query('SET LOCAL session_replication_role = replica');
  await owner.query(
    `INSERT INTO roles (code, label, updated_at)
     SELECT c, c, now() FROM unnest(ARRAY['patient','doctor','reception','admin']) c
      WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = c)`,
  );
  await owner.query(
    `INSERT INTO hospitals (id, public_id, name, updated_at) VALUES ($1, 'hsp_r02_1', 'R02 One', now()), ($2, 'hsp_r02_2', 'R02 Two', now())`,
    [H1, H2],
  );
  const users: [string, string][] = [
    [people.P1, 'patient'], [people.P2, 'patient'], [people.U, 'patient'],
    [people.D1, 'doctor'], [people.D2, 'doctor'], [people.R1, 'reception'],
    [people.N1, 'doctor'], [people.PA, 'admin'],
  ];
  for (const [id, role] of users) {
    await owner.query(
      `INSERT INTO users (id, public_id, first_name, last_name, display_name, email, phone, role_id,
                          terms_accepted_at, privacy_accepted_at, updated_at)
       SELECT $1::uuid, 'usr_r02_' || $3::text, 'R02', 'R02', 'R02', $3::text || '@r02.test',
              '+10000000000', r.id, now(), now(), now() FROM roles r WHERE r.code = $2`,
      [id, role, id.slice(24)],
    );
  }
  await owner.query(
    `INSERT INTO patients (id, public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, user_id, updated_at) VALUES
      ($1, 'PT-R02-1', 'MRN-R02-1', 'P One', '1990-01-01', 'female', 'O+', '+10000000001', $3, now()),
      ($2, 'PT-R02-2', 'MRN-R02-2', 'P Two', '1990-01-01', 'male',   'A+', '+10000000002', $4, now())`,
    [PATIENT1, PATIENT2, people.P1, people.P2],
  );
  const hmr1 = U('91');
  const hmr2 = U('93');
  await owner.query(
    `INSERT INTO hospital_medical_records (id, patient_id, hospital_id, updated_at) VALUES
      ($1, $3, $5, now()), ($2, $4, $6, now())`,
    [hmr1, hmr2, PATIENT1, PATIENT2, H1, H2],
  );
  const lo1 = U('e1');
  const lo2 = U('e2');
  const mr1 = U('e3');
  await owner.query(
    `INSERT INTO lab_orders (id, public_id, patient_id, test_id, ordered_by, clinical_indication, hospital_id,
                             hospital_medical_record_id, doctor_employment_id, updated_at) VALUES
      ($1, 'LAB-R02-1', $3, gen_random_uuid(), $5, 'x', $7, $9, gen_random_uuid(), now()),
      ($2, 'LAB-R02-2', $4, gen_random_uuid(), $6, 'x', $8, $10, gen_random_uuid(), now())`,
    [lo1, lo2, PATIENT1, PATIENT2, people.D1, people.D2, H1, H2, hmr1, hmr2],
  );
  await owner.query(
    `INSERT INTO medical_records (id, public_id, patient_id, doctor_id, visit_date, visit_type, chief_complaint,
                                  history_of_present_illness, physical_examination, hospital_id,
                                  hospital_medical_record_id, doctor_employment_id, updated_at)
     VALUES ($1, 'MR-R02-1', $2, gen_random_uuid(), now(), 'x', 'x', 'x', 'x', $3, $4, gen_random_uuid(), now())`,
    [mr1, PATIENT1, H1, hmr1],
  );
  const files: [number, string, string | null, string][] = [
    [1, 'lab_attachment', H1, people.D1],
    [2, 'record_attachment', H1, people.D1],
    [3, 'patient_document', H1, people.R1],
    [4, 'lab_attachment', null, people.P1],
    [5, 'record_attachment', null, people.P1],
    [6, 'patient_document', null, people.P1],
    [7, 'message_attachment', H1, people.D1],
    [8, 'lab_attachment', H1, people.D1],
    [9, 'profile_photo', H1, people.D1], // relabelled: linked as a lab attachment below
    [10, 'profile_photo', null, people.P1],
    [11, 'lab_attachment', H2, people.D2],
    [12, 'patient_document', H1, people.R1], // its link is soft-deleted
    [13, 'message_attachment', H1, people.P1], // a patient upload later linked to a record
    [14, 'lab_attachment', null, people.U],
    [15, 'record_attachment', null, people.N1],
  ];
  for (const [n, kind, hospital, uploader] of files) {
    await owner.query(
      `INSERT INTO files (id, storage_key, original_name, mime_type, size_bytes, checksum_sha256, kind, hospital_id, uploaded_by)
       VALUES ($1, $2, $3, 'application/pdf', 1, repeat('0', 64), $4, $5, $6)`,
      [file(n), `r02/F${n}`, `F${n}`, kind, hospital, uploader],
    );
  }
  for (const [order, n] of [[lo1, 1], [lo1, 8], [lo1, 9], [lo2, 11]] as const) {
    await owner.query(
      `INSERT INTO lab_attachments (lab_order_id, name, kind, size_kb, file_id, updated_at) VALUES ($1, $2, 'report', 1, $3, now())`,
      [order, `F${n}`, file(n)],
    );
  }
  for (const n of [2, 13]) {
    await owner.query(
      `INSERT INTO record_attachments (record_id, name, kind, size_kb, file_id, updated_at) VALUES ($1, $2, 'lab-result', 1, $3, now())`,
      [mr1, `F${n}`, file(n)],
    );
  }
  await owner.query(
    `INSERT INTO patient_documents (patient_id, name, category, size_kb, file_id, hospital_id, hospital_medical_record_id, updated_at, deleted_at)
     VALUES ($1, 'F3', 'report', 1, $2, $4, $5, now(), NULL), ($1, 'F12', 'report', 1, $3, $4, $5, now(), now())`,
    [PATIENT1, file(3), file(12), H1, hmr1],
  );
  const conversation = U('f1');
  const message = U('f2');
  await owner.query(
    `INSERT INTO conversations (id, hospital_id, patient_id, hospital_medical_record_id, updated_at) VALUES ($1, $2, $3, $4, now())`,
    [conversation, H1, PATIENT1, hmr1],
  );
  for (const participant of [people.D1, people.P1, people.U]) {
    await owner.query('INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2)', [
      conversation,
      participant,
    ]);
  }
  await owner.query(`INSERT INTO messages (id, conversation_id, body, updated_at) VALUES ($1, $2, 'm', now())`, [
    message,
    conversation,
  ]);
  // F7: a genuine message attachment. F8: a clinical lab file attached to a message (design §6.1).
  for (const n of [7, 8]) {
    await owner.query(
      `INSERT INTO message_attachments (message_id, file_id, kind, name, size_bytes) VALUES ($1, $2, 'file', $3, 1)`,
      [message, file(n), `F${n}`],
    );
  }
  await owner.query('COMMIT');
}

// ── Setup: production order ──────────────────────────────────────────────
let preForwardSnapshot = '';

beforeAll(async () => {
  sharedUrl = process.env['DATABASE_URL'] ?? '';
  if (new URL(sharedUrl).pathname !== '/medora_test') {
    throw new Error('This spec only creates its database next to the disposable medora_test.');
  }
  await onServer((admin) => admin.query(`CREATE DATABASE "${DB}"`));

  owner = new Client({ connectionString: withDatabase(sharedUrl, DB) });
  await owner.connect();
  const facts = await owner.query<{ r: string; su: boolean }>(
    'SELECT current_user AS r, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su',
  );
  ownerRole = facts.rows[0]?.r ?? '';
  if (facts.rows[0]?.su !== true) throw new Error('Fixtures need a superuser owner (session_replication_role).');

  // 1. Every committed migration before R-02.
  const before = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name < R02)
    .map((entry) => entry.name)
    .sort();
  for (const name of before) await runScript(owner, readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8'));

  // 2. Provision both templates BEFORE R-02, as production does.
  await withRoleProvisioningLock(owner, async () => {
    await applyRoleStatement(
      owner,
      readFileSync(join(BACKEND, 'prisma/roles/provision-runtime-role.sql'), 'utf8')
        .replaceAll('__RUNTIME_ROLE__', RUNTIME)
        .replaceAll('__OWNER_ROLE__', ownerRole),
    );
    await applyRoleStatement(
      owner,
      readFileSync(join(BACKEND, 'prisma/roles/provision-audit-maintenance-role.sql'), 'utf8')
        .replaceAll('medora_audit_maintenance', MAINT_GROUP)
        .replaceAll('__MAINTENANCE_LOGIN__', MAINT_LOGIN)
        .replaceAll('__OWNER_ROLE__', ownerRole),
    );
    await owner.query(`ALTER ROLE ${RUNTIME} LOGIN PASSWORD '${PASSWORD}'`);
  });

  await seedFixtures();

  runtime = new Client({ connectionString: withDatabase(sharedUrl, DB, { name: RUNTIME, password: PASSWORD }) });
  await runtime.connect();
}, 600_000);

afterAll(async () => {
  await runtime?.end().catch(() => undefined);
  await owner?.end().catch(() => undefined);
  if (sharedUrl === '') return;
  await onServer(async (admin) => {
    await admin.query(`DROP DATABASE IF EXISTS "${DB}" WITH (FORCE)`);
    await withRoleProvisioningLock(admin, async () => {
      for (const role of [MAINT_LOGIN, MAINT_GROUP, RUNTIME]) {
        await applyRoleStatement(admin, `DROP ROLE IF EXISTS ${role}`);
      }
    });
  });
}, 120_000);

// ── The spec ─────────────────────────────────────────────────────────────
describe('R-02: patient clinical files at the database layer (production order)', { timeout: 120_000 }, () => {
  it('reads as the restricted runtime role, never as the owner', async () => {
    const who = await runtime.query<{ cu: string; su: boolean; bypass: boolean }>(
      `SELECT current_user AS cu, rolsuper AS su, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`,
    );
    expect(who.rows[0]).toEqual({ cu: RUNTIME, su: false, bypass: false });
  });

  it('pre-apply checks pass on the provisioned database and fail closed on a bad state', async () => {
    await expect(preApply()).resolves.toBeUndefined();

    // Check 1: an extra (restrictive) policy on files.
    await owner.query('BEGIN');
    await owner.query('CREATE POLICY r02_extra ON public.files AS RESTRICTIVE FOR SELECT USING (true)');
    await expect(preApply()).rejects.toThrow(/R-02 check 1 failed/);
    await owner.query('ROLLBACK');

    // Check 2: PUBLIC can execute the conversation helper.
    await owner.query('BEGIN');
    await owner.query('GRANT EXECUTE ON FUNCTION app_rls.file_in_my_conversation(uuid) TO PUBLIC');
    await expect(preApply()).rejects.toThrow(/R-02 check 2 failed/);
    await owner.query('ROLLBACK');

    // Check 3: FORCE RLS on a table the helper reads.
    await owner.query('BEGIN');
    await owner.query('ALTER TABLE public.lab_attachments FORCE ROW LEVEL SECURITY');
    await expect(preApply()).rejects.toThrow(/R-02 check 3 failed/);
    await owner.query('ROLLBACK');

    await expect(preApply()).resolves.toBeUndefined();
  });

  it('reproduces every bypass before R-02 (the baseline)', async () => {
    expect(await matrix()).toEqual(sorted(BEFORE));
  });

  it('aborts, changing nothing, when PUBLIC can execute file_in_my_conversation', async () => {
    preForwardSnapshot = await snapshot();
    await owner.query('GRANT EXECUTE ON FUNCTION app_rls.file_in_my_conversation(uuid) TO PUBLIC');
    try {
      await expect(runScript(owner, FORWARD_SQL)).rejects.toThrow(/grant set is undeterminable/);
    } finally {
      await owner.query('REVOKE EXECUTE ON FUNCTION app_rls.file_in_my_conversation(uuid) FROM PUBLIC');
    }
    expect(await snapshot()).toBe(preForwardSnapshot);
  });

  it('applies after provisioning and grants EXECUTE to the runtime role only', async () => {
    await runScript(owner, FORWARD_SQL);

    expect(await canExecute(RUNTIME)).toBe(true);
    expect(await canExecute(MAINT_GROUP)).toBe(false);
    expect(await canExecute(MAINT_LOGIN)).toBe(false);
    const acl = await owner.query<{ grantees: string[] }>(
      `SELECT array_agg(a.grantee::regrole::text ORDER BY a.grantee::regrole::text) AS grantees
         FROM pg_proc p, LATERAL aclexplode(p.proacl) a
        WHERE p.oid = 'app_rls.file_denied_to_patient(uuid,text)'::regprocedure`,
    );
    expect(acl.rows[0]?.grantees).toEqual([ownerRole, RUNTIME].sort());
    const definer = await owner.query<{ secdef: boolean; config: string[] }>(
      `SELECT prosecdef AS secdef, proconfig AS config FROM pg_proc
        WHERE oid = 'app_rls.file_denied_to_patient(uuid,text)'::regprocedure`,
    );
    expect(definer.rows[0]).toEqual({ secdef: true, config: ['search_path=pg_catalog, pg_temp'] });
  });

  it('closes every patient path and leaves every other context unchanged', async () => {
    expect(await matrix()).toEqual(sorted(AFTER));
  });

  it('cannot be read through UPDATE/DELETE ... RETURNING', async () => {
    await runtime.query('BEGIN');
    try {
      await runtime.query(
        "SELECT set_config('app.scope','patient',true), set_config('app.user_id',$1,true), set_config('app.patient_id',$2,true)",
        [people.P1, PATIENT1],
      );
      const updated = await runtime.query(
        'UPDATE public.files SET original_name = original_name WHERE id = $1 RETURNING original_name',
        [file(1)],
      );
      expect(updated.rows).toEqual([]);
      const deleted = await runtime.query('DELETE FROM public.files WHERE id = $1 RETURNING original_name', [file(4)]);
      expect(deleted.rows).toEqual([]);
      const bare = await runtime.query<{ original_name: string }>(
        'UPDATE public.files SET original_name = original_name RETURNING original_name',
      );
      expect(bare.rows.map((row) => row.original_name)).toEqual(['F10']);
    } finally {
      await runtime.query('ROLLBACK');
    }
    const stillThere = await owner.query('SELECT 1 FROM public.files WHERE id = $1', [file(4)]);
    expect(stillThere.rowCount).toBe(1);
  });

  it('the helper tells a non-patient caller nothing', async () => {
    await runtime.query('BEGIN');
    try {
      await runtime.query(
        "SELECT set_config('app.scope','hospital',true), set_config('app.hospital_id',$1,true), set_config('app.user_id',$2,true)",
        [H1, people.D1],
      );
      const answers = await runtime.query<{ clinical: boolean; random: boolean }>(
        `SELECT app_rls.file_denied_to_patient($1, 'profile_photo') AS clinical,
                app_rls.file_denied_to_patient(gen_random_uuid(), 'profile_photo') AS random`,
        [file(1)],
      );
      expect(answers.rows[0]).toEqual({ clinical: false, random: false });
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('rolls back exactly, restoring the previous behaviour, and re-applies', async () => {
    await runScript(owner, ROLLBACK_SQL);
    expect(await snapshot()).toBe(preForwardSnapshot);
    expect(await matrix()).toEqual(sorted(BEFORE));

    await runScript(owner, FORWARD_SQL);
    expect(await canExecute(RUNTIME)).toBe(true);
    expect(await matrix()).toEqual(sorted(AFTER));
  });
});
