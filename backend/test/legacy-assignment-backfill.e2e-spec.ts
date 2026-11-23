/**
 * S2 — evidence-based legacy ownership backfill for patient_doctor_assignments
 * (prisma/backfill/legacy-assignment-ownership.ts,
 * docs/multi-hospital/LEGACY_OWNERSHIP_BACKFILL.md).
 *
 * Runs in a throwaway database of its own (test/support/isolated-database.ts),
 * migrated and seeded like medora_test: `--apply` writes rows, and the shared
 * medora_test must never be backfilled by a test.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AssignmentFacts,
  type BackfillReport,
  type Classification,
  classifyAssignment,
  runLegacyAssignmentBackfill,
} from '../prisma/backfill/legacy-assignment-ownership';
import { createIsolatedDatabase, type IsolatedDatabase } from './support/isolated-database';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
let databaseUrl: URL;
try {
  databaseUrl = new URL(rawDatabaseUrl);
} catch {
  throw new Error('Legacy backfill tests require the disposable medora_test DATABASE_URL.');
}
const inCi = process.env['CI'] === 'true';
const expectedPort = inCi ? '5432' : '5433';
if (!inCi && process.env['MEDORA_PHASE21_DISPOSABLE_DB'] !== '1') {
  throw new Error(
    'Refusing legacy backfill tests outside CI without explicit disposable-database opt-in.',
  );
}
if (
  databaseUrl.pathname !== '/medora_test' ||
  !['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) ||
  databaseUrl.username !== 'medora' ||
  (databaseUrl.port || '5432') !== expectedPort ||
  process.env['APP_ENV'] !== 'test'
) {
  throw new Error(
    'Refusing legacy backfill tests: expected the disposable loopback medora_test database as medora.',
  );
}

const execFileAsync = promisify(execFile);
const BACKEND = resolve(__dirname, '..');
const CLI = 'prisma/backfill/run-legacy-assignment-ownership.ts';

let isolated: IsolatedDatabase | undefined;
let client: Client;
let connected = false;

const suffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

async function one<T>(sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query(sql, values);
  const row = result.rows[0] as T | undefined;
  if (row === undefined) throw new Error(`Expected a row from: ${sql}`);
  return row;
}

async function hospital(name: string): Promise<string> {
  return (
    await one<{ id: string }>(
      'INSERT INTO public.hospitals (public_id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
      ['hsp_' + randomUUID(), name],
    )
  ).id;
}

async function doctor(): Promise<string> {
  const s = suffix();
  const roleId = (await one<{ id: string }>("SELECT id FROM public.roles WHERE code = 'doctor'"))
    .id;
  const userId = (
    await one<{ id: string }>(
      'INSERT INTO public.users (public_id, first_name, last_name, display_name, email, phone, role_id, terms_accepted_at, privacy_accepted_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id',
      [
        'usr_lbf' + s,
        'Backfill',
        'Doctor',
        'Backfill Doctor',
        `lbf-${s}@example.test`,
        '5550101',
        roleId,
      ],
    )
  ).id;
  return (
    await one<{ id: string }>(
      'INSERT INTO public.doctors (user_id, full_name, specialty, license_number, contact_email, contact_phone, updated_at) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) RETURNING id',
      [
        userId,
        'Backfill Doctor',
        'General Medicine',
        'lic_lbf_' + s,
        `d-${s}@example.test`,
        '5550101',
      ],
    )
  ).id;
}

async function patient(): Promise<string> {
  const s = suffix();
  return (
    await one<{ id: string }>(
      "INSERT INTO public.patients (public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, updated_at) VALUES ($1, $2, 'Backfill Patient', DATE '1990-01-01', 'female', 'O+', '5550100', CURRENT_TIMESTAMP) RETURNING id",
      ['PT-L' + s, 'lbf_' + s],
    )
  ).id;
}

async function employ(
  doctorId: string,
  hospitalId: string,
  startedAt: string,
  endedAt: string | null = null,
): Promise<string> {
  return (
    await one<{ id: string }>(
      'INSERT INTO public.doctor_employments (doctor_id, hospital_id, started_at, ended_at, updated_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id',
      [doctorId, hospitalId, startedAt, endedAt],
    )
  ).id;
}

async function record(patientId: string, hospitalId: string): Promise<string> {
  return (
    await one<{ id: string }>(
      'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
      [patientId, hospitalId],
    )
  ).id;
}

async function assign(
  patientId: string,
  doctorId: string,
  assignedAt: string,
  revokedAt: string | null = null,
): Promise<string> {
  return (
    await one<{ id: string }>(
      "INSERT INTO public.patient_doctor_assignments (patient_id, doctor_id, role, assigned_at, revoked_at) VALUES ($1, $2, 'consulting', $3, $4) RETURNING id",
      [patientId, doctorId, assignedAt, revokedAt],
    )
  ).id;
}

/** Every column of every assignment, as text, keyed by id. */
async function snapshot(): Promise<Map<string, string>> {
  const result = await client.query<{ id: string; row: string }>(
    'SELECT id, to_jsonb(a)::text AS row FROM public.patient_doctor_assignments a ORDER BY id',
  );
  return new Map(result.rows.map((r) => [r.id, r.row]));
}

interface Scope {
  hospital_id: string | null;
  doctor_employment_id: string | null;
  hospital_medical_record_id: string | null;
}

async function scopeOf(id: string): Promise<Scope> {
  return one<Scope>(
    'SELECT hospital_id, doctor_employment_id, hospital_medical_record_id FROM public.patient_doctor_assignments WHERE id = $1',
    [id],
  );
}

function rowOf(report: BackfillReport, id: string) {
  const row = report.rows.find((r) => r.assignmentId === id);
  if (row === undefined) throw new Error(`Assignment ${id} missing from the report`);
  return row;
}

/** The fixture world: one assignment per rule. */
interface World {
  hospitalA: string;
  hospitalB: string;
  employmentProven: string;
  recordProvenAtA: string;
  recordBoundaryAtA: string;
  expected: Record<string, Classification>;
  proven: string;
  boundary: string;
  revoked: string;
}
let w: World;

beforeAll(async () => {
  isolated = await createIsolatedDatabase(rawDatabaseUrl, 'legacybf');
  client = new Client({ connectionString: isolated.url });
  await client.connect();
  connected = true;
  const identity = await one<{ db: string; version: string }>(
    "SELECT current_database() AS db, current_setting('server_version_num') AS version",
  );
  if (identity.db !== isolated.name || !identity.version.startsWith('16')) {
    throw new Error(
      'Refusing legacy backfill tests: expected the isolated PostgreSQL 16 database.',
    );
  }

  const hospitalA = await hospital('Backfill Hospital A');
  const hospitalB = await hospital('Backfill Hospital B');

  // proven: one active employment at A covers assigned_at; the patient has
  // records at A and B, and the record at A (the employment's hospital) wins.
  const dProven = await doctor();
  const employmentProven = await employ(dProven, hospitalA, '2026-01-01T00:00:00Z');
  const pProven = await patient();
  const recordProvenAtA = await record(pProven, hospitalA);
  await record(pProven, hospitalB);
  const proven = await assign(pProven, dProven, '2026-06-01T00:00:00Z');

  // proven at the inclusive boundary: assigned_at = started_at.
  const pBoundary = await patient();
  const recordBoundaryAtA = await record(pBoundary, hospitalA);
  const boundary = await assign(pBoundary, dProven, '2026-01-01T00:00:00Z');

  // revoked: the same evidence would prove it, but revoked rows are out of scope.
  const pRevoked = await patient();
  await record(pRevoked, hospitalA);
  const revoked = await assign(pRevoked, dProven, '2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z');

  // no_employment (a): the doctor has never been employed.
  const dNone = await doctor();
  const pNone = await patient();
  await record(pNone, hospitalA);
  const noEmploymentAtAll = await assign(pNone, dNone, '2026-06-01T00:00:00Z');

  // no_employment (b): the only employment starts after assigned_at.
  const dLater = await doctor();
  await employ(dLater, hospitalA, '2026-07-01T00:00:00Z');
  const pLater = await patient();
  await record(pLater, hospitalA);
  const beforeEmployment = await assign(pLater, dLater, '2026-06-01T00:00:00Z');

  // no_employment (c): half-open interval — an employment ending exactly at
  // assigned_at does not cover it.
  const dEdge = await doctor();
  await employ(dEdge, hospitalA, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z');
  const pEdge = await patient();
  await record(pEdge, hospitalA);
  const atEndInstant = await assign(pEdge, dEdge, '2026-06-01T00:00:00Z');

  // ambiguous_employment: two (ended) employments at A and B both cover it.
  const dTwo = await doctor();
  await employ(dTwo, hospitalA, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z');
  await employ(dTwo, hospitalB, '2026-03-01T00:00:00Z', '2026-09-01T00:00:00Z');
  const pTwo = await patient();
  await record(pTwo, hospitalA);
  await record(pTwo, hospitalB);
  const ambiguous = await assign(pTwo, dTwo, '2026-04-01T00:00:00Z');

  // employment_ended: the covering employment at A ended; the doctor now
  // works at B; the assignment is still live.
  const dMoved = await doctor();
  await employ(dMoved, hospitalA, '2026-01-01T00:00:00Z', '2026-06-01T00:00:00Z');
  await employ(dMoved, hospitalB, '2026-07-01T00:00:00Z');
  const pMoved = await patient();
  await record(pMoved, hospitalA);
  await record(pMoved, hospitalB);
  const ended = await assign(pMoved, dMoved, '2026-03-01T00:00:00Z');

  // no_hospital_record: employed at A, but the patient's only record is at B.
  const dNoRecord = await doctor();
  await employ(dNoRecord, hospitalA, '2026-01-01T00:00:00Z');
  const pNoRecord = await patient();
  await record(pNoRecord, hospitalB);
  const noRecord = await assign(pNoRecord, dNoRecord, '2026-06-01T00:00:00Z');

  w = {
    hospitalA,
    hospitalB,
    employmentProven,
    recordProvenAtA,
    recordBoundaryAtA,
    proven,
    boundary,
    revoked,
    expected: {
      [proven]: 'proven',
      [boundary]: 'proven',
      [revoked]: 'revoked',
      [noEmploymentAtAll]: 'no_employment',
      [beforeEmployment]: 'no_employment',
      [atEndInstant]: 'no_employment',
      [ambiguous]: 'ambiguous_employment',
      [ended]: 'employment_ended',
      [noRecord]: 'no_hospital_record',
    },
  };
}, 180_000);

afterAll(async () => {
  if (connected) await client.end();
  await isolated?.drop();
}, 30_000);

describe('classifyAssignment (pure rule)', () => {
  const base: AssignmentFacts = {
    assignmentId: 'a',
    patientId: 'p',
    doctorId: 'd',
    role: 'consulting',
    assignedAt: new Date('2026-06-01T00:00:00Z'),
    revokedAt: null,
    coveringEmploymentCount: 1,
    employmentId: 'e',
    employmentHospitalId: 'h',
    employmentEndedAt: null,
    hospitalRecordCount: 1,
    hospitalMedicalRecordId: 'r',
  };

  it('applies the rules in order', () => {
    expect(classifyAssignment(base)).toBe('proven');
    expect(classifyAssignment({ ...base, revokedAt: new Date() })).toBe('revoked');
    expect(classifyAssignment({ ...base, coveringEmploymentCount: 0 })).toBe('no_employment');
    expect(classifyAssignment({ ...base, coveringEmploymentCount: 2 })).toBe(
      'ambiguous_employment',
    );
    expect(classifyAssignment({ ...base, employmentEndedAt: new Date() })).toBe('employment_ended');
    expect(classifyAssignment({ ...base, hospitalRecordCount: 0 })).toBe('no_hospital_record');
    expect(classifyAssignment({ ...base, hospitalRecordCount: 2 })).toBe(
      'ambiguous_hospital_record',
    );
  });

  it('ambiguous_hospital_record is unreachable in data: one record per patient and hospital', async () => {
    const p = await patient();
    await record(p, w.hospitalA);
    await expect(record(p, w.hospitalA)).rejects.toMatchObject({
      code: '23505',
      constraint: 'hospital_medical_records_patient_hospital_key',
    });
  });
});

describe('legacy assignment ownership backfill', () => {
  let beforeAny: Map<string, string>;
  let afterApply: Map<string, string>;

  it('dry run classifies every rule and writes nothing', async () => {
    beforeAny = await snapshot();
    const report = await runLegacyAssignmentBackfill(client, { apply: false, appEnv: 'test' });

    expect(report.mode).toBe('dry-run');
    expect(report.database).toBe(isolated?.name);
    expect(report.rowsUpdated).toBe(0);
    for (const [id, classification] of Object.entries(w.expected)) {
      expect(rowOf(report, id).classification, id).toBe(classification);
    }
    const proven = rowOf(report, w.proven);
    expect(proven).toMatchObject({
      hospitalId: w.hospitalA,
      doctorEmploymentId: w.employmentProven,
      hospitalMedicalRecordId: w.recordProvenAtA,
    });
    for (const row of report.rows.filter((r) => r.classification !== 'proven')) {
      expect(row.hospitalId).toBeNull();
      expect(row.doctorEmploymentId).toBeNull();
      expect(row.hospitalMedicalRecordId).toBeNull();
    }
    // Counts are the tally of the per-row detail and cover every candidate.
    const tally = Object.values(report.counts).reduce((a, b) => a + b, 0);
    expect(tally).toBe(report.candidates);
    expect(report.rows).toHaveLength(report.candidates);
    expect(report.counts.proven).toBe(
      report.rows.filter((r) => r.classification === 'proven').length,
    );

    expect(await snapshot()).toEqual(beforeAny);
  });

  it('the dry run is permitted under APP_ENV=production and still writes nothing', async () => {
    const report = await runLegacyAssignmentBackfill(client, {
      apply: false,
      appEnv: 'production',
    });
    expect(report.rowsUpdated).toBe(0);
    expect(await snapshot()).toEqual(beforeAny);
  });

  it('--apply is refused under APP_ENV=production before anything is read or written', async () => {
    await expect(
      runLegacyAssignmentBackfill(client, { apply: true, appEnv: 'production' }),
    ).rejects.toThrow(/Refusing .* production/);
    expect(await snapshot()).toEqual(beforeAny);
  });

  it('the CLI reports by default and refuses --apply in production', async () => {
    const env = { ...process.env, DATABASE_URL: isolated?.url ?? '', APP_ENV: 'test' };
    const dry = await execFileAsync('npx', ['tsx', CLI], { cwd: BACKEND, env });
    const report = JSON.parse(dry.stdout) as BackfillReport;
    expect(report.mode).toBe('dry-run');
    expect(report.database).toBe(isolated?.name);
    expect(rowOf(report, w.proven).classification).toBe('proven');

    const refused = await execFileAsync('npx', ['tsx', CLI, '--apply'], {
      cwd: BACKEND,
      env: { ...env, APP_ENV: 'production' },
    }).then(
      () => undefined,
      (error: { code?: number; stderr?: string }) => error,
    );
    expect(refused?.code).toBe(1);
    expect(refused?.stderr).toMatch(/Refusing .* production/);
    expect(await snapshot()).toEqual(beforeAny);
  }, 60_000);

  it('--apply writes all three columns on proven rows only', async () => {
    const report = await runLegacyAssignmentBackfill(client, { apply: true, appEnv: 'test' });
    expect(report.mode).toBe('apply');
    expect(report.rowsUpdated).toBe(report.counts.proven);
    expect(report.counts.proven).toBeGreaterThanOrEqual(2);

    expect(await scopeOf(w.proven)).toEqual({
      hospital_id: w.hospitalA,
      doctor_employment_id: w.employmentProven,
      hospital_medical_record_id: w.recordProvenAtA,
    });
    expect(await scopeOf(w.boundary)).toEqual({
      hospital_id: w.hospitalA,
      doctor_employment_id: w.employmentProven,
      hospital_medical_record_id: w.recordBoundaryAtA,
    });

    afterApply = await snapshot();
    const provenIds = new Set(
      report.rows.filter((r) => r.classification === 'proven').map((r) => r.assignmentId),
    );
    for (const [id, row] of beforeAny) {
      if (provenIds.has(id)) {
        expect(afterApply.get(id)).not.toEqual(row);
      } else {
        // Unproven, revoked and already-owned rows: byte-for-byte untouched.
        expect(afterApply.get(id), id).toEqual(row);
      }
    }
    for (const id of Object.keys(w.expected).filter((id) => w.expected[id] !== 'proven')) {
      expect(await scopeOf(id)).toEqual({
        hospital_id: null,
        doctor_employment_id: null,
        hospital_medical_record_id: null,
      });
    }
  });

  it('written rows satisfy the composite scope FKs and are protected by the immutability trigger', async () => {
    const consistent = await one<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM public.patient_doctor_assignments a
         JOIN public.doctor_employments e
           ON e.id = a.doctor_employment_id AND e.hospital_id = a.hospital_id AND e.doctor_id = a.doctor_id
         JOIN public.hospital_medical_records r
           ON r.id = a.hospital_medical_record_id AND r.hospital_id = a.hospital_id AND r.patient_id = a.patient_id
        WHERE a.id = ANY($1::uuid[])`,
      [[w.proven, w.boundary]],
    );
    expect(consistent.n).toBe(2);

    const invalid = await one<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'public.patient_doctor_assignments'::regclass AND NOT convalidated",
    );
    expect(invalid.n).toBe(0);

    await client.query('BEGIN');
    try {
      await expect(
        client.query(
          'UPDATE public.patient_doctor_assignments SET hospital_id = $2 WHERE id = $1',
          [w.proven, w.hospitalB],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await client.query('ROLLBACK');
    }
  });

  it('a second --apply changes nothing', async () => {
    const report = await runLegacyAssignmentBackfill(client, { apply: true, appEnv: 'test' });
    expect(report.rowsUpdated).toBe(0);
    expect(report.counts.proven).toBe(0);
    expect(report.rows.some((r) => r.assignmentId === w.proven)).toBe(false);
    for (const [id, classification] of Object.entries(w.expected)) {
      if (classification !== 'proven')
        expect(rowOf(report, id).classification).toBe(classification);
    }
    expect(await snapshot()).toEqual(afterApply);
  });
});
