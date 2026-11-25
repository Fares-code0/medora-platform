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

  it('allows one active staff affiliation (MRD-05 a), keeps history, and rejects a second active one with 23505', async () => {
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
      const insertAffiliation =
        'INSERT INTO public.hospital_staff_affiliations (staff_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id';
      const first = (await client.query<{ id: string }>(insertAffiliation, [staffId, hospitalA])).rows[0]!.id;

      // A second active affiliation at another hospital violates the new global key …
      await client.query('SAVEPOINT expected_failure');
      await expect(client.query(insertAffiliation, [staffId, hospitalB])).rejects.toMatchObject({
        code: '23505',
        constraint: 'hospital_staff_affiliations_one_active_per_staff_key',
      });
      await client.query('ROLLBACK TO SAVEPOINT expected_failure');
      // … and a duplicate at the same hospital is still refused.
      await expectSqlState(insertAffiliation, [staffId, hospitalA], '23505');

      // Ending the first frees the staff member for a new hospital; history is kept.
      await client.query(
        'UPDATE public.hospital_staff_affiliations SET ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [first],
      );
      await client.query(insertAffiliation, [staffId, hospitalB]);
      const rows = await client.query<{ hospital_id: string; active: boolean }>(
        'SELECT hospital_id, ended_at IS NULL AS active FROM public.hospital_staff_affiliations WHERE staff_id = $1 ORDER BY started_at, active',
        [staffId],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.filter((row) => row.active).map((row) => row.hospital_id)).toEqual([hospitalB]);
    });
  });

  it('enforces one active doctor employment and revokes only roles sourced from the ended employment or affiliation', async () => {
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
      // Multi-hospital §2.3–§2.5: one active role assignment per account
      // (`hospital_role_assignments_one_active_per_user_key`), so the
      // staff-sourced role belongs to a second account. "Only the role
      // sourced from the ended row" is then proved across accounts.
      const staffUserId = await createDoctor();
      const staffId = (await client.query<{ id: string }>(
        'INSERT INTO public.staff_members (user_id, name, role, title, department_id, phone, email, working_hours, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP) RETURNING id',
        [staffUserId, 'Test Nurse', 'nurse', 'RN', departmentId, '5550102', 's' + suffix + '@example.test', 'day'],
      )).rows[0]!.id;
      const insertAffiliation =
        'INSERT INTO public.hospital_staff_affiliations (staff_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id';
      const affiliationA = (await client.query<{ id: string }>(insertAffiliation, [staffId, hospitalA])).rows[0]!.id;
      // MRD-05 (a): no second active affiliation while the first is active.
      await expectSqlState(insertAffiliation, [staffId, hospitalB], '23505');
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
      // A second active assignment for the same account is refused.
      await expectSqlState(
        'INSERT INTO public.hospital_role_assignments (user_id, hospital_id, role_id) VALUES ($1, $2, $3)',
        [userId, hospitalB, roleStaffB],
        '23505',
      );
      const assignmentStaffA = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_role_assignments (user_id, hospital_id, role_id, source_staff_affiliation_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [staffUserId, hospitalA, roleStaffA, affiliationA],
      )).rows[0]!.id;
      const revokedAt = async (ids: string[]): Promise<Map<string, Date | null>> => {
        const grants = await client.query<{ id: string; revoked_at: Date | null }>(
          'SELECT id, revoked_at FROM public.hospital_role_assignments WHERE id = ANY($1::uuid[])',
          [ids],
        );
        return new Map(grants.rows.map((row) => [row.id, row.revoked_at]));
      };

      // Ending the doctor employment revokes only the role it sourced.
      await client.query('UPDATE public.doctor_employments SET ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [employmentA]);
      let revoked = await revokedAt([assignmentDoctor, assignmentStaffA]);
      expect(revoked.get(assignmentDoctor)).not.toBeNull();
      expect(revoked.get(assignmentStaffA)).toBeNull();

      // Ending the staff affiliation revokes its role; a new affiliation at
      // another hospital can then start, and its role stays live.
      await client.query('UPDATE public.hospital_staff_affiliations SET ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1', [affiliationA]);
      const affiliationB = (await client.query<{ id: string }>(insertAffiliation, [staffId, hospitalB])).rows[0]!.id;
      const assignmentStaffB = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_role_assignments (user_id, hospital_id, role_id, source_staff_affiliation_id) VALUES ($1, $2, $3, $4) RETURNING id',
        [staffUserId, hospitalB, roleStaffB, affiliationB],
      )).rows[0]!.id;
      revoked = await revokedAt([assignmentStaffA, assignmentStaffB]);
      expect(revoked.get(assignmentStaffA)).not.toBeNull();
      expect(revoked.get(assignmentStaffB)).toBeNull();
    });
  });

  it('accepts INSERT and UPDATE on every table using validate_scoped_clinical_links, and rejects mismatched links', async () => {
    // 20261122170000 created this function with NEW.<column> references that
    // do not exist on every attached table (medical_records has no
    // prescription_id, notifications no lab_order_id until its own branch...),
    // so any INSERT or watched UPDATE on those tables raised "record new has
    // no field". 20261123100000 replaced it; this proves every attached
    // table now completes its own writes and still enforces the link scope.
    await inRollback(async () => {
      const hospitalA = await createHospital('Scoped Link Hospital A');
      const hospitalB = await createHospital('Scoped Link Hospital B');
      const patientId = await createPatient();
      const hmrA = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [patientId, hospitalA],
      )).rows[0]!.id;
      const hmrB = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [patientId, hospitalB],
      )).rows[0]!.id;
      const userId = await createDoctor();
      const doctorId = (await client.query<{ id: string }>('SELECT id FROM public.doctors WHERE user_id = $1', [userId])).rows[0]!.id;
      const employmentA = (await client.query<{ id: string }>(
        'INSERT INTO public.doctor_employments (doctor_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [doctorId, hospitalA],
      )).rows[0]!.id;
      const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
      const visitTypeId = (await client.query<{ id: string }>('SELECT id FROM public.visit_types LIMIT 1')).rows[0]!.id;
      const medicationId = (await client.query<{ id: string }>('SELECT id FROM public.medications LIMIT 1')).rows[0]!.id;
      const testId = (await client.query<{ id: string }>('SELECT id FROM public.lab_test_catalogue LIMIT 1')).rows[0]!.id;
      const scopeA = [hospitalA, hmrA] as const;

      const appointmentId = (await client.query<{ id: string }>(
        "INSERT INTO public.appointments (public_id, patient_id, doctor_id, visit_type_id, starts_at, duration_min, status, reason, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, $4, $5, 30, 'pending', 'Scoped link fixture', CURRENT_TIMESTAMP, $6, $7, $8) RETURNING id",
        ['APT-' + suffix, patientId, doctorId, visitTypeId, new Date(Date.now() + 2 * 3600_000), ...scopeA, employmentA],
      )).rows[0]!.id;
      const legacyAppointmentId = (await client.query<{ id: string }>(
        "INSERT INTO public.appointments (public_id, patient_id, doctor_id, visit_type_id, starts_at, duration_min, status, reason, updated_at) VALUES ($1, $2, $3, $4, $5, 30, 'pending', 'Legacy link fixture', CURRENT_TIMESTAMP) RETURNING id",
        ['APT-L' + suffix, patientId, doctorId, visitTypeId, new Date(Date.now() + 5 * 3600_000)],
      )).rows[0]!.id;

      const recordSql =
        "INSERT INTO public.medical_records (public_id, patient_id, doctor_id, visit_date, visit_type, chief_complaint, history_of_present_illness, physical_examination, updated_at, appointment_id, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'follow-up', 'cc', 'hpi', 'exam', CURRENT_TIMESTAMP, $4, $5, $6, $7) RETURNING id";
      const recordId = (await client.query<{ id: string }>(recordSql, ['MR-' + suffix, patientId, doctorId, appointmentId, ...scopeA, employmentA])).rows[0]!.id;
      await client.query('UPDATE public.medical_records SET appointment_id = appointment_id, hospital_id = hospital_id WHERE id = $1', [recordId]);
      // A scoped encounter cannot point at an unscoped (legacy) appointment.
      await expectSqlState(recordSql, ['MR-X' + suffix, patientId, doctorId, legacyAppointmentId, ...scopeA, employmentA], '23514');
      // Legacy rows keep the pre-Phase-21 behaviour.
      await client.query(
        "INSERT INTO public.medical_records (public_id, patient_id, doctor_id, visit_date, visit_type, chief_complaint, history_of_present_illness, physical_examination, updated_at, appointment_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'follow-up', 'cc', 'hpi', 'exam', CURRENT_TIMESTAMP, $4)",
        ['MR-L' + suffix, patientId, doctorId, legacyAppointmentId],
      );

      const vitalsSql =
        'INSERT INTO public.patient_vital_signs (patient_id, blood_pressure_systolic, blood_pressure_diastolic, heart_rate_bpm, temperature_c, respiratory_rate, oxygen_saturation, weight_kg, height_cm, updated_at, record_id, hospital_id, hospital_medical_record_id) VALUES ($1, 120, 80, 70, 37, 16, 98, 70, 170, CURRENT_TIMESTAMP, $2, $3, $4) RETURNING id';
      const vitalsId = (await client.query<{ id: string }>(vitalsSql, [patientId, recordId, ...scopeA])).rows[0]!.id;
      await client.query('UPDATE public.patient_vital_signs SET record_id = record_id WHERE id = $1', [vitalsId]);
      await expectSqlState(vitalsSql, [patientId, recordId, hospitalB, hmrB], '23514');

      const rxSql =
        "INSERT INTO public.prescriptions (public_id, patient_id, medication_id, prescribing_doctor_id, strength, dosage, frequency, route, duration_days, quantity, instructions, start_date, end_date, updated_at, record_id, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, $4, '10 mg', '1 tab', 'daily', 'Oral', 7, 7, 'with food', CURRENT_DATE, CURRENT_DATE + 7, CURRENT_TIMESTAMP, $5, $6, $7, $8) RETURNING id";
      const prescriptionId = (await client.query<{ id: string }>(rxSql, ['RX-' + suffix, patientId, medicationId, doctorId, recordId, ...scopeA, employmentA])).rows[0]!.id;
      await client.query('UPDATE public.prescriptions SET record_id = record_id WHERE id = $1', [prescriptionId]);

      const medicationSql =
        "INSERT INTO public.patient_medications (patient_id, name, dosage, frequency, start_date, updated_at, prescription_id, hospital_id, hospital_medical_record_id) VALUES ($1, 'Scoped med', '1 tab', 'daily', CURRENT_DATE, CURRENT_TIMESTAMP, $2, $3, $4) RETURNING id";
      const medicationRowId = (await client.query<{ id: string }>(medicationSql, [patientId, prescriptionId, ...scopeA])).rows[0]!.id;
      await client.query('UPDATE public.patient_medications SET prescription_id = prescription_id WHERE id = $1', [medicationRowId]);
      await expectSqlState(medicationSql, [patientId, prescriptionId, hospitalB, hmrB], '23514');

      const labOrderId = (await client.query<{ id: string }>(
        "INSERT INTO public.lab_orders (public_id, patient_id, test_id, ordered_by, clinical_indication, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, $4, 'screen', CURRENT_TIMESTAMP, $5, $6, $7) RETURNING id",
        ['LAB-' + suffix, patientId, testId, doctorId, ...scopeA, employmentA],
      )).rows[0]!.id;
      const studySql =
        "INSERT INTO public.patient_studies (patient_id, modality, category_label, name, performed_on, status, updated_at, lab_order_id, hospital_id, hospital_medical_record_id) VALUES ($1, 'lab', 'Chemistry', 'Panel', CURRENT_DATE, 'pending', CURRENT_TIMESTAMP, $2, $3, $4) RETURNING id";
      const studyId = (await client.query<{ id: string }>(studySql, [patientId, labOrderId, ...scopeA])).rows[0]!.id;
      await client.query('UPDATE public.patient_studies SET lab_order_id = lab_order_id WHERE id = $1', [studyId]);
      await expectSqlState(studySql, [patientId, labOrderId, hospitalB, hmrB], '23514');

      const notificationSql = (column: string): string =>
        `INSERT INTO public.notifications (recipient_id, title, body, category, kind, sender, patient_id, hospital_id, hospital_medical_record_id, ${column}) VALUES ($1, 'Scoped', 'Scoped link', 'system', 'update', 'system', $2, $3, $4, $5) RETURNING id`;
      for (const [column, target] of [
        ['record_id', recordId],
        ['lab_order_id', labOrderId],
        ['prescription_id', prescriptionId],
        ['appointment_id', appointmentId],
      ] as const) {
        const notificationId = (await client.query<{ id: string }>(notificationSql(column), [userId, patientId, ...scopeA, target])).rows[0]!.id;
        await client.query(`UPDATE public.notifications SET ${column} = ${column} WHERE id = $1`, [notificationId]);
        await expectSqlState(notificationSql(column), [userId, patientId, hospitalB, hmrB, target], '23514');
      }
      await client.query(
        "INSERT INTO public.notifications (recipient_id, title, body, category, kind, sender) VALUES ($1, 'Legacy', 'No target', 'system', 'update', 'system')",
        [userId],
      );
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
    const partialIndexes = await client.query<{ indexname: string; predicate: string | null; index_definition: string }>(
      `
        SELECT index_class.relname AS indexname,
               pg_get_expr(index_catalog.indpred, index_catalog.indrelid) AS predicate,
               pg_get_indexdef(index_catalog.indexrelid) AS index_definition
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
    const partialIndexDefinitions = new Map(
      partialIndexes.rows.map((row) => [row.indexname, row.index_definition]),
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
    expect(partialIndexDefinitions.get('record_issue_reports_open_idx')).toContain('created_at');
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
    const publicIds = ['APT-' + suffix + 'a', 'APT-' + suffix + 'b'];
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
      // The pre-existing doctor-overlap exclusion constraint rejects this race first.
      expect(rejected[0]?.reason).toMatchObject({ code: '23P01' });
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

  it('queue and waiting-room entries: hospital ownership is optional, immutable, and must match the room or appointment (#21)', async () => {
    await inRollback(async () => {
      const hospitalA = await createHospital('Queue Hospital A');
      const hospitalB = await createHospital('Queue Hospital B');
      const departmentId = (await client.query<{ id: string }>(
        'INSERT INTO public.departments (name, updated_at) VALUES ($1, CURRENT_TIMESTAMP) RETURNING id',
        ['Queue ' + randomUUID().slice(0, 8)],
      )).rows[0]!.id;
      const room = async (hospitalId: string | null): Promise<string> =>
        (await client.query<{ id: string }>(
          "INSERT INTO public.rooms (name, kind, capacity, department_id, updated_at, hospital_id) VALUES ($1, 'consultation', 1, $2, CURRENT_TIMESTAMP, $3) RETURNING id",
          ['Q-room ' + randomUUID().slice(0, 8), departmentId, hospitalId],
        )).rows[0]!.id;
      const roomA = await room(hospitalA);
      const roomB = await room(hospitalB);
      const legacyRoom = await room(null);
      const insertQueue =
        "INSERT INTO public.queue_entries (ticket, patient_name, reason, estimated_minutes, updated_at, room_id, hospital_id) VALUES ($1, 'Queue Patient', 'reason', 5, CURRENT_TIMESTAMP, $2, $3) RETURNING id";
      const ticket = (): string => 'Q' + randomUUID().replaceAll('-', '').slice(0, 8);

      // Valid: same-hospital room, no room, and legacy rows (unchecked).
      const scoped = (await client.query<{ id: string }>(insertQueue, [ticket(), roomA, hospitalA])).rows[0]!.id;
      await client.query(insertQueue, [ticket(), null, hospitalA]);
      const legacy = (await client.query<{ id: string }>(insertQueue, [ticket(), roomB, null])).rows[0]!.id;
      await client.query('UPDATE public.queue_entries SET room_id = $1 WHERE id = $2', [roomA, legacy]);

      // Invalid: another hospital's room, a legacy room, an unknown hospital.
      await expectSqlState(insertQueue, [ticket(), roomB, hospitalA], '23514');
      await expectSqlState(insertQueue, [ticket(), legacyRoom, hospitalA], '23514');
      await expectSqlState(insertQueue, [ticket(), null, randomUUID()], '23503');
      await expectSqlState('UPDATE public.queue_entries SET room_id = $1 WHERE id = $2', [roomB, scoped], '23514');
      // Ownership is immutable once assigned.
      await expectSqlState('UPDATE public.queue_entries SET hospital_id = $1 WHERE id = $2', [hospitalB, scoped], '23514');
      // A legacy row may be assigned an owner once (approved-mapping path), consistently with its room —
      // and only with the mapping recorded as evidence first (M2, migration 20261125102000).
      await expectSqlState('UPDATE public.queue_entries SET hospital_id = $1 WHERE id = $2', [hospitalA, legacy], '23514');
      await client.query(
        `INSERT INTO public.ownership_assignments (table_name, row_id, hospital_id, evidence_rule, evidence)
         VALUES ('queue_entries', $1, $2, 'approved_mapping', '{}')`,
        [legacy, hospitalA],
      );
      await client.query('UPDATE public.queue_entries SET hospital_id = $1 WHERE id = $2', [hospitalA, legacy]);
      // The owning hospital cannot be hard-deleted while it owns entries.
      await expectSqlState('DELETE FROM public.hospitals WHERE id = $1', [hospitalA], '23503');

      // Waiting room: same-hospital appointment, walk-in, cross-hospital refused.
      const patientId = await createPatient();
      const userId = await createDoctor();
      const doctorId = (await client.query<{ id: string }>('SELECT id FROM public.doctors WHERE user_id = $1', [userId])).rows[0]!.id;
      const employmentA = (await client.query<{ id: string }>(
        'INSERT INTO public.doctor_employments (doctor_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [doctorId, hospitalA],
      )).rows[0]!.id;
      const hmrA = (await client.query<{ id: string }>(
        'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [patientId, hospitalA],
      )).rows[0]!.id;
      const visitTypeId = (await client.query<{ id: string }>('SELECT id FROM public.visit_types LIMIT 1')).rows[0]!.id;
      const appointmentA = (await client.query<{ id: string }>(
        "INSERT INTO public.appointments (public_id, patient_id, doctor_id, visit_type_id, starts_at, duration_min, status, reason, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, $4, $5, 30, 'pending', 'Queue fixture', CURRENT_TIMESTAMP, $6, $7, $8) RETURNING id",
        ['APT-Q' + randomUUID().replaceAll('-', '').slice(0, 10), patientId, doctorId, visitTypeId, new Date(Date.now() + 7_200_000), hospitalA, hmrA, employmentA],
      )).rows[0]!.id;
      const insertWaiting =
        "INSERT INTO public.waiting_room_entries (patient_name, area, updated_at, appointment_id, hospital_id) VALUES ('Waiting Patient', 'Main', CURRENT_TIMESTAMP, $1, $2) RETURNING id";
      const waiting = (await client.query<{ id: string }>(insertWaiting, [appointmentA, hospitalA])).rows[0]!.id;
      await client.query(insertWaiting, [null, hospitalB]);
      await client.query(insertWaiting, [appointmentA, null]);
      await expectSqlState(insertWaiting, [appointmentA, hospitalB], '23514');
      await expectSqlState('UPDATE public.waiting_room_entries SET hospital_id = $1 WHERE id = $2', [hospitalB, waiting], '23514');
      // The existing check-in mirror still runs for a hospital-owned entry.
      const mirrored = await client.query<{ checked_in_at: Date | null }>('SELECT checked_in_at FROM public.appointments WHERE id = $1', [appointmentA]);
      expect(mirrored.rows[0]?.checked_in_at).not.toBeNull();
    });
  });
});
