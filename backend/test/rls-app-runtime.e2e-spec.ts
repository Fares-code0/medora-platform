/**
 * The application itself under Row-Level Security (multi-hospital §2.15,
 * fix-list items 19–22): the real Nest app, connected as the provisioned
 * runtime role (NOSUPERUSER, NOBYPASSRLS, not the owner), with
 * `DATABASE_TENANT_CONTEXT` on.
 *
 * Proves the application layer end to end: authorization lookups run under
 * `system` scope, the request's tenant context reaches every transaction,
 * reads and writes at the doctor's hospital work, and another hospital's
 * patient is unreachable. Fixture rows are written through a separate owner
 * connection (RLS does not bind the owner, by design).
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  registrationBody,
  testEmail,
} from './support/auth-app';

const ROLE = 'medora_app_runtime_e2e';
const PASSWORD = `rt_${randomUUID().replace(/-/g, '')}`;
const USER_PASSWORD = 'Medora123!';

let owner: Client;
let harness: AuthHarness;
let token = '';
const ids = {
  hospitalA: randomUUID(),
  hospitalB: randomUUID(),
  patientA: randomUUID(),
  patientB: randomUUID(),
};
const publicIds = { patientA: `PT-RA${ids.patientA.slice(0, 6)}`, patientB: `PT-RB${ids.patientB.slice(0, 6)}` };
const created: string[] = [];

function runtimeUrl(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = ROLE;
  url.password = PASSWORD;
  return url.toString();
}

const as = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const ownerUrl = process.env['DATABASE_URL'] ?? '';
  owner = new Client({ connectionString: ownerUrl.replace(/\?.*$/, '') });
  await owner.connect();
  const ownerRole = (await owner.query<{ r: string }>('SELECT current_user AS r')).rows[0]?.r ?? '';
  await owner.query(
    readFileSync(join(__dirname, '../prisma/roles/provision-runtime-role.sql'), 'utf8')
      .replaceAll('__RUNTIME_ROLE__', ROLE)
      .replaceAll('__OWNER_ROLE__', ownerRole),
  );
  await owner.query(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);

  for (const [id, name] of [
    [ids.hospitalA, 'A'],
    [ids.hospitalB, 'B'],
  ] as const) {
    await owner.query('INSERT INTO hospitals (id, public_id, name, updated_at) VALUES ($1, $2, $3, now())', [
      id,
      `hsp_rlsapp_${id.slice(0, 8)}`,
      `RLS App Hospital ${name} ${id.slice(0, 8)}`,
    ]);
  }
  for (const [id, publicId, hospital] of [
    [ids.patientA, publicIds.patientA, ids.hospitalA],
    [ids.patientB, publicIds.patientB, ids.hospitalB],
  ] as const) {
    await owner.query(
      `INSERT INTO patients (id, public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, updated_at)
       VALUES ($1, $2, $3, 'RLS App Patient', '1985-05-05', 'female', 'A+', '+1 555 000 0002', now())`,
      [id, publicId, `MRN-RA-${id.slice(0, 8)}`],
    );
    await owner.query('INSERT INTO hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, now())', [
      id,
      hospital,
    ]);
  }

  // The application connects as the runtime role, with tenant context on.
  const saved = { url: process.env['DATABASE_URL'], context: process.env['DATABASE_TENANT_CONTEXT'] };
  process.env['DATABASE_URL'] = runtimeUrl(ownerUrl);
  process.env['DATABASE_TENANT_CONTEXT'] = 'true';
  try {
    harness = await createAuthHarness('rls-app-runtime');
  } finally {
    process.env['DATABASE_URL'] = saved.url;
    if (saved.context === undefined) delete process.env['DATABASE_TENANT_CONTEXT'];
    else process.env['DATABASE_TENANT_CONTEXT'] = saved.context;
  }

  // A doctor, registered through the API, then put in clinical standing at
  // hospital A by the owner (staffing is an administrative act).
  const email = testEmail('rls-doctor');
  expect((await request(harness.server).post('/api/v1/auth/register').send(registrationBody({ email }))).status).toBe(
    201,
  );
  await owner.query('UPDATE users SET email_verified_at = now() WHERE email = $1', [email]);
  await owner.query(
    `UPDATE doctors SET verification_status = 'verified', practice_status = 'active'
      WHERE user_id = (SELECT id FROM users WHERE email = $1)`,
    [email],
  );
  await owner.query(
    `INSERT INTO doctor_employments (doctor_id, hospital_id, updated_at)
     SELECT d.id, $2, now() FROM doctors d JOIN users u ON u.id = d.user_id WHERE u.email = $1`,
    [email, ids.hospitalA],
  );
  const login = await request(harness.server)
    .post('/api/v1/auth/login')
    .send({ email, password: USER_PASSWORD, rememberMe: false });
  expect(login.status, JSON.stringify(login.body)).toBe(200);
  token = dataOf<{ accessToken: string }>(login).accessToken;
}, 120_000);

afterAll(async () => {
  await harness?.close();
  if (owner === undefined) return;
  const patients = [ids.patientA, ids.patientB, ...created];
  const domain = testEmail('x').slice(1);
  await owner.query('DELETE FROM patient_doctor_assignments WHERE patient_id = ANY($1::uuid[])', [patients]);
  await owner.query('DELETE FROM patient_allergies WHERE patient_id = ANY($1::uuid[])', [patients]);
  await owner.query('DELETE FROM hospital_medical_records WHERE patient_id = ANY($1::uuid[])', [patients]);
  await owner.query('DELETE FROM patients WHERE id = ANY($1::uuid[])', [patients]);
  await owner.query(
    `DELETE FROM doctor_employments WHERE doctor_id IN
       (SELECT d.id FROM doctors d JOIN users u ON u.id = d.user_id WHERE u.email LIKE '%' || $1)`,
    [domain],
  );
  await owner.query(`DELETE FROM users WHERE email LIKE '%' || $1`, [domain]);
  await owner.query('DELETE FROM hospitals WHERE id = ANY($1::uuid[])', [[ids.hospitalA, ids.hospitalB]]);
  await owner.end();
});

describe('the application connected as the runtime role', () => {
  it('runs as a role that RLS binds', async () => {
    const [facts] = await harness.prisma.$queryRawUnsafe<{ superuser: boolean; bypass: boolean }[]>(
      'SELECT rolsuper AS superuser, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user',
    );
    expect(facts).toEqual({ superuser: false, bypass: false });
  });

  it('reads its own hospital’s patient under the request’s tenant context', async () => {
    const response = await request(harness.server).get(`/api/v1/patients/${publicIds.patientA}`).set(as());
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  });

  it('cannot reach another hospital’s patient', async () => {
    const response = await request(harness.server).get(`/api/v1/patients/${publicIds.patientB}`).set(as());
    expect(response.status).toBe(404);
  });

  it('writes under the tenant context: registering a patient opens its record at the doctor’s hospital', async () => {
    const response = await request(harness.server)
      .post('/api/v1/patients')
      .set(as())
      .send({
        fullName: 'RLS Registered Patient',
        dateOfBirth: '1991-09-09',
        gender: 'male',
        bloodType: 'O+',
        phone: '+20 100 555 0199',
        allergies: [{ allergen: 'Latex', severity: 'mild', reaction: 'Rash' }],
        chronicConditions: [],
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const publicId = dataOf<{ id: string }>(response).id;
    const row = await owner.query<{ id: string; hospital_id: string }>(
      `SELECT p.id, h.hospital_id FROM patients p JOIN hospital_medical_records h ON h.patient_id = p.id
        WHERE p.public_id = $1`,
      [publicId],
    );
    created.push(row.rows[0]?.id ?? '');
    expect(row.rows.map((r) => r.hospital_id)).toEqual([ids.hospitalA]);
  });

  it('has no tenant context outside a request: the runtime role sees no patient', async () => {
    const rows = await harness.prisma.$queryRawUnsafe<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM patients WHERE id = ANY($1::uuid[])',
      [ids.patientA, ids.patientB],
    );
    expect(rows[0]?.n).toBe(0);
  });
});
