import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Phase 21 schema invariants against the disposable PostgreSQL 16 CI database. */
const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
let databaseUrl: URL;
try {
  databaseUrl = new URL(rawDatabaseUrl);
} catch {
  throw new Error('Phase 21 tests require the disposable medora_test DATABASE_URL.');
}
const inCi = process.env['CI'] === 'true';
const expectedPort = inCi ? '5432' : '5433';
if (!inCi && process.env['MEDORA_PHASE21_DISPOSABLE_DB'] !== '1') {
  throw new Error('Refusing Phase 21 integration tests outside CI without explicit disposable-database opt-in.');
}
if (
  databaseUrl.pathname !== '/medora_test' ||
  !['localhost', '127.0.0.1', '::1'].includes(databaseUrl.hostname) ||
  databaseUrl.username !== 'medora' ||
  (databaseUrl.port || '5432') !== expectedPort ||
  process.env['APP_ENV'] !== 'test'
) {
  throw new Error('Refusing Phase 21 tests: expected the disposable loopback medora_test database as medora.');
}

const client = new Client({ connectionString: rawDatabaseUrl });
let connected = false;

async function inRollback(work: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function expectSqlState(sql: string, values: unknown[], state: string): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  await expect(client.query(sql, values)).rejects.toMatchObject({ code: state });
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
}

async function createHospital(name: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    'INSERT INTO public.hospitals (public_id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
    [randomUUID(), name],
  );
  return result.rows[0]!.id;
}

async function createPatient(): Promise<string> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const result = await client.query<{ id: string }>(
    "INSERT INTO public.patients (public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, updated_at) VALUES ($1, $2, $3, DATE '1990-01-01', $4, $5, $6, CURRENT_TIMESTAMP) RETURNING id",
    ['PT-' + suffix, 'm21_' + suffix, 'Phase 21 Test', 'female', 'O+', '5550100'],
  );
  return result.rows[0]!.id;
}

async function createDoctor(): Promise<string> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const roleId = randomUUID();
  const userId = randomUUID();
  const doctorId = randomUUID();
  await client.query(
    'INSERT INTO public.roles (id, code, label, is_system, updated_at) VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP)',
    [roleId, 'p21_' + suffix, 'Phase 21 test role'],
  );
  await client.query(
    'INSERT INTO public.users (id, public_id, first_name, last_name, display_name, email, phone, role_id, terms_accepted_at, privacy_accepted_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
    [userId, 'usr_p21_' + suffix, 'Test', 'Doctor', 'Test Doctor', 'p21_' + suffix + '@example.test', '5550101', roleId],
  );
  await client.query(
    'INSERT INTO public.doctors (id, user_id, full_name, specialty, license_number, contact_email, contact_phone, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)',
    [doctorId, userId, 'Test Doctor', 'General Medicine', 'lic_p21_' + suffix, 'd' + suffix + '@example.test', '5550101'],
  );
  return userId;
}

beforeAll(async () => {
  await client.connect();
  connected = true;
  const identity = await client.query<{ current_database: string; server_version_num: string }>(
    'SELECT current_database(), current_setting($1) AS server_version_num',
    ['server_version_num'],
  );
  if (identity.rows[0]?.current_database !== 'medora_test' || !identity.rows[0]?.server_version_num.startsWith('16')) {
    await client.end();
    connected = false;
    throw new Error('Refusing Phase 21 tests: expected disposable PostgreSQL 16 database medora_test.');
  }
}, 15_000);

afterAll(async () => {
  if (connected) await client.end();
});

describe('Phase 21 multi-hospital data model (PostgreSQL 16)', () => {
  it('records a successful fresh application of this additive migration', async () => {
    const result = await client.query<{ finished_at: Date | null; rolled_back_at: Date | null }>(
      'SELECT finished_at, rolled_back_at FROM public._prisma_migrations WHERE migration_name = $1',
      ['20261122170000_phase21_data_model'],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.finished_at).not.toBeNull();
    expect(result.rows[0]?.rolled_back_at).toBeNull();
  });

  it('preserves legacy unowned clinical rows and rejects cross-patient or cross-hospital HMR links', async () => {
    await inRollback(async () => {
      const hospitalA = await createHospital('Phase 21 Hospital A');
      const hospitalB = await createHospital('Phase 21 Hospital B');
      const patientA = await createPatient();
      const patientB = await createPatient();
      const hmrA = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [patientA, hospitalA],
      )).rows[0]!.id;
      const hmrB = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [patientA, hospitalB],
      )).rows[0]!.id;
      await expectSqlState(
        'UPDATE public.hospital_medical_records SET hospital_id = $1 WHERE id = $2',
        [hospitalB, hmrA],
        '23514',
      );
      await expectSqlState(
        'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [patientA, hospitalA],
        '23505',
      );
      await expectSqlState(
        'INSERT INTO public.patient_clinical_alerts (patient_id, severity, message, updated_at, hospital_id, hospital_medical_record_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)',
        [patientB, 'critical', 'Wrong patient', hospitalA, hmrA],
        '23503',
      );
      await expectSqlState(
        'INSERT INTO public.patient_clinical_alerts (patient_id, severity, message, updated_at, hospital_id, hospital_medical_record_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4, $5)',
        [patientA, 'critical', 'Wrong hospital', hospitalA, hmrB],
        '23503',
      );
      const legacy = await client.query<{ hospital_id: string | null; hospital_medical_record_id: string | null }>(
        'INSERT INTO public.patient_clinical_alerts (patient_id, severity, message, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING hospital_id, hospital_medical_record_id',
        [patientA, 'warning', 'Legacy unassigned row'],
      );
      expect(legacy.rows[0]).toEqual({ hospital_id: null, hospital_medical_record_id: null });
    });
  });

  it('allows staff affiliations at multiple hospitals but prevents duplicates within one hospital', async () => {
    await inRollback(async () => {
      const hospitalA = await createHospital('Staff Hospital A');
      const hospitalB = await createHospital('Staff Hospital B');
      const departmentId = (await client.query<{ id: string }>(
        'INSERT INTO public.departments (name, updated_at) VALUES ($1, CURRENT_TIMESTAMP) RETURNING id',
        ['Phase 21 ' + randomUUID().slice(0, 8)],
      )).rows[0]!.id;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const staffId = (await client.query<{ id: string }>(
        'INSERT INTO public.staff_members (name, role, title, department_id, phone, email, working_hours, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id',
        ['Test Nurse', 'nurse', 'RN', departmentId, '5550102', 's' + suffix + '@example.test', 'day'],
      )).rows[0]!.id;
      await client.query(
        'INSERT INTO public.hospital_staff_affiliations (staff_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP), ($1, $3, CURRENT_TIMESTAMP)',
        [staffId, hospitalA, hospitalB],
      );
      await expectSqlState(
        'INSERT INTO public.hospital_staff_affiliations (staff_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [staffId, hospitalA],
        '23505',
      );
      const rows = await client.query<{ hospital_id: string }>(
        'SELECT hospital_id FROM public.hospital_staff_affiliations WHERE staff_id = $1 AND ended_at IS NULL',
        [staffId],
      );
      expect(new Set(rows.rows.map((row) => row.hospital_id))).toEqual(new Set([hospitalA, hospitalB]));
    });
  });

  it('enforces one active doctor employment and revokes only roles sourced from the ended employment', async () => {
    await inRollback(async () => {
      const hospitalA = await createHospital('Employment Hospital A');
      const hospitalB = await createHospital('Employment Hospital B');
      const userId = await createDoctor();
      const employmentA = (await client.query<{ id: string }>(
        'INSERT INTO public.doctor_employments (doctor_id, hospital_id, updated_at) SELECT id, $2, CURRENT_TIMESTAMP FROM public.doctors WHERE user_id = $1 RETURNING id',
        [userId, hospitalA],
      )).rows[0]!.id;
      await expectSqlState(
        'INSERT INTO public.doctor_employments (doctor_id, hospital_id, updated_at) SELECT id, $2, CURRENT_TIMESTAMP FROM public.doctors WHERE user_id = $1',
        [userId, hospitalB],
        '23505',
      );
      const departmentId = (await client.query<{ id: string }>(
        'INSERT INTO public.departments (name, updated_at) VALUES ($1, CURRENT_TIMESTAMP) RETURNING id',
        ['Phase 21 staff ' + randomUUID().slice(0, 8)],
      )).rows[0]!.id;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const staffId = (await client.query<{ id: string }>(
        'INSERT INTO public.staff_members (user_id, name, role, title, department_id, phone, email, working_hours, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING id',
        [userId, 'Test Nurse', 'nurse', 'RN', departmentId, '5550102', 's' + suffix + '@example.test', 'day'],
      )).rows[0]!.id;
      const affiliations = await client.query<{ id: string }>(
        'INSERT INTO public.hospital_staff_affiliations (staff_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP), ($1, $3, CURRENT_TIMESTAMP) RETURNING id',
        [staffId, hospitalA, hospitalB],
      );
      const roleDoctor = randomUUID();
      const roleStaffA = randomUUID();
      const roleStaffB = randomUUID();
      for (const [id, code] of [[roleDoctor, 'doctor'], [roleStaffA, 'staffa'], [roleStaffB, 'staffb']] as const) {
        await client.query(
          'INSERT INTO public.roles (id, code, label, is_system, updated_at) VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP)',
          [id, 'p21_' + code + '_' + randomUUID().slice(0, 8), 'Phase 21 role'],
        );
      }
      const assignmentDoctor = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_role_assignments (user_id, hospital_id, role_id, source_doctor_employment_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, hospitalA, roleDoctor, employmentA],
      )).rows[0]!.id;
      const assignmentStaffA = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_role_assignments (user_id, hospital_id, role_id, source_staff_affiliation_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, hospitalA, roleStaffA, affiliations.rows[0]!.id],
      )).rows[0]!.id;
      const assignmentStaffB = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_role_assignments (user_id, hospital_id, role_id, source_staff_affiliation_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, hospitalB, roleStaffB, affiliations.rows[1]!.id],
      )).rows[0]!.id;
      await client.query('UPDATE public.doctor_employments SET ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [employmentA]);
      const grants = await client.query<{ id: string; revoked_at: Date | null }>(
        'SELECT id, revoked_at FROM public.hospital_role_assignments WHERE id = ANY($1::uuid[])',
        [[assignmentDoctor, assignmentStaffA, assignmentStaffB]],
      );
      const revoked = new Map(grants.rows.map((row) => [row.id, row.revoked_at]));
      expect(revoked.get(assignmentDoctor)).not.toBeNull();
      expect(revoked.get(assignmentStaffA)).toBeNull();
      expect(revoked.get(assignmentStaffB)).toBeNull();
    });
  });

  it('rejects a hospital department owned by a different hospital', async () => {
    await inRollback(async () => {
      const hospitalA = await createHospital('Department Hospital A');
      const hospitalB = await createHospital('Department Hospital B');
      const departmentA = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_departments (hospital_id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [hospitalA, 'Department ' + randomUUID().slice(0, 8)],
      )).rows[0]!.id;
      const userId = await createDoctor();
      await expectSqlState(
        'INSERT INTO public.doctor_employments (doctor_id, hospital_id, hospital_department_id, updated_at) SELECT id, $2, $3, CURRENT_TIMESTAMP FROM public.doctors WHERE user_id = $1',
        [userId, hospitalB, departmentA],
        '23503',
      );
    });
  });

  it('keeps clinic hours and room uniqueness scoped without changing the legacy schedule', async () => {
    await inRollback(async () => {
      const hospitalA = await createHospital('Operations Hospital A');
      const hospitalB = await createHospital('Operations Hospital B');
      const clinicA = (await client.query<{ id: string }>(
        'INSERT INTO public.clinics (public_id, hospital_id, name, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id',
        [randomUUID(), hospitalA, 'Clinic A'],
      )).rows[0]!.id;
      const clinicB = (await client.query<{ id: string }>(
        'INSERT INTO public.clinics (public_id, hospital_id, name, updated_at) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) RETURNING id',
        [randomUUID(), hospitalB, 'Clinic B'],
      )).rows[0]!.id;
      await client.query(
        "INSERT INTO public.clinic_operating_hours (clinic_id, day, open, start_time, end_time, updated_at) VALUES ($1, 'Mon', true, TIME '08:00', TIME '17:00', CURRENT_TIMESTAMP), ($2, 'Mon', true, TIME '09:00', TIME '18:00', CURRENT_TIMESTAMP)",
        [clinicA, clinicB],
      );
      await expectSqlState(
        "INSERT INTO public.clinic_operating_hours (clinic_id, day, open, start_time, end_time, updated_at) VALUES ($1, 'Mon', true, TIME '08:00', TIME '17:00', CURRENT_TIMESTAMP)",
        [clinicA],
        '23505',
      );
      const departmentA = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_departments (hospital_id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [hospitalA, 'Operations ' + randomUUID().slice(0, 8)],
      )).rows[0]!.id;
      const departmentB = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_departments (hospital_id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [hospitalB, 'Operations ' + randomUUID().slice(0, 8)],
      )).rows[0]!.id;
      const catalogueId = (await client.query<{ id: string }>(
        'INSERT INTO public.departments (name, updated_at) VALUES ($1, CURRENT_TIMESTAMP) RETURNING id',
        ['Phase 21 catalogue ' + randomUUID().slice(0, 8)],
      )).rows[0]!.id;
      await client.query(
        "INSERT INTO public.rooms (name, kind, capacity, department_id, updated_at, hospital_id, hospital_department_id) VALUES ($1, 'consultation', 2, $2, CURRENT_TIMESTAMP, $3, $4), ($1, 'consultation', 2, $2, CURRENT_TIMESTAMP, $5, $6), ($1, 'consultation', 2, $2, CURRENT_TIMESTAMP, NULL, NULL)",
        ['Consultation 1', catalogueId, hospitalA, departmentA, hospitalB, departmentB],
      );
      await expectSqlState(
        "INSERT INTO public.rooms (name, kind, capacity, department_id, updated_at, hospital_id, hospital_department_id) VALUES ($1, 'consultation', 2, $2, CURRENT_TIMESTAMP, $3, $4)",
        ['Cross Tenant Invalid Room', catalogueId, hospitalB, departmentA],
        '23503',
      );
      const rooms = await client.query<{ count: string }>('SELECT count(*)::text AS count FROM public.rooms WHERE name = $1', ['Consultation 1']);
      expect(rooms.rows[0]?.count).toBe('3');
    });
  });

  it('enforces employment provenance and the active published-slot index', async () => {
    const indexes = await client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_catalog.pg_indexes
       WHERE schemaname = $1 AND tablename = ANY($2::text[])`,
      [
        'public',
        [
          'doctor_employments',
          'doctor_availability',
          'hospital_staff_affiliations',
          'appointments',
          'patient_doctor_assignments',
          'record_issue_reports',
        ],
      ],
    );
    const definitions = indexes.rows.map((row) => row.indexname + ' ' + row.indexdef).join('\n');
    expect(definitions).toContain('doctor_employments_one_active_per_doctor_key');
    expect(definitions).toContain('doctor_availability_legacy_unique');
    expect(definitions).toContain('doctor_availability_employment_unique');
    expect(definitions).toContain('WHERE (ended_at IS NULL)');
    expect(definitions).toContain('appointments_one_active_booking_per_slot');
    const partialIndexes = await client.query<{ indexname: string; predicate: string | null }>(
      `
        SELECT index_class.relname AS indexname,
               pg_get_expr(index_catalog.indpred, index_catalog.indrelid) AS predicate
        FROM pg_catalog.pg_index AS index_catalog
        JOIN pg_catalog.pg_class AS index_class ON index_class.oid = index_catalog.indexrelid
        WHERE index_class.relname = ANY($1::text[])
      `,
      [
        [
          'appointments_one_active_booking_per_slot',
          'patient_doctor_assignments_one_live_primary',
          'record_issue_reports_open_idx',
        ],
      ],
    );
    expect(partialIndexes.rows).toHaveLength(3);
    const predicates = new Map(
      partialIndexes.rows.map((row) => [row.indexname, row.predicate ?? '']),
    );
    expect(predicates.get('appointments_one_active_booking_per_slot')).toContain(
      'published_slot_id',
    );
    for (const status of ['cancelled', 'rescheduled', 'completed', 'no-show']) {
      expect(predicates.get('appointments_one_active_booking_per_slot')).toContain(status);
    }
    expect(predicates.get('patient_doctor_assignments_one_live_primary')).toContain(
      'primary',
    );
    expect(predicates.get('patient_doctor_assignments_one_live_primary')).toContain(
      'revoked_at',
    );
    expect(predicates.get('record_issue_reports_open_idx')).toContain('resolved');
    expect(predicates.get('record_issue_reports_open_idx')).toContain('created_at');
    const triggers = await client.query<{ tgname: string }>(
      'SELECT tgname FROM pg_catalog.pg_trigger WHERE NOT tgisinternal AND tgname = ANY($1::text[])',
      [['doctor_employment_revoke_roles_trg', 'appointments_active_employment_trg', 'published_slots_active_employment_trg']],
    );
    expect(new Set(triggers.rows.map((row) => row.tgname))).toEqual(
      new Set(['doctor_employment_revoke_roles_trg', 'appointments_active_employment_trg', 'published_slots_active_employment_trg']),
    );
  });

  it('allows only one concurrent active booking for a published slot', async () => {
    const hospitalId = await createHospital('Concurrency Hospital');
    const patientA = await createPatient();
    const patientB = await createPatient();
    const hmrA = (await client.query<{ id: string }>(
      'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
      [patientA, hospitalId],
    )).rows[0]!.id;
    const hmrB = (await client.query<{ id: string }>(
      'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
      [patientB, hospitalId],
    )).rows[0]!.id;
    const userId = await createDoctor();
    const doctor = (await client.query<{ id: string; role_id: string }>(
      'SELECT d.id, u.role_id FROM public.doctors d JOIN public.users u ON u.id = d.user_id WHERE d.user_id = $1',
      [userId],
    )).rows[0]!;
    const employmentId = (await client.query<{ id: string }>(
      'INSERT INTO public.doctor_employments (doctor_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
      [doctor.id, hospitalId],
    )).rows[0]!.id;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const visitTypeId = (await client.query<{ id: string }>(
      'INSERT INTO public.visit_types (code, name, position, updated_at) VALUES ($1, $2, 1, CURRENT_TIMESTAMP) RETURNING id',
      ['p21_' + suffix, 'Phase 21 Visit ' + suffix],
    )).rows[0]!.id;
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const slotId = (await client.query<{ id: string }>(
      'INSERT INTO public.published_slots (hospital_id, doctor_employment_id, starts_at, duration_minutes) VALUES ($1, $2, $3, 30) RETURNING id',
      [hospitalId, employmentId, startsAt],
    )).rows[0]!.id;
    const appointmentIds = [randomUUID(), randomUUID()];
    const publicIds = ['p21_' + suffix + 'a', 'p21_' + suffix + 'b'];
    const contenders = [new Client({ connectionString: rawDatabaseUrl }), new Client({ connectionString: rawDatabaseUrl })];
    let contendersConnected = false;
    try {
      await Promise.all(contenders.map((connection) => connection.connect()));
      contendersConnected = true;
      const results = await Promise.allSettled(contenders.map((connection, index) => connection.query(
        "INSERT INTO public.appointments (id, public_id, patient_id, doctor_id, visit_type_id, starts_at, duration_min, status, reason, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id, published_slot_id) VALUES ($1, $2, $3, $4, $5, $6, 30, 'pending', 'Concurrency fixture', CURRENT_TIMESTAMP, $7, $8, $9, $10)",
        [appointmentIds[index], publicIds[index], index === 0 ? patientA : patientB, doctor.id, visitTypeId, startsAt, hospitalId, index === 0 ? hmrA : hmrB, employmentId, slotId],
      )));
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: '23505' });
      const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
      const loserIndex = 1 - winnerIndex;
      await client.query(
        "UPDATE public.appointments SET status = 'cancelled', cancelled_reason = 'Patient cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1",
        [appointmentIds[winnerIndex]],
      );
      await client.query(
        "INSERT INTO public.appointments (id, public_id, patient_id, doctor_id, visit_type_id, starts_at, duration_min, status, reason, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id, published_slot_id) VALUES ($1, $2, $3, $4, $5, $6, 30, 'pending', 'Replacement booking', CURRENT_TIMESTAMP, $7, $8, $9, $10)",
        [appointmentIds[loserIndex], publicIds[loserIndex], loserIndex === 0 ? patientA : patientB, doctor.id, visitTypeId, startsAt, hospitalId, loserIndex === 0 ? hmrA : hmrB, employmentId, slotId],
      );
      const booked = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.appointments WHERE published_slot_id = $1 AND status NOT IN ('cancelled', 'rescheduled', 'completed', 'no-show')",
        [slotId],
      );
      expect(booked.rows[0]?.count).toBe('1');
    } finally {
      if (contendersConnected) await Promise.all(contenders.map((connection) => connection.end()));
      await client.query('DELETE FROM public.appointments WHERE id = ANY($1::uuid[])', [appointmentIds]);
      await client.query('DELETE FROM public.published_slots WHERE id = $1', [slotId]);
      await client.query('DELETE FROM public.doctor_employments WHERE id = $1', [employmentId]);
      await client.query('DELETE FROM public.hospital_medical_records WHERE id = ANY($1::uuid[])', [[hmrA, hmrB]]);
      await client.query('DELETE FROM public.patients WHERE id = ANY($1::uuid[])', [[patientA, patientB]]);
      await client.query('DELETE FROM public.doctors WHERE id = $1', [doctor.id]);
      await client.query('DELETE FROM public.users WHERE id = $1', [userId]);
      await client.query('DELETE FROM public.roles WHERE id = $1', [doctor.role_id]);
      await client.query('DELETE FROM public.visit_types WHERE id = $1', [visitTypeId]);
      await client.query('DELETE FROM public.hospitals WHERE id = $1', [hospitalId]);
    }
  });
});
