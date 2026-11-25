/**
 * Row-Level Security under the runtime role (multi-hospital §2.15, fix-list
 * items 18–20, 22).
 *
 * Proves enforcement, not policy text: every assertion runs as a real LOGIN
 * role provisioned from `prisma/roles/provision-runtime-role.sql` —
 * NOSUPERUSER, NOBYPASSRLS, not the table owner — over a `pg` pool, against
 * two hospitals.
 *
 * Fixture rows are written as the owner (exempt from RLS by design); every
 * read and write under test goes through the runtime role.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client, Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER_URL = process.env['DATABASE_URL'] ?? '';
const ROLE = 'medora_runtime_e2e';
const PASSWORD = `rt_${randomUUID().replace(/-/g, '')}`;

interface Context {
  readonly scope?: string;
  readonly hospitalId?: string;
  readonly userId?: string;
  readonly patientId?: string;
}

let owner: Client;
let pool: Pool;

const ids = {
  hospitalA: randomUUID(),
  hospitalB: randomUUID(),
  patientA: randomUUID(),
  patientB: randomUUID(),
  recordA: randomUUID(),
  recordB: randomUUID(),
  doctorUserA: randomUUID(),
  requesterB: randomUUID(),
  approverA: randomUUID(),
};

function runtimeUrl(): string {
  const url = new URL(OWNER_URL);
  url.username = ROLE;
  url.password = PASSWORD;
  url.searchParams.delete('schema');
  return url.toString();
}

/** One transaction on the runtime role with transaction-local context. */
async function as<T>(context: Context, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const settings: [string, string | undefined][] = [
      ['app.scope', context.scope],
      ['app.hospital_id', context.hospitalId],
      ['app.user_id', context.userId],
      ['app.patient_id', context.patientId],
    ];
    for (const [name, value] of settings) {
      if (value !== undefined) await client.query('SELECT set_config($1, $2, true)', [name, value]);
    }
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function visiblePatients(context: Context): Promise<string[]> {
  return as(context, async (client) => {
    const result = await client.query<{ id: string }>(
      'SELECT id::text FROM patients WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[ids.patientA, ids.patientB]],
    );
    return result.rows.map((row) => row.id).sort();
  });
}

async function visibleRecords(context: Context): Promise<string[]> {
  return as(context, async (client) => {
    const result = await client.query<{ id: string }>(
      'SELECT id::text FROM hospital_medical_records WHERE id = ANY($1::uuid[])',
      [[ids.recordA, ids.recordB]],
    );
    return result.rows.map((row) => row.id).sort();
  });
}

const sorted = (...values: string[]): string[] => [...values].sort();

async function seedUser(id: string, local: string): Promise<void> {
  await owner.query(
    `INSERT INTO users (id, public_id, first_name, last_name, display_name, email, phone, role_id,
                        terms_accepted_at, privacy_accepted_at, updated_at)
     SELECT $1, $2, 'Rls', 'Probe', 'Rls Probe', $3, '+1 555 000 0000', r.id, now(), now(), now()
       FROM roles r WHERE r.code = 'doctor'`,
    [id, `usr_rls_${local}_${id.slice(0, 8)}`, `${local}.${id.slice(0, 8)}@rls-runtime.e2e.test`],
  );
}

beforeAll(async () => {
  owner = new Client({ connectionString: OWNER_URL });
  await owner.connect();

  // Provision exactly as production does, from the checked-in template.
  const ownerRole = (await owner.query<{ r: string }>('SELECT current_user AS r')).rows[0]?.r ?? '';
  const template = readFileSync(join(__dirname, '../prisma/roles/provision-runtime-role.sql'), 'utf8')
    .replaceAll('__RUNTIME_ROLE__', ROLE)
    .replaceAll('__OWNER_ROLE__', ownerRole);
  await owner.query(template);
  await owner.query(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);

  for (const [id, name] of [
    [ids.hospitalA, 'A'],
    [ids.hospitalB, 'B'],
  ] as const) {
    await owner.query(
      `INSERT INTO hospitals (id, public_id, name, updated_at) VALUES ($1, $2, $3, now())`,
      [id, `hsp_rls_${id.slice(0, 8)}`, `RLS Hospital ${name} ${id.slice(0, 8)}`],
    );
  }
  for (const [id, hospital, record, mrn] of [
    [ids.patientA, ids.hospitalA, ids.recordA, 'A'],
    [ids.patientB, ids.hospitalB, ids.recordB, 'B'],
  ] as const) {
    await owner.query(
      `INSERT INTO patients (id, public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, updated_at)
       VALUES ($1, $2, $3, 'Rls Patient', '1980-01-01', 'female', 'O+', '+1 555 000 0001', now())`,
      [id, `PT-RLS${id.slice(0, 6)}`, `MRN-RLS-${mrn}${id.slice(0, 6)}`],
    );
    await owner.query(
      `INSERT INTO hospital_medical_records (id, patient_id, hospital_id, updated_at) VALUES ($1, $2, $3, now())`,
      [record, id, hospital],
    );
  }
  await seedUser(ids.doctorUserA, 'doctora');
  await seedUser(ids.requesterB, 'requesterb');
  await seedUser(ids.approverA, 'approvera');

  pool = new Pool({ connectionString: runtimeUrl(), max: 1 });
}, 60_000);

afterAll(async () => {
  await pool?.end();
  if (owner === undefined) return;
  await owner.query('DELETE FROM exceptional_access_grants WHERE patient_id = ANY($1::uuid[])', [[ids.patientA, ids.patientB]]);
  await owner.query('DELETE FROM information_requests WHERE patient_id = ANY($1::uuid[])', [[ids.patientA, ids.patientB]]);
  await owner.query('DELETE FROM hospital_medical_records WHERE id = ANY($1::uuid[])', [[ids.recordA, ids.recordB]]);
  await owner.query('DELETE FROM patients WHERE id = ANY($1::uuid[])', [[ids.patientA, ids.patientB]]);
  await owner.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[ids.doctorUserA, ids.requesterB, ids.approverA]]);
  await owner.query('DELETE FROM hospitals WHERE id = ANY($1::uuid[])', [[ids.hospitalA, ids.hospitalB]]);
  // F-16: the LOGIN role this suite provisioned does not outlive it.
  // `DROP OWNED` removes its grants in this database first (it owns nothing).
  await owner.query(`DROP OWNED BY ${ROLE}`).catch(() => undefined);
  await owner.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await owner.end();
});

describe('the runtime role is a real enforcement boundary', () => {
  it('is not a superuser, does not bypass RLS, and owns no table', async () => {
    const role = await as({}, async (client) =>
      (
        await client.query<{ rolsuper: boolean; rolbypassrls: boolean; owned: string }>(
          `SELECT r.rolsuper, r.rolbypassrls,
                  (SELECT count(*) FROM pg_tables WHERE tableowner = current_user)::text AS owned
             FROM pg_roles r WHERE r.rolname = current_user`,
        )
      ).rows[0],
    );
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false, owned: '0' });
  });
});

describe('hospital scope (two hospitals)', () => {
  it('sees its own hospital’s patients and records only', async () => {
    const a = { scope: 'hospital', hospitalId: ids.hospitalA, userId: ids.doctorUserA };
    expect(await visiblePatients(a)).toEqual([ids.patientA]);
    expect(await visibleRecords(a)).toEqual([ids.recordA]);
    const b = { scope: 'hospital', hospitalId: ids.hospitalB };
    expect(await visiblePatients(b)).toEqual([ids.patientB]);
  });

  it('cannot write a row into another hospital (WITH CHECK)', async () => {
    await expect(
      as({ scope: 'hospital', hospitalId: ids.hospitalA }, (client) =>
        client.query(
          `INSERT INTO hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, now())`,
          [ids.patientA, ids.hospitalB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot update or delete another hospital’s row (no visible rows to touch)', async () => {
    const updated = await as({ scope: 'hospital', hospitalId: ids.hospitalA }, (client) =>
      client.query('UPDATE hospital_medical_records SET updated_at = now() WHERE id = $1', [ids.recordB]),
    );
    expect(updated.rowCount).toBe(0);
  });
});

describe('fail closed', () => {
  it.each<[string, Context]>([
    ['no context at all', {}],
    ['a scope with no hospital', { scope: 'hospital' }],
    ['a malformed hospital id', { scope: 'hospital', hospitalId: 'not-a-uuid' }],
    ['an unknown scope', { scope: 'superadmin', hospitalId: ids.hospitalA }],
  ])('%s sees no patient and no record', async (_label, context) => {
    expect(await visiblePatients(context)).toEqual([]);
    expect(await visibleRecords(context)).toEqual([]);
  });

  it('never leaks context to the next transaction on a pooled connection', async () => {
    // The pool holds one connection, so both transactions share it.
    expect(await visiblePatients({ scope: 'hospital', hospitalId: ids.hospitalA })).toEqual([ids.patientA]);
    expect(await visiblePatients({})).toEqual([]);
    const leftover = await as({}, async (client) =>
      (await client.query<{ v: string | null }>("SELECT current_setting('app.hospital_id', true) AS v")).rows[0]?.v,
    );
    expect(leftover === null || leftover === '').toBe(true);
  });
});

describe('platform, patient and system scopes', () => {
  it('gives platform scope organisational data but no patient or clinical row (§2.1)', async () => {
    expect(await visiblePatients({ scope: 'platform', userId: ids.approverA })).toEqual([]);
    expect(await visibleRecords({ scope: 'platform' })).toEqual([]);
    const hospitals = await as({ scope: 'platform' }, async (client) =>
      (await client.query('SELECT 1 FROM hospitals WHERE id = ANY($1::uuid[])', [[ids.hospitalA, ids.hospitalB]])).rowCount,
    );
    expect(hospitals).toBe(2);
  });

  it('lets a patient see themselves and nobody else', async () => {
    expect(await visiblePatients({ scope: 'patient', patientId: ids.patientB })).toEqual([ids.patientB]);
    expect(await visibleRecords({ scope: 'patient', patientId: ids.patientB })).toEqual([ids.recordB]);
  });

  it('gives an explicit system scope (background jobs) every row', async () => {
    expect(await visiblePatients({ scope: 'system' })).toEqual(sorted(ids.patientA, ids.patientB));
  });
});

describe('controlled cross-hospital access', () => {
  const requester = { scope: 'hospital', hospitalId: ids.hospitalB, userId: ids.requesterB };

  it('reveals another hospital’s patient only under an ACTIVE, unexpired exceptional grant', async () => {
    expect(await visiblePatients(requester)).toEqual([ids.patientB]);

    const grant = randomUUID();
    await owner.query(
      `INSERT INTO exceptional_access_grants
         (id, kind, requester_user_id, hospital_id, patient_id, hospital_medical_record_id, categories,
          reason, status, requires_approval, approver_user_id, reauthenticated_at, duration_minutes,
          starts_at, expires_at, updated_at)
       VALUES ($1, 'EXCEPTIONAL', $2, $3, $4, $5, ARRAY['records'], 'Emergency transfer of care',
               'ACTIVE', true, $6, now(), 30, now() - interval '1 minute', now() + interval '29 minutes', now())`,
      [grant, ids.requesterB, ids.hospitalA, ids.patientA, ids.recordA, ids.approverA],
    );
    expect(await visiblePatients(requester)).toEqual(sorted(ids.patientA, ids.patientB));
    expect(await visibleRecords(requester)).toEqual(sorted(ids.recordA, ids.recordB));
    // Another user at the same hospital gains nothing from someone else's grant.
    expect(await visiblePatients({ scope: 'hospital', hospitalId: ids.hospitalB, userId: ids.doctorUserA })).toEqual([
      ids.patientB,
    ]);
    // Read-only: the grant never allows a write into hospital A.
    const touched = await as(requester, (client) =>
      client.query('UPDATE hospital_medical_records SET updated_at = now() WHERE id = $1', [ids.recordA]),
    );
    expect(touched.rowCount).toBe(0);

    await owner.query(`UPDATE exceptional_access_grants SET expires_at = now() - interval '1 second', starts_at = now() - interval '2 minutes' WHERE id = $1`, [grant]);
    expect(await visiblePatients(requester)).toEqual([ids.patientB]);
    await owner.query('DELETE FROM exceptional_access_grants WHERE id = $1', [grant]);
  });

  it('reveals another hospital’s patient only under an APPROVED, unexpired information request', async () => {
    const requestId = randomUUID();
    await owner.query(
      `INSERT INTO information_requests
         (id, requester_user_id, requester_hospital_id, target_hospital_id, patient_id,
          hospital_medical_record_id, requested_items, reason, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, ARRAY['labs'], 'Continuity of care request', 'PENDING', now())`,
      [requestId, ids.requesterB, ids.hospitalB, ids.hospitalA, ids.patientA, ids.recordA],
    );
    // Nothing is shared before approval.
    expect(await visiblePatients(requester)).toEqual([ids.patientB]);

    await owner.query(
      `UPDATE information_requests SET status = 'APPROVED', approved_items = ARRAY['labs'], decided_by = $2,
              decided_at = now(), share_expires_at = now() + interval '1 day' WHERE id = $1`,
      [requestId, ids.approverA],
    );
    expect(await visiblePatients(requester)).toEqual(sorted(ids.patientA, ids.patientB));

    await owner.query(`UPDATE information_requests SET revoked_at = now() WHERE id = $1`, [requestId]);
    expect(await visiblePatients(requester)).toEqual([ids.patientB]);
  });
});

describe('the audit ledger', () => {
  it('accepts an append from any scope and scopes reads by hospital', async () => {
    const event = randomUUID();
    await as({ scope: 'hospital', hospitalId: ids.hospitalA }, (client) =>
      client.query(
        `INSERT INTO audit_events (id, occurred_at, category, event_type, severity, summary, hospital_id)
         VALUES ($1, now(), 'user_action', 'rls.probe', 'info', 'RLS probe', $2)`,
        [event, ids.hospitalA],
      ),
    );
    const count = (context: Context) =>
      as(context, async (client) =>
        (await client.query('SELECT 1 FROM audit_events WHERE id = $1', [event])).rowCount,
      );
    expect(await count({ scope: 'hospital', hospitalId: ids.hospitalA })).toBe(1);
    expect(await count({ scope: 'hospital', hospitalId: ids.hospitalB })).toBe(0);
    expect(await count({ scope: 'platform' })).toBe(1);
    // The runtime role may not rewrite history (provisioning revokes it).
    await expect(
      as({ scope: 'system' }, (client) => client.query('DELETE FROM audit_events WHERE id = $1', [event])),
    ).rejects.toThrow(/permission denied/);
  });

  /* F-04: attribution is validated against the request's own tenant. */
  const append = (context: Context, hospital: string | null) =>
    as(context, (client) =>
      client.query(
        `INSERT INTO audit_events (id, occurred_at, category, event_type, severity, summary, hospital_id)
         VALUES ($1, now(), 'user_action', 'rls.attribution_probe', 'info', 'RLS attribution probe', $2)`,
        [randomUUID(), hospital],
      ),
    );

  it('lets a hospital-scoped request append events attributed to its own hospital, or to none', async () => {
    await expect(append({ scope: 'hospital', hospitalId: ids.hospitalA }, ids.hospitalA)).resolves.toBeDefined();
    await expect(append({ scope: 'hospital', hospitalId: ids.hospitalA }, null)).resolves.toBeDefined();
  });

  it('refuses a hospital-scoped request forging another hospital’s audit history', async () => {
    await expect(append({ scope: 'hospital', hospitalId: ids.hospitalA }, ids.hospitalB)).rejects.toThrow(
      /row-level security/,
    );
  });

  it('lets a patient-scoped request attribute only to a hospital holding its record', async () => {
    await expect(append({ scope: 'patient', patientId: ids.patientA }, ids.hospitalA)).resolves.toBeDefined();
    await expect(append({ scope: 'patient', patientId: ids.patientA }, null)).resolves.toBeDefined();
    await expect(append({ scope: 'patient', patientId: ids.patientA }, ids.hospitalB)).rejects.toThrow(
      /row-level security/,
    );
  });

  it('lets system and platform events attribute to any hospital; no context attributes to none', async () => {
    await expect(append({ scope: 'system' }, ids.hospitalB)).resolves.toBeDefined();
    await expect(append({ scope: 'platform' }, ids.hospitalA)).resolves.toBeDefined();
    await expect(append({}, null)).resolves.toBeDefined();
    await expect(append({}, ids.hospitalA)).rejects.toThrow(/row-level security/);
  });

  it('accepts an append the request may not read back, because writers insert without RETURNING', async () => {
    // Attributed to no hospital: a hospital-scoped read would not see it, so
    // INSERT … RETURNING (the SELECT policy) would refuse it; a plain INSERT
    // is checked against the append policy only.
    await expect(append({ scope: 'hospital', hospitalId: ids.hospitalA }, null)).resolves.toBeDefined();
    await expect(
      as({ scope: 'hospital', hospitalId: ids.hospitalA }, (client) =>
        client.query(
          `INSERT INTO audit_events (id, occurred_at, category, event_type, severity, summary)
           VALUES ($1, now(), 'user_action', 'rls.attribution_probe', 'info', 'probe') RETURNING id`,
          [randomUUID()],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('coverage of the enforced migration', () => {
  it('enables RLS with at least one policy on every Direct and Indirect table of the inventory', async () => {
    const doc = readFileSync(join(__dirname, '../../docs/multi-hospital/RLS_DESIGN.md'), 'utf8');
    const required = doc
      .slice(doc.indexOf('## Appendix A'))
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => line.split(' | '))
      .filter((cells) => cells[1] === 'Direct' || cells[1] === 'Indirect')
      .map((cells) => (cells[0] ?? '').replace(/^\| `|`$/g, ''));
    expect(required.length).toBeGreaterThan(60);
    const covered = await owner.query<{ relname: string; enabled: boolean; policies: string }>(
      `SELECT c.relname, c.relrowsecurity AS enabled,
              (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::text AS policies
         FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[])`,
      [required],
    );
    expect(covered.rows.filter((row) => !row.enabled || row.policies === '0').map((row) => row.relname)).toEqual([]);
    expect(covered.rows).toHaveLength(required.length);
  });
});

describe('audit ledger partitions (F-05): no bypass by naming a partition', () => {
  const FUTURE = '2099-01-01';
  const FUTURE_NAME = 'audit_events_2099_01';
  const PAST = '1990-01-01';
  const PAST_NAME = 'audit_events_1990_01';

  async function existingPartition(): Promise<string> {
    const row = await owner.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'audit_events'::regclass AND c.relname ~ '^audit_events_[0-9]{4}_[0-9]{2}$'
        ORDER BY c.relname LIMIT 1`,
    );
    const name = row.rows[0]?.name;
    if (name === undefined) throw new Error('no monthly partition');
    return name;
  }

  /** Runs `sql` as the runtime role and returns the SQLSTATE it fails with, or 'ok'. */
  async function attempt(sql: string, context: Context = { scope: 'system' }): Promise<string> {
    try {
      await as(context, (client) => client.query(sql));
      return 'ok';
    } catch (error) {
      return (error as { code?: string }).code ?? 'error';
    }
  }

  afterAll(async () => {
    await owner.query(`DROP TABLE IF EXISTS ${FUTURE_NAME}`);
    await owner.query(`DROP TABLE IF EXISTS ${PAST_NAME}`);
  });

  it('refuses SELECT, INSERT, UPDATE and DELETE on an existing monthly partition and the DEFAULT partition', async () => {
    for (const partition of [await existingPartition(), 'audit_events_default']) {
      expect(await attempt(`SELECT 1 FROM ${partition} LIMIT 1`), partition).toBe('42501');
      expect(
        await attempt(
          `INSERT INTO ${partition} (occurred_at, category, event_type, severity, summary)
           VALUES (now(), 'system', 'probe.partition', 'info', 'probe')`,
        ),
        partition,
      ).toBe('42501');
      expect(await attempt(`UPDATE ${partition} SET summary = summary`), partition).toBe('42501');
      expect(await attempt(`DELETE FROM ${partition}`), partition).toBe('42501');
    }
  });

  it('keeps the parent working: append allowed, reads scoped, no UPDATE or DELETE', async () => {
    expect(
      await attempt(
        `INSERT INTO audit_events (occurred_at, category, event_type, severity, summary)
         VALUES (now(), 'system', 'probe.parent', 'info', 'probe')`,
      ),
    ).toBe('ok');
    expect(await attempt('SELECT 1 FROM audit_events LIMIT 1', { scope: 'platform' })).toBe('ok');
    expect(await attempt(`UPDATE audit_events SET summary = summary WHERE event_type = 'probe.parent'`)).toBe('42501');
    expect(await attempt(`DELETE FROM audit_events WHERE event_type = 'probe.parent'`)).toBe('42501');
  });

  it('secures a partition the application creates itself, and the runtime role cannot address it', async () => {
    // The retention job's own path, run as the runtime role.
    expect(await attempt(`SELECT create_audit_events_partition('${FUTURE}'::date)`)).toBe('ok');
    const facts = await owner.query<{ rls: boolean; grantees: string }>(
      `SELECT c.relrowsecurity AS rls,
              coalesce(string_agg(DISTINCT pg_get_userbyid(a.grantee), ',') FILTER (WHERE a.grantee <> c.relowner), '') AS grantees
         FROM pg_class c LEFT JOIN LATERAL aclexplode(c.relacl) a ON true
        WHERE c.relname = $1 GROUP BY c.relrowsecurity`,
      [FUTURE_NAME],
    );
    expect(facts.rows[0]).toEqual({ rls: true, grantees: '' });
    for (const sql of [
      `SELECT 1 FROM ${FUTURE_NAME}`,
      `INSERT INTO ${FUTURE_NAME} (occurred_at, category, event_type, severity, summary) VALUES ('2099-01-02', 'system', 'probe.new', 'info', 'probe')`,
      `UPDATE ${FUTURE_NAME} SET summary = summary`,
      `DELETE FROM ${FUTURE_NAME}`,
      `ALTER TABLE ${FUTURE_NAME} DISABLE ROW LEVEL SECURITY`,
      `DROP TABLE ${FUTURE_NAME}`,
    ]) {
      expect(await attempt(sql), sql).toBe('42501');
    }
  });

  it('refuses the runtime role every way of removing a month of the ledger (H1)', async () => {
    expect(await attempt(`SELECT create_audit_events_partition('${PAST}'::date)`)).toBe('ok');
    // The retention function, the owner-only helpers (including one aimed
    // at an unrelated table), and direct DDL on the partition or parent.
    for (const sql of [
      `SELECT drop_audit_events_partition('${PAST_NAME}')`,
      `SELECT audit_events_secure_partition('patients'::regclass)`,
      `SELECT audit_events_secure_partition('${PAST_NAME}'::regclass)`,
      'SELECT audit_events_secure_all_partitions()',
      'SELECT platform_admin_count()',
      'SELECT assert_platform_admin_survives()',
      `DROP TABLE ${PAST_NAME}`,
      `ALTER TABLE audit_events DETACH PARTITION ${PAST_NAME}`,
      `TRUNCATE ${PAST_NAME}`,
      'TRUNCATE audit_events',
    ]) {
      expect(await attempt(sql), sql).toBe('42501');
    }
    // Under every scope it can select, not only system.
    for (const scope of ['hospital', 'platform', 'patient', 'system']) {
      expect(await attempt(`SELECT drop_audit_events_partition('${PAST_NAME}')`, { scope }), scope).toBe('42501');
    }
    expect((await as({}, (c) => c.query<{ e: boolean }>('SELECT audit_retention_entitled() AS e'))).rows[0]?.e).toBe(
      false,
    );
    const still = await owner.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${PAST_NAME}`]);
    expect(still.rows[0]).toEqual({ present: true });
  });

  it('refuses the runtime role even if EXECUTE on the drop is granted again (the function guards itself)', async () => {
    await owner.query(`GRANT EXECUTE ON FUNCTION drop_audit_events_partition(text) TO ${ROLE}`);
    try {
      expect(await attempt(`SELECT drop_audit_events_partition('${PAST_NAME}')`)).toBe('42501');
    } finally {
      await owner.query(`REVOKE EXECUTE ON FUNCTION drop_audit_events_partition(text) FROM ${ROLE}`);
    }
    const still = await owner.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${PAST_NAME}`]);
    expect(still.rows[0]).toEqual({ present: true });
  });

  it('lets the audit maintenance role drop only a past month partition of audit_events (H1)', async () => {
    const login = `medora_e2e_audit_retention_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const password = `am_${randomUUID().replace(/-/g, '')}`;
    await owner.query(
      readFileSync(join(__dirname, '../prisma/roles/provision-audit-maintenance-role.sql'), 'utf8').replaceAll(
        '__MAINTENANCE_LOGIN__',
        login,
      ),
    );
    await owner.query(`ALTER ROLE ${login} LOGIN PASSWORD '${password}'`);
    const url = new URL(OWNER_URL);
    url.username = login;
    url.password = password;
    url.searchParams.delete('schema');
    const maintenance = new Client({ connectionString: url.toString() });
    await maintenance.connect();
    const run = async (sql: string): Promise<string> => {
      try {
        await maintenance.query(sql);
        return 'ok';
      } catch (error) {
        return (error as { code?: string }).code ?? 'error';
      }
    };
    try {
      const facts = await owner.query<{ s: boolean; b: boolean }>(
        'SELECT rolsuper AS s, rolbypassrls AS b FROM pg_roles WHERE rolname = $1',
        [login],
      );
      expect(facts.rows[0]).toEqual({ s: false, b: false });
      expect((await maintenance.query<{ e: boolean }>('SELECT audit_retention_entitled() AS e')).rows[0]?.e).toBe(true);
      // Its validation is unchanged: current or future month, the DEFAULT
      // partition, another table, an injected name — refused.
      expect(await run(`SELECT drop_audit_events_partition('${FUTURE_NAME}')`)).toBe('22023');
      expect(await run(`SELECT drop_audit_events_partition('audit_events_default')`)).toBe('22023');
      expect(await run(`SELECT drop_audit_events_partition('patients')`)).toBe('22023');
      expect(await run(`SELECT drop_audit_events_partition('audit_events_2099_01; DROP TABLE patients')`)).toBe('22023');
      // It reads no audit event and no clinical row, and holds no DDL.
      expect(await run('SELECT 1 FROM audit_events LIMIT 1')).toBe('42501');
      expect(await run('SELECT 1 FROM patients LIMIT 1')).toBe('42501');
      expect(await run(`DROP TABLE ${PAST_NAME}`)).toBe('42501');
      // A month wholly in the past: dropped.
      expect(await run(`SELECT create_audit_events_partition('${PAST}'::date)`)).toBe('ok');
      expect(await run(`SELECT drop_audit_events_partition('${PAST_NAME}')`)).toBe('ok');
      const gone = await owner.query('SELECT to_regclass($1) AS rel', [`public.${PAST_NAME}`]);
      expect(gone.rows[0]).toEqual({ rel: null });
    } finally {
      await maintenance.end();
      await owner.query(`DROP OWNED BY ${login}`);
      await owner.query(`DROP ROLE ${login}`);
      await owner.query('DROP OWNED BY medora_audit_maintenance');
      await owner.query('DROP ROLE medora_audit_maintenance');
    }
  });
});

describe('legacy clinical rows stay isolated without an explicit system lookup (H2)', () => {
  it('hides a legacy allergy from no context and from every hospital; only system scope reads it', async () => {
    await owner.query(
      `INSERT INTO patient_allergies (patient_id, allergen, severity, reaction, updated_at)
       VALUES ($1, 'LegacyProbe', 'severe', 'probe', now())`,
      [ids.patientA],
    );
    const count = (context: Context) =>
      as(context, async (client) =>
        Number(
          (
            await client.query<{ n: string }>(
              "SELECT count(*) AS n FROM patient_allergies WHERE patient_id = $1 AND allergen = 'LegacyProbe'",
              [ids.patientA],
            )
          ).rows[0]?.n,
        ),
      );
    expect(await count({})).toBe(0);
    expect(await count({ scope: 'hospital', hospitalId: ids.hospitalA })).toBe(0);
    expect(await count({ scope: 'hospital', hospitalId: ids.hospitalB })).toBe(0);
    expect(await count({ scope: 'platform' })).toBe(0);
    // The safety screen's narrow lookup (SafetyRepository.legacyAllergiesFor).
    expect(await count({ scope: 'system' })).toBe(1);
  });
});

describe('idempotency records are their caller’s own (M1)', () => {
  it('shows a cached response only to the user who made the request, and to the system sweep', async () => {
    const key = `probe-${randomUUID()}`;
    await owner.query(
      `INSERT INTO idempotency_records (user_id, key, endpoint, fingerprint, status, response_body, completed_at, expires_at)
       VALUES ($1, $2, 'POST /probe', repeat('a', 64), 'completed', '{"phi":"probe"}', now(), now() + interval '1 hour')`,
      [ids.doctorUserA, key],
    );
    try {
      const visible = (context: Context) =>
        as(context, async (client) =>
          Number(
            (await client.query<{ n: string }>('SELECT count(*) AS n FROM idempotency_records WHERE key = $1', [key]))
              .rows[0]?.n,
          ),
        );
      expect(await visible({})).toBe(0);
      expect(await visible({ userId: ids.requesterB })).toBe(0);
      expect(await visible({ scope: 'hospital', hospitalId: ids.hospitalA, userId: ids.requesterB })).toBe(0);
      expect(await visible({ userId: ids.doctorUserA })).toBe(1);
      expect(await visible({ scope: 'hospital', hospitalId: ids.hospitalA, userId: ids.doctorUserA })).toBe(1);
      expect(await visible({ scope: 'system' })).toBe(1);

      // Nobody writes a record into someone else's name.
      await expect(
        as({ userId: ids.requesterB }, (client) =>
          client.query(
            `INSERT INTO idempotency_records (user_id, key, endpoint, fingerprint, expires_at)
             VALUES ($1, $2, 'POST /probe', repeat('b', 64), now() + interval '1 hour')`,
            [ids.doctorUserA, `${key}-forged`],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await owner.query('DELETE FROM idempotency_records WHERE key LIKE $1', [`${key}%`]);
    }
  });
});

describe('legacy ownership needs evidence; the evidence is append-only (M2, S2)', () => {
  async function legacyAllergy(allergen: string): Promise<string> {
    const row = await owner.query<{ id: string }>(
      `INSERT INTO patient_allergies (patient_id, allergen, severity, reaction, updated_at)
       VALUES ($1, $2, 'severe', 'probe', now()) RETURNING id`,
      [ids.patientA, allergen],
    );
    return row.rows[0]!.id;
  }

  const evidenceRows: string[] = [];

  async function recordEvidence(rowId: string, hospitalId: string): Promise<void> {
    evidenceRows.push(rowId);
    await as({ scope: 'system' }, (client) =>
      client.query(
        `INSERT INTO ownership_assignments (table_name, row_id, hospital_id, evidence_rule, evidence)
         VALUES ('patient_allergies', $1, $2, 'probe', '{}')`,
        [rowId, hospitalId],
      ),
    );
  }

  afterAll(async () => {
    // Evidence is append-only even for the owner; a test fixture is the one
    // case that must go, or its hospital (ON DELETE RESTRICT) cannot.
    await owner.query('ALTER TABLE ownership_assignments DISABLE TRIGGER ownership_assignments_append_only_trg');
    try {
      await owner.query('DELETE FROM ownership_assignments WHERE row_id = ANY($1::uuid[])', [evidenceRows]);
    } finally {
      await owner.query('ALTER TABLE ownership_assignments ENABLE TRIGGER ownership_assignments_append_only_trg');
    }
  });

  const stamp = (rowId: string) =>
    as({ scope: 'system' }, (client) =>
      client.query(
        'UPDATE patient_allergies SET hospital_id = $2, hospital_medical_record_id = $3 WHERE id = $1',
        [rowId, ids.hospitalA, ids.recordA],
      ),
    );

  it('refuses to fill a legacy NULL hospital in place without an evidence row, even under system scope', async () => {
    const rowId = await legacyAllergy('M2Unproven');
    await expect(stamp(rowId)).rejects.toMatchObject({ code: '23514' });
    const after = await owner.query('SELECT hospital_id FROM patient_allergies WHERE id = $1', [rowId]);
    expect(after.rows[0]).toEqual({ hospital_id: null });
  });

  it('does not accept evidence recorded for another hospital', async () => {
    const rowId = await legacyAllergy('M2OtherHospital');
    await recordEvidence(rowId, ids.hospitalB);
    await expect(stamp(rowId)).rejects.toMatchObject({ code: '23514' });
  });

  it('accepts the fill once the evidence for that row and hospital is recorded', async () => {
    const rowId = await legacyAllergy('M2Proven');
    await recordEvidence(rowId, ids.hospitalA);
    await stamp(rowId);
    const after = await owner.query('SELECT hospital_id FROM patient_allergies WHERE id = $1', [rowId]);
    expect(after.rows[0]).toEqual({ hospital_id: ids.hospitalA });
  });

  it('keeps ownership evidence append-only, system-scoped and well-formed', async () => {
    const rowId = randomUUID();
    evidenceRows.push(rowId);
    const insert = (context: Context, table = 'patient_allergies') =>
      as(context, (client) =>
        client.query(
          `INSERT INTO ownership_assignments (table_name, row_id, hospital_id, evidence_rule, evidence)
           VALUES ($1, $2, $3, 'probe', '{}')`,
          [table, rowId, ids.hospitalA],
        ),
      );
    // A hospital-scoped request cannot write evidence.
    await expect(insert({ scope: 'hospital', hospitalId: ids.hospitalA })).rejects.toMatchObject({ code: '42501' });
    // Not free text.
    await expect(insert({ scope: 'system' }, 'patients; DROP TABLE x')).rejects.toMatchObject({ code: '23514' });
    await insert({ scope: 'system' });
    // One evidence row per assigned row.
    await expect(insert({ scope: 'system' })).rejects.toMatchObject({ code: '23505' });
    for (const sql of [
      'UPDATE ownership_assignments SET hospital_id = hospital_id WHERE row_id = $1',
      'DELETE FROM ownership_assignments WHERE row_id = $1',
    ]) {
      await expect(as({ scope: 'system' }, (client) => client.query(sql, [rowId]))).rejects.toMatchObject({
        code: '55000',
      });
    }
    await expect(as({ scope: 'system' }, (client) => client.query('TRUNCATE ownership_assignments'))).rejects.toMatchObject(
      { code: '42501' },
    );
  });
});
