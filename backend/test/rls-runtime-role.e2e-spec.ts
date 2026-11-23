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
