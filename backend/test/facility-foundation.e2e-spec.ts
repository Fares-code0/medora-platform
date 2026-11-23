import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Facility constraints against real PostgreSQL 16. This suite refuses to
 * connect unless DATABASE_URL names the loopback-only disposable CI/test DB.
 */
const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
let databaseUrl: URL;
try {
  databaseUrl = new URL(rawDatabaseUrl);
} catch {
  throw new Error(
    'Facility integration tests require DATABASE_URL for the disposable medora_test database.',
  );
}

const inCi = process.env['CI'] === 'true';
const expectedPort = inCi ? '5432' : '5433';
if (!inCi && process.env['MEDORA_FACILITY_DISPOSABLE_DB'] !== '1') {
  throw new Error(
    'Refusing facility integration tests outside CI unless MEDORA_FACILITY_DISPOSABLE_DB=1 explicitly opts into the disposable PostgreSQL 16 test service.',
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
    'Refusing facility integration tests: DATABASE_URL must target medora_test on the expected loopback test port as medora and APP_ENV must be test.',
  );
}

const client = new Client({ connectionString: rawDatabaseUrl });
let connected = false;

async function inRollback<T>(work: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function savepointFailure(sql: string, values: unknown[], code: string): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  await expect(client.query(sql, values)).rejects.toMatchObject({ code });
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
}

async function createHospital(timezone = 'UTC'): Promise<string> {
  const result = await client.query<{ id: string }>(
    'INSERT INTO public.hospitals (public_id, name, timezone, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id',
    [randomUUID(), 'Facility test hospital', timezone],
  );
  return result.rows[0]!.id;
}

async function createLocation(hospitalId: string, timezone: string | null): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.hospital_locations
       (hospital_id, name, address_line_1, city, country_code, timezone, updated_at)
     VALUES ($1, $2, '1 Test Street', 'Test City', 'US', $3, CURRENT_TIMESTAMP)
     RETURNING id`,
    [hospitalId, `Location ${randomUUID()}`, timezone],
  );
  return result.rows[0]!.id;
}

beforeAll(async () => {
  await client.connect();
  connected = true;
  const identity = await client.query<{ current_database: string; server_version_num: string }>(
    'SELECT current_database(), current_setting($1) AS server_version_num',
    ['server_version_num'],
  );
  if (
    identity.rows[0]?.current_database !== 'medora_test' ||
    !identity.rows[0]?.server_version_num.startsWith('16')
  ) {
    await client.end();
    throw new Error(
      'Refusing facility integration tests: expected the disposable PostgreSQL 16 medora_test database.',
    );
  }
}, 15_000);

afterAll(async () => {
  if (connected) await client.end();
});

describe('facility foundation (PostgreSQL 16)', () => {
  it('checks pre-existing Hospital timezone values before the migration performs DDL', async () => {
    const migration = readFileSync(
      resolve(__dirname, '../prisma/migrations/20261122160000_facility_foundation/migration.sql'),
      'utf8',
    );
    expect(migration.indexOf('DO $timezone_preflight$')).toBeGreaterThanOrEqual(0);
    expect(migration.indexOf('DO $timezone_preflight$')).toBeLessThan(
      migration.indexOf('CREATE TABLE public.clinics'),
    );
    expect(migration).toContain('FROM public.hospitals AS h');
    expect(migration).toContain('pg_catalog.pg_timezone_names');

    const preflight = migration.match(
      /DO \$timezone_preflight\$[\s\S]*?\$timezone_preflight\$;/,
    )?.[0];
    expect(preflight).toBeDefined();
    await inRollback(async () => {
      await client.query(
        'CREATE TEMP TABLE facility_preflight_hospitals (id uuid PRIMARY KEY, timezone varchar(64))',
      );
      const id = randomUUID();
      await client.query(
        'INSERT INTO pg_temp.facility_preflight_hospitals (id, timezone) VALUES ($1, $2)',
        [id, 'Invalid/Existing_Zone'],
      );
      const isolatedPreflight = preflight!.replace(
        'public.hospitals AS h',
        'pg_temp.facility_preflight_hospitals AS h',
      );
      await client.query('SAVEPOINT invalid_legacy_timezone');
      await expect(client.query(isolatedPreflight)).rejects.toMatchObject({ code: '22023' });
      await client.query('ROLLBACK TO SAVEPOINT invalid_legacy_timezone');
      const unchanged = await client.query<{ timezone: string }>(
        'SELECT timezone FROM pg_temp.facility_preflight_hospitals WHERE id = $1',
        [id],
      );
      expect(unchanged.rows[0]?.timezone).toBe('Invalid/Existing_Zone');
    });
  });

  it('limits Hospital status to ACTIVE, SUSPENDED and INACTIVE (hospitals_status_check)', async () => {
    // The Prisma field is a free String; the database CHECK is the only
    // thing holding the vocabulary, so it is pinned here.
    await inRollback(async () => {
      const id = await createHospital();
      for (const status of ['SUSPENDED', 'INACTIVE', 'ACTIVE']) {
        await client.query('UPDATE public.hospitals SET status = $1 WHERE id = $2', [status, id]);
      }
      for (const status of ['PENDING', 'active', '']) {
        await savepointFailure('UPDATE public.hospitals SET status = $1 WHERE id = $2', [status, id], '23514');
      }
      await savepointFailure(
        'INSERT INTO public.hospitals (public_id, name, status, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        ['hsp_' + randomUUID(), 'Unknown status', 'ARCHIVED'],
        '23514',
      );
    });
  });

  it('accepts IANA Hospital zones, rejects invalid insert/update zones, and permits unrelated updates', async () => {
    await inRollback(async () => {
      const hospitalId = await createHospital('Europe/Nicosia');
      await client.query('UPDATE public.hospitals SET phone = $1 WHERE id = $2', [
        '+35700000000',
        hospitalId,
      ]);
      await savepointFailure(
        'INSERT INTO public.hospitals (public_id, name, timezone, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [randomUUID(), 'Invalid timezone hospital', 'Not/A_Real_Zone'],
        '22023',
      );
      await savepointFailure(
        'UPDATE public.hospitals SET timezone = $1 WHERE id = $2',
        ['Not/A_Real_Zone', hospitalId],
        '22023',
      );
    });
  });

  it('allows NULL location zones, validates supplied zones, and skips checks for unrelated updates', async () => {
    await inRollback(async () => {
      const hospitalId = await createHospital('UTC');
      const locationId = await createLocation(hospitalId, null);
      await client.query('UPDATE public.hospital_locations SET city = $1 WHERE id = $2', [
        'Other Test City',
        locationId,
      ]);
      await client.query('UPDATE public.hospital_locations SET timezone = $1 WHERE id = $2', [
        'Europe/Nicosia',
        locationId,
      ]);
      await client.query('UPDATE public.hospital_locations SET timezone = NULL WHERE id = $1', [
        locationId,
      ]);
      await savepointFailure(
        'UPDATE public.hospital_locations SET timezone = $1 WHERE id = $2',
        ['Invalid/Zone', locationId],
        '22023',
      );
    });
  });

  it('stores Clinics under a Hospital and prevents orphan or duplicate same-hospital clinics', async () => {
    await inRollback(async () => {
      const hospitalId = await createHospital();
      const clinicName = `Clinic ${randomUUID()}`;
      await client.query(
        'INSERT INTO public.clinics (public_id, hospital_id, name, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [randomUUID(), hospitalId, clinicName],
      );
      await savepointFailure(
        'INSERT INTO public.clinics (public_id, hospital_id, name, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [randomUUID(), hospitalId, clinicName],
        '23505',
      );
      await savepointFailure(
        'INSERT INTO public.clinics (public_id, hospital_id, name, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)',
        [randomUUID(), randomUUID(), `Orphan ${randomUUID()}`],
        '23503',
      );
    });
  });
});
