/**
 * Phase 22 RLS design — behaviour of the PROPOSED policies on PostgreSQL 16.
 *
 * `prisma/rls-proposal/phase22-rls-proposal.sql` is not a migration and is
 * never applied. Each test executes it inside a transaction that is always
 * rolled back, creates a temporary non-owner role in the same transaction,
 * and proves what PostgreSQL actually does (docs/multi-hospital/RLS_DESIGN.md).
 * Nothing persists: no policy, role, function or row outlives a test.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
let databaseUrl: URL;
try {
  databaseUrl = new URL(rawDatabaseUrl);
} catch {
  throw new Error('RLS proposal tests require the disposable medora_test DATABASE_URL.');
}
const inCi = process.env['CI'] === 'true';
const expectedPort = inCi ? '5432' : '5433';
if (!inCi && process.env['MEDORA_PHASE21_DISPOSABLE_DB'] !== '1') {
  throw new Error(
    'Refusing RLS proposal tests outside CI without explicit disposable-database opt-in.',
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
    'Refusing RLS proposal tests: expected the disposable loopback medora_test database as medora.',
  );
}

const PROPOSAL = readFileSync(
  resolve(__dirname, '../prisma/rls-proposal/phase22-rls-proposal.sql'),
  'utf8',
);
const client = new Client({ connectionString: rawDatabaseUrl });
let connected = false;

beforeAll(async () => {
  await client.connect();
  connected = true;
  const identity = await client.query<{ db: string; version: string }>(
    "SELECT current_database() AS db, current_setting('server_version_num') AS version",
  );
  if (identity.rows[0]?.db !== 'medora_test' || !identity.rows[0]?.version.startsWith('16')) {
    throw new Error('Refusing RLS proposal tests: expected disposable PostgreSQL 16 medora_test.');
  }
}, 15_000);

afterAll(async () => {
  if (connected) await client.end();
});

const suffix = (): string => randomUUID().replaceAll('-', '').slice(0, 10);

async function one<T>(sql: string, values: unknown[] = []): Promise<T> {
  const result = await client.query(sql, values);
  return result.rows[0] as T;
}

interface World {
  readonly role: string;
  readonly hospitalA: string;
  readonly hospitalB: string;
  readonly patient: string;
  readonly allergyA: string;
  readonly allergyB: string;
  readonly allergyLegacy: string;
  readonly appointmentA: string;
  readonly appointmentB: string;
  readonly recordA: string;
  readonly recordB: string;
  readonly doctorUserA: string;
  readonly doctorA: string;
  readonly employmentA: string;
  readonly hmrA: string;
  readonly hmrB: string;
  readonly patientOnlyAtB: string;
  readonly queueA: string;
  readonly queueB: string;
  readonly prescriptionB: string;
}

async function hospital(name: string): Promise<string> {
  return (
    await one<{ id: string }>(
      'INSERT INTO public.hospitals (public_id, name, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
      ['hsp_' + randomUUID(), name],
    )
  ).id;
}

async function doctor(): Promise<{ userId: string; doctorId: string }> {
  const s = suffix();
  const roleId = (await one<{ id: string }>("SELECT id FROM public.roles WHERE code = 'doctor'"))
    .id;
  const userId = (
    await one<{ id: string }>(
      'INSERT INTO public.users (public_id, first_name, last_name, display_name, email, phone, role_id, terms_accepted_at, privacy_accepted_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING id',
      ['usr_rls' + s, 'Rls', 'Doctor', 'RLS Doctor', `rls-${s}@example.test`, '5550101', roleId],
    )
  ).id;
  const doctorId = (
    await one<{ id: string }>(
      'INSERT INTO public.doctors (user_id, full_name, specialty, license_number, contact_email, contact_phone, updated_at) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) RETURNING id',
      [userId, 'RLS Doctor', 'General Medicine', 'lic_rls_' + s, `d-${s}@example.test`, '5550101'],
    )
  ).id;
  return { userId, doctorId };
}

async function employ(doctorId: string, hospitalId: string): Promise<string> {
  return (
    await one<{ id: string }>(
      'INSERT INTO public.doctor_employments (doctor_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
      [doctorId, hospitalId],
    )
  ).id;
}

/** Builds two hospitals' data as the owner, applies the proposal, creates the probe role. */
async function buildWorld(): Promise<World> {
  const hospitalA = await hospital('RLS Hospital A');
  const hospitalB = await hospital('RLS Hospital B');
  const s = suffix();
  const patient = (
    await one<{ id: string }>(
      "INSERT INTO public.patients (public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, updated_at) VALUES ($1, $2, 'RLS Patient', DATE '1990-01-01', 'female', 'O+', '5550100', CURRENT_TIMESTAMP) RETURNING id",
      ['PT-R' + s, 'rls_' + s],
    )
  ).id;
  const hmr = async (hospitalId: string): Promise<string> =>
    (
      await one<{ id: string }>(
        'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) RETURNING id',
        [patient, hospitalId],
      )
    ).id;
  const hmrA = await hmr(hospitalA);
  const hmrB = await hmr(hospitalB);
  const allergy = async (
    allergen: string,
    hospitalId: string | null,
    hmrId: string | null,
  ): Promise<string> =>
    (
      await one<{ id: string }>(
        "INSERT INTO public.patient_allergies (patient_id, allergen, severity, reaction, updated_at, hospital_id, hospital_medical_record_id) VALUES ($1, $2, 'mild', 'rash', CURRENT_TIMESTAMP, $3, $4) RETURNING id",
        [patient, allergen, hospitalId, hmrId],
      )
    ).id;
  const allergyA = await allergy('A-peanut', hospitalA, hmrA);
  const allergyB = await allergy('B-latex', hospitalB, hmrB);
  const allergyLegacy = await allergy('legacy-dust', null, null);

  const a = await doctor();
  const b = await doctor();
  const employmentA = await employ(a.doctorId, hospitalA);
  const employmentB = await employ(b.doctorId, hospitalB);
  const visitTypeId = (await one<{ id: string }>('SELECT id FROM public.visit_types LIMIT 1')).id;
  const appointment = async (
    publicId: string,
    doctorId: string,
    hospitalId: string,
    hmrId: string,
    employmentId: string,
    hours: number,
  ): Promise<string> =>
    (
      await one<{ id: string }>(
        "INSERT INTO public.appointments (public_id, patient_id, doctor_id, visit_type_id, starts_at, duration_min, status, reason, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, $4, $5, 30, 'pending', 'RLS fixture', CURRENT_TIMESTAMP, $6, $7, $8) RETURNING id",
        [
          publicId,
          patient,
          doctorId,
          visitTypeId,
          new Date(Date.now() + hours * 3_600_000),
          hospitalId,
          hmrId,
          employmentId,
        ],
      )
    ).id;
  const appointmentA = await appointment('APT-RA' + s, a.doctorId, hospitalA, hmrA, employmentA, 3);
  const appointmentB = await appointment('APT-RB' + s, b.doctorId, hospitalB, hmrB, employmentB, 6);
  const record = async (
    publicId: string,
    doctorId: string,
    hospitalId: string,
    hmrId: string,
    employmentId: string,
  ): Promise<string> =>
    (
      await one<{ id: string }>(
        "INSERT INTO public.medical_records (public_id, patient_id, doctor_id, visit_date, visit_type, chief_complaint, history_of_present_illness, physical_examination, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, 'follow-up', 'cc', 'hpi', 'exam', CURRENT_TIMESTAMP, $4, $5, $6) RETURNING id",
        [publicId, patient, doctorId, hospitalId, hmrId, employmentId],
      )
    ).id;
  const recordA = await record('MR-RA' + s, a.doctorId, hospitalA, hmrA, employmentA);
  const recordB = await record('MR-RB' + s, b.doctorId, hospitalB, hmrB, employmentB);
  for (const [recordId, author] of [
    [recordA, a.userId],
    [recordB, b.userId],
  ] as const) {
    await client.query(
      "INSERT INTO public.record_notes (record_id, author_id, title, body, updated_at) VALUES ($1, $2, 'RLS note', 'note', CURRENT_TIMESTAMP)",
      [recordId, author],
    );
  }

  const s2 = suffix();
  const patientOnlyAtB = (
    await one<{ id: string }>(
      "INSERT INTO public.patients (public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, updated_at) VALUES ($1, $2, 'RLS Patient B', DATE '1985-02-02', 'male', 'A+', '5550199', CURRENT_TIMESTAMP) RETURNING id",
      ['PT-RB' + s2, 'rlsb_' + s2],
    )
  ).id;
  await client.query(
    'INSERT INTO public.hospital_medical_records (patient_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
    [patientOnlyAtB, hospitalB],
  );
  const queue = async (hospitalId: string): Promise<string> =>
    (
      await one<{ id: string }>(
        "INSERT INTO public.queue_entries (ticket, patient_name, reason, estimated_minutes, updated_at, hospital_id) VALUES ($1, 'Queue', 'reason', 5, CURRENT_TIMESTAMP, $2) RETURNING id",
        ['R' + suffix().slice(0, 8), hospitalId],
      )
    ).id;
  const queueA = await queue(hospitalA);
  const queueB = await queue(hospitalB);
  const medicationId = (await one<{ id: string }>('SELECT id FROM public.medications LIMIT 1')).id;
  const prescriptionB = (
    await one<{ id: string }>(
      "INSERT INTO public.prescriptions (public_id, patient_id, medication_id, prescribing_doctor_id, strength, dosage, frequency, route, duration_days, quantity, instructions, start_date, end_date, updated_at, hospital_id, hospital_medical_record_id, doctor_employment_id) VALUES ($1, $2, $3, $4, '10 mg', '1 tab', 'daily', 'Oral', 7, 7, 'x', CURRENT_DATE, CURRENT_DATE + 7, CURRENT_TIMESTAMP, $5, $6, $7) RETURNING id",
      ['RX-RB' + s, patient, medicationId, b.doctorId, hospitalB, hmrB, employmentB],
    )
  ).id;

  await client.query(PROPOSAL);
  const role = 'medora_rls_probe_' + suffix();
  await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  // The proposed runtime grants: data access on every table, nothing else.
  await client.query(`GRANT USAGE ON SCHEMA public, app_rls TO ${role}`);
  await client.query(
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
  );
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_rls TO ${role}`);

  return {
    role,
    hospitalA,
    hospitalB,
    patient,
    allergyA,
    allergyB,
    allergyLegacy,
    appointmentA,
    appointmentB,
    recordA,
    recordB,
    doctorUserA: a.userId,
    doctorA: a.doctorId,
    employmentA,
    hmrA,
    hmrB,
    patientOnlyAtB,
    queueA,
    queueB,
    prescriptionB,
  };
}

/** Everything inside one transaction that is always rolled back. */
async function inProposal(work: (world: World) => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await work(await buildWorld());
  } finally {
    await client.query('ROLLBACK');
  }
}

/** Switches to the non-owner probe role with a transaction-local hospital context. */
async function asTenant(world: World, hospitalId: string | null): Promise<void> {
  await client.query('RESET ROLE');
  await client.query("SELECT set_config('app.hospital_id', $1, true)", [hospitalId ?? '']);
  await client.query(`SET LOCAL ROLE ${world.role}`);
}

async function ids(sql: string, values: unknown[] = []): Promise<string[]> {
  return (await client.query<{ id: string }>(sql, values)).rows.map((row) => row.id).sort();
}

async function rejects(sql: string, values: unknown[], code: string): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  await expect(client.query(sql, values)).rejects.toMatchObject({ code });
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
}

describe('proposed RLS policies (never applied; rolled back)', () => {
  it('1 — Hospital A cannot read Hospital B patient records, directly or through a parent', async () => {
    await inProposal(async (w) => {
      await asTenant(w, w.hospitalA);
      const hmrs = await client.query<{ hospital_id: string }>(
        'SELECT hospital_id FROM public.hospital_medical_records WHERE patient_id = $1',
        [w.patient],
      );
      expect(hmrs.rows.map((r) => r.hospital_id)).toEqual([w.hospitalA]);
      expect(
        await ids('SELECT id FROM public.patient_allergies WHERE patient_id = $1', [w.patient]),
      ).toEqual([w.allergyA]);
      expect(
        await ids(
          'SELECT record_id AS id FROM public.record_notes WHERE record_id = ANY($1::uuid[])',
          [[w.recordA, w.recordB]],
        ),
      ).toEqual([w.recordA]);
    });
  });

  it('2 — Hospital A cannot modify Hospital B patient records', async () => {
    await inProposal(async (w) => {
      await asTenant(w, w.hospitalA);
      const update = await client.query(
        "UPDATE public.patient_allergies SET reaction = 'tampered' WHERE id = $1",
        [w.allergyB],
      );
      expect(update.rowCount).toBe(0);
      const remove = await client.query('DELETE FROM public.patient_allergies WHERE id = $1', [
        w.allergyB,
      ]);
      expect(remove.rowCount).toBe(0);
      // A row stamped with Hospital B is refused by WITH CHECK (42501).
      const hmrB = (
        await client.query<{ id: string }>(
          'SELECT id FROM public.hospital_medical_records WHERE patient_id = $1',
          [w.patient],
        )
      ).rows;
      expect(hmrB).toHaveLength(1);
      await rejects(
        "INSERT INTO public.record_notes (record_id, author_id, title, body, updated_at) VALUES ($1, $2, 'x', 'x', CURRENT_TIMESTAMP)",
        [w.recordB, w.doctorUserA],
        '42501',
      );
      // Unchanged, read back as the owner.
      await client.query('RESET ROLE');
      const row = await one<{ reaction: string }>(
        'SELECT reaction FROM public.patient_allergies WHERE id = $1',
        [w.allergyB],
      );
      expect(row.reaction).toBe('rash');
    });
  });

  it('3 — Hospital A cannot access Hospital B appointments', async () => {
    await inProposal(async (w) => {
      await asTenant(w, w.hospitalA);
      expect(
        await ids('SELECT id FROM public.appointments WHERE id = ANY($1::uuid[])', [
          [w.appointmentA, w.appointmentB],
        ]),
      ).toEqual([w.appointmentA]);
      const update = await client.query(
        "UPDATE public.appointments SET reason = 'tampered' WHERE id = $1",
        [w.appointmentB],
      );
      expect(update.rowCount).toBe(0);
    });
  });

  it('4–6 — effective employment: ended, suspended or deleted doctor, and unavailable hospital yield no hospital; history is kept', async () => {
    await inProposal(async (w) => {
      const effective = async (): Promise<string[]> =>
        (
          await client.query<{ h: string | null }>(
            'SELECT app_rls.effective_doctor_hospital($1) AS h',
            [w.doctorUserA],
          )
        ).rows
          .map((r) => r.h)
          .filter((h): h is string => h !== null);
      expect(await effective()).toEqual([w.hospitalA]);

      for (const [label, change, undo] of [
        [
          'practice suspended',
          "UPDATE public.doctors SET practice_status = 'suspended' WHERE id = $1",
          "UPDATE public.doctors SET practice_status = 'active' WHERE id = $1",
        ],
        [
          'profile soft-deleted',
          'UPDATE public.doctors SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
          'UPDATE public.doctors SET deleted_at = NULL WHERE id = $1',
        ],
      ] as const) {
        await client.query(change, [w.doctorA]);
        expect(await effective(), label).toEqual([]);
        await client.query(undo, [w.doctorA]);
      }
      for (const [label, change, undo] of [
        [
          'hospital suspended',
          "UPDATE public.hospitals SET status = 'SUSPENDED' WHERE id = $1",
          "UPDATE public.hospitals SET status = 'ACTIVE' WHERE id = $1",
        ],
        [
          'hospital soft-deleted',
          'UPDATE public.hospitals SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1',
          'UPDATE public.hospitals SET deleted_at = NULL WHERE id = $1',
        ],
      ] as const) {
        await client.query(change, [w.hospitalA]);
        expect(await effective(), label).toEqual([]);
        await client.query(undo, [w.hospitalA]);
      }
      // VACATION is on the proposal's allow-list (open policy question, RLS_DESIGN.md §6).
      await client.query("UPDATE public.doctors SET practice_status = 'vacation' WHERE id = $1", [
        w.doctorA,
      ]);
      expect(await effective()).toEqual([w.hospitalA]);
      await client.query("UPDATE public.doctors SET practice_status = 'active' WHERE id = $1", [
        w.doctorA,
      ]);

      await client.query(
        'UPDATE public.doctor_employments SET ended_at = CURRENT_TIMESTAMP WHERE id = $1',
        [w.employmentA],
      );
      expect(await effective()).toEqual([]);
      const history = await one<{ n: string }>(
        'SELECT count(*) AS n FROM public.doctor_employments WHERE id = $1',
        [w.employmentA],
      );
      expect(Number(history.n)).toBe(1);
    });
  });

  it('7 — tenant resolution cannot become ambiguous: a second active employment or staff affiliation is refused', async () => {
    await inProposal(async (w) => {
      await rejects(
        'INSERT INTO public.doctor_employments (doctor_id, hospital_id, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
        [w.doctorA, w.hospitalB],
        '23505',
      );
      const effective = await client.query('SELECT app_rls.effective_doctor_hospital($1) AS h', [
        w.doctorUserA,
      ]);
      expect(effective.rows).toHaveLength(1);
    });
  });

  it('8 — a transaction-local context does not survive on a reused connection; a session-level one would', async () => {
    // One connection, as a pool hands it from request to request.
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.hospital_id', $1, true)", [randomUUID()]);
    await client.query('COMMIT');
    const afterLocal = await one<{ v: string | null }>(
      "SELECT current_setting('app.hospital_id', true) AS v",
    );
    expect(afterLocal.v ?? '').toBe('');

    // The hazard the contract must forbid: session-level context leaks.
    const leaked = randomUUID();
    await client.query("SELECT set_config('app.hospital_id', $1, false)", [leaked]);
    await client.query('BEGIN');
    const nextRequest = await one<{ v: string }>(
      "SELECT current_setting('app.hospital_id', true) AS v",
    );
    await client.query('COMMIT');
    await client.query('RESET app.hospital_id');
    expect(nextRequest.v).toBe(leaked);
  });

  it('9 — missing, empty or malformed context sees nothing and writes nothing', async () => {
    await inProposal(async (w) => {
      for (const context of [null, 'not-a-uuid']) {
        await client.query('RESET ROLE');
        if (context === null) await client.query("SELECT set_config('app.hospital_id', '', true)");
        else await client.query("SELECT set_config('app.hospital_id', $1, true)", [context]);
        await client.query(`SET LOCAL ROLE ${w.role}`);
        expect(
          await ids('SELECT id FROM public.patient_allergies WHERE patient_id = $1', [w.patient]),
        ).toEqual([]);
        expect(
          await ids('SELECT id FROM public.appointments WHERE id = ANY($1::uuid[])', [
            [w.appointmentA, w.appointmentB],
          ]),
        ).toEqual([]);
        await rejects(
          "INSERT INTO public.record_notes (record_id, author_id, title, body, updated_at) VALUES ($1, $2, 'x', 'x', CURRENT_TIMESTAMP)",
          [w.recordA, w.doctorUserA],
          '42501',
        );
      }
    });
  });

  it('legacy rows with no hospital owner are invisible to every tenant (activation blocker)', async () => {
    await inProposal(async (w) => {
      for (const tenant of [w.hospitalA, w.hospitalB]) {
        await asTenant(w, tenant);
        const seen = await ids('SELECT id FROM public.patient_allergies WHERE patient_id = $1', [
          w.patient,
        ]);
        expect(seen).not.toContain(w.allergyLegacy);
      }
    });
  });

  it('10 — no privileged cross-hospital policy exists: only the owner/superuser connection bypasses RLS (OD-07 pending)', async () => {
    await inProposal(async (w) => {
      // The probe role, even with A's context, never sees B — there is no
      // admin policy, because OD-07 has not decided one.
      await asTenant(w, w.hospitalA);
      expect(
        await ids('SELECT id FROM public.patient_allergies WHERE id = $1', [w.allergyB]),
      ).toEqual([]);

      // The connecting role (table owner, superuser in CI) bypasses every
      // policy, even with FORCE — which is why activation needs a separate
      // non-owner application role.
      await client.query('RESET ROLE');
      await client.query('ALTER TABLE public.patient_allergies FORCE ROW LEVEL SECURITY');
      const owner = await one<{ rolsuper: boolean }>(
        'SELECT rolsuper FROM pg_roles WHERE rolname = current_user',
      );
      const seenByOwner = await ids(
        'SELECT id FROM public.patient_allergies WHERE patient_id = $1',
        [w.patient],
      );
      if (owner.rolsuper) {
        expect(seenByOwner).toEqual([w.allergyA, w.allergyB, w.allergyLegacy].sort());
      } else {
        // A non-superuser owner IS bound by FORCE; with no context it sees nothing.
        expect(seenByOwner).toEqual([]);
      }
    });
  });

  it('covers every Direct and Indirect table of the inventory with RLS and at least one policy', async () => {
    const doc = readFileSync(resolve(__dirname, '../../docs/multi-hospital/RLS_DESIGN.md'), 'utf8');
    const required = doc
      .slice(doc.indexOf('## Appendix A'))
      .split('\n')
      .filter((line) => line.startsWith('| `'))
      .map((line) => line.split(' | '))
      .filter((cells) => cells[1] === 'Direct' || cells[1] === 'Indirect')
      .map((cells) => cells[0]!.replace(/^\| `|`$/g, ''));
    expect(required.length).toBeGreaterThan(60);
    await inProposal(async () => {
      const covered = await client.query<{ relname: string; enabled: boolean; policies: string }>(
        "SELECT c.relname, c.relrowsecurity AS enabled, (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[])",
        [required],
      );
      const gaps = covered.rows
        .filter((r) => !r.enabled || Number(r.policies) === 0)
        .map((r) => r.relname);
      expect(gaps).toEqual([]);
      expect(covered.rows).toHaveLength(required.length);
    });
  });

  it('INSERT and DELETE: allowed in the own hospital, refused or no-op for another', async () => {
    await inProposal(async (w) => {
      await asTenant(w, w.hospitalA);
      const own = await client.query(
        "INSERT INTO public.patient_allergies (patient_id, allergen, severity, reaction, updated_at, hospital_id, hospital_medical_record_id) VALUES ($1, 'A-own', 'mild', 'rash', CURRENT_TIMESTAMP, $2, $3) RETURNING id",
        [w.patient, w.hospitalA, w.hmrA],
      );
      expect(own.rowCount).toBe(1);
      await rejects(
        "INSERT INTO public.patient_allergies (patient_id, allergen, severity, reaction, updated_at, hospital_id, hospital_medical_record_id) VALUES ($1, 'B-forged', 'mild', 'rash', CURRENT_TIMESTAMP, $2, $3)",
        [w.patient, w.hospitalB, w.hmrB],
        '42501',
      );
      expect(
        (await client.query('DELETE FROM public.patient_allergies WHERE id = $1', [w.allergyB]))
          .rowCount,
      ).toBe(0);
      expect(
        (await client.query('DELETE FROM public.patient_allergies WHERE id = $1', [w.allergyA]))
          .rowCount,
      ).toBe(1);
    });
  });

  it('foreign-key boundary: an own-hospital row cannot point at another hospital record', async () => {
    await inProposal(async (w) => {
      await asTenant(w, w.hospitalA);
      // Passes WITH CHECK (hospital A) but the composite FK has no (HMR of B, hospital A) row.
      await rejects(
        "INSERT INTO public.patient_allergies (patient_id, allergen, severity, reaction, updated_at, hospital_id, hospital_medical_record_id) VALUES ($1, 'A-mixed', 'mild', 'rash', CURRENT_TIMESTAMP, $2, $3)",
        [w.patient, w.hospitalA, w.hmrB],
        '23503',
      );
      // A trigger runs as the invoker and sees only the tenant's parents: B's
      // prescription is invisible, so the scoped link is refused.
      await rejects(
        "INSERT INTO public.patient_medications (patient_id, name, dosage, frequency, start_date, updated_at, prescription_id, hospital_id, hospital_medical_record_id) VALUES ($1, 'x', '1', 'daily', CURRENT_DATE, CURRENT_TIMESTAMP, $2, $3, $4)",
        [w.patient, w.prescriptionB, w.hospitalA, w.hmrA],
        '23514',
      );
    });
  });

  it('queue records: each hospital sees and changes only its own (#21)', async () => {
    await inProposal(async (w) => {
      await asTenant(w, w.hospitalA);
      expect(
        await ids('SELECT id FROM public.queue_entries WHERE id = ANY($1::uuid[])', [
          [w.queueA, w.queueB],
        ]),
      ).toEqual([w.queueA]);
      expect(
        (
          await client.query("UPDATE public.queue_entries SET reason = 'x' WHERE id = $1", [
            w.queueB,
          ])
        ).rowCount,
      ).toBe(0);
      await rejects(
        "INSERT INTO public.queue_entries (ticket, patient_name, reason, estimated_minutes, updated_at, hospital_id) VALUES ('RX1', 'Q', 'r', 1, CURRENT_TIMESTAMP, $1)",
        [w.hospitalB],
        '42501',
      );
    });
  });

  it('patient identity: visible only where the hospital holds a record; creating a patient is denied until B8 is decided', async () => {
    await inProposal(async (w) => {
      await asTenant(w, w.hospitalA);
      expect(
        await ids('SELECT id FROM public.patients WHERE id = ANY($1::uuid[])', [
          [w.patient, w.patientOnlyAtB],
        ]),
      ).toEqual([w.patient]);
      expect(
        (
          await client.query("UPDATE public.patients SET phone = '1' WHERE id = $1", [
            w.patientOnlyAtB,
          ])
        ).rowCount,
      ).toBe(0);
      await rejects(
        "INSERT INTO public.patients (public_id, mrn, full_name, date_of_birth, gender, blood_type, phone, updated_at) VALUES ('PT-RNEW1', 'rlsnew1', 'New', DATE '2000-01-01', 'female', 'O+', '1', CURRENT_TIMESTAMP)",
        [],
        '42501',
      );
      await asTenant(w, w.hospitalB);
      expect(
        await ids('SELECT id FROM public.patients WHERE id = ANY($1::uuid[])', [
          [w.patient, w.patientOnlyAtB],
        ]),
      ).toEqual([w.patient, w.patientOnlyAtB].sort());
    });
  });
});

describe('concurrent transactions on separate connections (committed scratch objects, dropped afterwards)', () => {
  // Policies must be visible to two sessions at once, so this suite commits —
  // but only a dedicated scratch schema and role, never the real tables.
  const tag = suffix();
  const schema = 'rls_conc_' + tag;
  const role = 'medora_rls_conc_' + tag;
  const a = randomUUID();
  const b = randomUUID();
  const sessionA = new Client({ connectionString: rawDatabaseUrl });
  const sessionB = new Client({ connectionString: rawDatabaseUrl });

  async function dropLeftovers(): Promise<void> {
    const stale = await client.query<{ nspname: string }>(
      "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'rls\\_conc\\_%'",
    );
    for (const row of stale.rows) await client.query(`DROP SCHEMA ${row.nspname} CASCADE`);
    const staleRoles = await client.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE rolname LIKE 'medora\\_rls\\_conc\\_%'",
    );
    for (const row of staleRoles.rows) await client.query(`DROP ROLE ${row.rolname}`);
  }

  beforeAll(async () => {
    await dropLeftovers();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(
      `CREATE TABLE ${schema}.owned (id serial PRIMARY KEY, hospital_id uuid NOT NULL, note text)`,
    );
    await client.query(
      `INSERT INTO ${schema}.owned (hospital_id, note) VALUES ($1, 'a'), ($2, 'b')`,
      [a, b],
    );
    await client.query(`ALTER TABLE ${schema}.owned ENABLE ROW LEVEL SECURITY`);
    await client.query(
      `CREATE POLICY owned_tenant ON ${schema}.owned FOR ALL USING (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid) WITH CHECK (hospital_id = NULLIF(current_setting('app.hospital_id', true), '')::uuid)`,
    );
    await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${schema}.owned TO ${role}`);
    await client.query(`GRANT USAGE ON SEQUENCE ${schema}.owned_id_seq TO ${role}`);
    await Promise.all([sessionA.connect(), sessionB.connect()]);
  }, 15_000);

  afterAll(async () => {
    await Promise.allSettled([sessionA.end(), sessionB.end()]);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await client.query(`DROP ROLE IF EXISTS ${role}`);
    const residue = await client.query(
      'SELECT 1 FROM pg_namespace WHERE nspname = $1 UNION ALL SELECT 1 FROM pg_roles WHERE rolname = $2',
      [schema, role],
    );
    expect(residue.rowCount).toBe(0);
  });

  async function begin(session: Client, hospital: string): Promise<void> {
    await session.query('BEGIN');
    await session.query("SELECT set_config('app.hospital_id', $1, true)", [hospital]);
    await session.query(`SET LOCAL ROLE ${role}`);
  }

  it('two interleaved transactions with different hospitals each see and write only their own rows', async () => {
    await begin(sessionA, a);
    await begin(sessionB, b);
    try {
      const seenA = await sessionA.query<{ note: string }>(
        `SELECT note FROM ${schema}.owned ORDER BY note`,
      );
      const seenB = await sessionB.query<{ note: string }>(
        `SELECT note FROM ${schema}.owned ORDER BY note`,
      );
      expect(seenA.rows.map((r) => r.note)).toEqual(['a']);
      expect(seenB.rows.map((r) => r.note)).toEqual(['b']);
      await sessionA.query(`INSERT INTO ${schema}.owned (hospital_id, note) VALUES ($1, 'a2')`, [
        a,
      ]);
      const updatedByB = await sessionB.query(
        `UPDATE ${schema}.owned SET note = 'x' WHERE hospital_id = $1`,
        [a],
      );
      expect(updatedByB.rowCount).toBe(0);
      // Last: the refusal aborts session B's transaction.
      await expect(
        sessionB.query(`INSERT INTO ${schema}.owned (hospital_id, note) VALUES ($1, 'forged')`, [
          a,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await Promise.all([sessionA.query('ROLLBACK'), sessionB.query('ROLLBACK')]);
    }
  });

  it('a reused connection starts the next transaction with no context and sees nothing', async () => {
    await begin(sessionA, a);
    await sessionA.query('COMMIT');
    await sessionA.query('BEGIN');
    await sessionA.query(`SET LOCAL ROLE ${role}`);
    try {
      const seen = await sessionA.query(`SELECT note FROM ${schema}.owned`);
      expect(seen.rowCount).toBe(0);
    } finally {
      await sessionA.query('ROLLBACK');
    }
  });
});
