import type { ClientBase } from 'pg';

/**
 * Evidence-based legacy ownership backfill for `patient_doctor_assignments`
 * (enforcement stage S2, docs/multi-hospital/BACKEND_ENFORCEMENT_INVENTORY.md §4).
 *
 * A legacy assignment predates hospitals: its `hospital_id`,
 * `doctor_employment_id` and `hospital_medical_record_id` are NULL. Which
 * hospital owns such a row is an open owner decision (GitHub issue #17, RLS
 * blocker B3), so this tool never guesses. It fills a row only when the data
 * already in the database proves its owner unambiguously, and reports every
 * other row, untouched, with the reason.
 *
 * The rules (docs/multi-hospital/LEGACY_OWNERSHIP_BACKFILL.md):
 *
 *  1. Candidates are rows with `hospital_id IS NULL`. The CHECK constraints
 *     `…_employment_scope_check` and `…_hospital_scope_pair_check` make the
 *     three scope columns all-NULL or all-set, so such a row is fully unowned.
 *  2. Revoked rows (`revoked_at IS NOT NULL`) are reported as `revoked` and
 *     never written: authorization only reads live assignments, and pinning
 *     history to a hospital is part of the #17 decision, not evidence.
 *  3. The instant is the assignment's own `assigned_at` (the table has no
 *     other creation timestamp). An employment of the same doctor covers it
 *     when `started_at <= assigned_at < COALESCE(ended_at, 'infinity')`.
 *     Zero covering employments → `no_employment`; more than one →
 *     `ambiguous_employment`.
 *  4. If the single covering employment has since ended → `employment_ended`.
 *     The data proves where the assignment began, but the row is still live
 *     while the doctor no longer works there; owning it would pin it, for
 *     good (`prevent_tenant_scope_reassignment`), to a hospital the doctor
 *     has left. Whether such a row is revoked or transferred is #17's call.
 *  5. The hospital medical record is the patient's record at that
 *     employment's hospital. None → `no_hospital_record` (one is never
 *     created here); more than one → `ambiguous_hospital_record` (unreachable
 *     while `hospital_medical_records_patient_hospital_key` holds, kept so the
 *     rule does not silently depend on it).
 *  6. Otherwise → `proven`: the three columns are written together.
 *
 * Writes go through ordinary UPDATEs, so every FK, CHECK and trigger on the
 * table (the composite scope FKs, the pairing CHECKs, and the immutability
 * trigger `hospitalscope_patient_assignments_trg`) applies unchanged.
 */

export const CLASSIFICATIONS = [
  'proven',
  'revoked',
  'no_employment',
  'ambiguous_employment',
  'employment_ended',
  'no_hospital_record',
  'ambiguous_hospital_record',
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export const REASONS: Readonly<Record<Classification, string>> = {
  proven:
    "Exactly one employment of the doctor covers assigned_at, it is still active, and the patient has exactly one medical record at that employment's hospital.",
  revoked: 'Revoked assignment: out of scope; never written.',
  no_employment: 'No employment of the doctor covers assigned_at.',
  ambiguous_employment: 'More than one employment of the doctor covers assigned_at.',
  employment_ended:
    'The only employment covering assigned_at has ended while the assignment is still live.',
  no_hospital_record: "The patient has no medical record at the employment's hospital.",
  ambiguous_hospital_record:
    "The patient has more than one medical record at the employment's hospital.",
};

/** What the database says about one unowned assignment. */
export interface AssignmentFacts {
  readonly assignmentId: string;
  readonly patientId: string;
  readonly doctorId: string;
  readonly role: string;
  readonly assignedAt: Date;
  readonly revokedAt: Date | null;
  /** Employments of the doctor covering `assignedAt`. */
  readonly coveringEmploymentCount: number;
  /** Set only when `coveringEmploymentCount === 1`. */
  readonly employmentId: string | null;
  readonly employmentHospitalId: string | null;
  readonly employmentEndedAt: Date | null;
  /** The patient's records at `employmentHospitalId`; null when there is no single employment. */
  readonly hospitalRecordCount: number | null;
  /** Set only when `hospitalRecordCount === 1`. */
  readonly hospitalMedicalRecordId: string | null;
}

export interface ClassifiedAssignment {
  readonly assignmentId: string;
  readonly patientId: string;
  readonly doctorId: string;
  readonly role: string;
  readonly assignedAt: string;
  readonly revokedAt: string | null;
  readonly classification: Classification;
  readonly reason: string;
  readonly coveringEmploymentCount: number;
  readonly hospitalRecordCount: number | null;
  /** The derived owner; non-null only for `proven`. */
  readonly hospitalId: string | null;
  readonly doctorEmploymentId: string | null;
  readonly hospitalMedicalRecordId: string | null;
}

export interface BackfillReport {
  readonly mode: 'dry-run' | 'apply';
  readonly database: string;
  readonly snapshotAt: string;
  readonly candidates: number;
  readonly counts: Readonly<Record<Classification, number>>;
  readonly rowsUpdated: number;
  readonly rows: readonly ClassifiedAssignment[];
}

export interface BackfillOptions {
  readonly apply: boolean;
  /** `APP_ENV` of the caller; `--apply` is refused for `production`. */
  readonly appEnv: string | undefined;
}

/** The pure decision for one row. Order matters: the first failing rule wins. */
export function classifyAssignment(facts: AssignmentFacts): Classification {
  if (facts.revokedAt !== null) return 'revoked';
  if (facts.coveringEmploymentCount === 0) return 'no_employment';
  if (facts.coveringEmploymentCount > 1) return 'ambiguous_employment';
  if (facts.employmentEndedAt !== null) return 'employment_ended';
  if (facts.hospitalRecordCount === null || facts.hospitalRecordCount === 0) {
    return 'no_hospital_record';
  }
  if (facts.hospitalRecordCount > 1) return 'ambiguous_hospital_record';
  return 'proven';
}

export function toClassified(facts: AssignmentFacts): ClassifiedAssignment {
  const classification = classifyAssignment(facts);
  const proven = classification === 'proven';
  return {
    assignmentId: facts.assignmentId,
    patientId: facts.patientId,
    doctorId: facts.doctorId,
    role: facts.role,
    assignedAt: facts.assignedAt.toISOString(),
    revokedAt: facts.revokedAt?.toISOString() ?? null,
    classification,
    reason: REASONS[classification],
    coveringEmploymentCount: facts.coveringEmploymentCount,
    hospitalRecordCount: facts.hospitalRecordCount,
    hospitalId: proven ? facts.employmentHospitalId : null,
    doctorEmploymentId: proven ? facts.employmentId : null,
    hospitalMedicalRecordId: proven ? facts.hospitalMedicalRecordId : null,
  };
}

export function assertApplyPermitted(appEnv: string | undefined): void {
  if (appEnv === 'production') {
    // Deliberately a hard failure, as in prisma/seed.ts: no production data
    // change is authorized until the #17 owner decision.
    throw new Error(
      'Refusing to apply the legacy assignment ownership backfill to a production database (APP_ENV=production); activation waits on the #17 owner decision.',
    );
  }
}

/**
 * Facts for every unowned assignment, read in the caller's transaction.
 * Revoked rows are listed but not derived.
 */
const FACTS_SQL = `
SELECT a.id AS assignment_id,
       a.patient_id,
       a.doctor_id,
       a.role,
       a.assigned_at,
       a.revoked_at,
       COALESCE(cov.n, 0)::int AS covering_employment_count,
       cov.employment_id,
       cov.hospital_id AS employment_hospital_id,
       cov.ended_at AS employment_ended_at,
       hmr.n::int AS hospital_record_count,
       hmr.record_id AS hospital_medical_record_id
  FROM public.patient_doctor_assignments a
  LEFT JOIN LATERAL (
    SELECT count(*) AS n,
           CASE WHEN count(*) = 1 THEN (array_agg(e.id))[1] END AS employment_id,
           CASE WHEN count(*) = 1 THEN (array_agg(e.hospital_id))[1] END AS hospital_id,
           CASE WHEN count(*) = 1 THEN (array_agg(e.ended_at))[1] END AS ended_at
      FROM public.doctor_employments e
     WHERE e.doctor_id = a.doctor_id
       AND e.started_at <= a.assigned_at
       AND a.assigned_at < COALESCE(e.ended_at, 'infinity'::timestamptz)
  ) cov ON a.revoked_at IS NULL
  LEFT JOIN LATERAL (
    SELECT count(*) AS n,
           CASE WHEN count(*) = 1 THEN (array_agg(r.id))[1] END AS record_id
      FROM public.hospital_medical_records r
     WHERE r.patient_id = a.patient_id
       AND r.hospital_id = cov.hospital_id
  ) hmr ON cov.n = 1
 WHERE a.hospital_id IS NULL
 ORDER BY a.assigned_at, a.id`;

interface FactsRow {
  assignment_id: string;
  patient_id: string;
  doctor_id: string;
  role: string;
  assigned_at: Date;
  revoked_at: Date | null;
  covering_employment_count: number;
  employment_id: string | null;
  employment_hospital_id: string | null;
  employment_ended_at: Date | null;
  hospital_record_count: number | null;
  hospital_medical_record_id: string | null;
}

async function readFacts(client: ClientBase): Promise<AssignmentFacts[]> {
  const result = await client.query<FactsRow>(FACTS_SQL);
  return result.rows.map((row) => ({
    assignmentId: row.assignment_id,
    patientId: row.patient_id,
    doctorId: row.doctor_id,
    role: row.role,
    assignedAt: row.assigned_at,
    revokedAt: row.revoked_at,
    coveringEmploymentCount: row.covering_employment_count,
    employmentId: row.employment_id,
    employmentHospitalId: row.employment_hospital_id,
    employmentEndedAt: row.employment_ended_at,
    hospitalRecordCount: row.hospital_record_count,
    hospitalMedicalRecordId: row.hospital_medical_record_id,
  }));
}

function countsOf(rows: readonly ClassifiedAssignment[]): Record<Classification, number> {
  const counts = Object.fromEntries(CLASSIFICATIONS.map((c) => [c, 0])) as Record<
    Classification,
    number
  >;
  for (const row of rows) counts[row.classification] += 1;
  return counts;
}

/**
 * Writes the proven rows. Each row is re-checked in the UPDATE itself: it
 * must still be live and wholly unowned, so a row owned since the snapshot
 * (or by a previous run) is never touched again.
 */
async function writeProven(
  client: ClientBase,
  rows: readonly ClassifiedAssignment[],
): Promise<number> {
  const proven = rows.filter((row) => row.classification === 'proven');
  if (proven.length === 0) return 0;
  const result = await client.query(
    `UPDATE public.patient_doctor_assignments a
        SET hospital_id = p.hospital_id,
            doctor_employment_id = p.doctor_employment_id,
            hospital_medical_record_id = p.hospital_medical_record_id
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[])
            AS p(id, hospital_id, doctor_employment_id, hospital_medical_record_id)
      WHERE a.id = p.id
        AND a.hospital_id IS NULL
        AND a.doctor_employment_id IS NULL
        AND a.hospital_medical_record_id IS NULL
        AND a.revoked_at IS NULL`,
    [
      proven.map((row) => row.assignmentId),
      proven.map((row) => row.hospitalId),
      proven.map((row) => row.doctorEmploymentId),
      proven.map((row) => row.hospitalMedicalRecordId),
    ],
  );
  return result.rowCount ?? 0;
}

/**
 * Runs the report, and with `apply` the backfill, in one transaction on a
 * connected client that has no transaction open.
 *
 * Dry run: `REPEATABLE READ READ ONLY` — one consistent snapshot, and the
 * database itself rejects any write. Apply: `SERIALIZABLE` — the evidence
 * read and the writes commit together or not at all; a concurrent change to
 * an assignment, employment or medical record it read aborts the run with a
 * serialization failure instead of writing on stale evidence (rerun it).
 */
export async function runLegacyAssignmentBackfill(
  client: ClientBase,
  options: BackfillOptions,
): Promise<BackfillReport> {
  if (options.apply) assertApplyPermitted(options.appEnv);

  await client.query(
    options.apply
      ? 'BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE'
      : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  try {
    const identity = await client.query<{ database: string; snapshot_at: Date }>(
      'SELECT current_database() AS database, now() AS snapshot_at',
    );
    const rows = (await readFacts(client)).map(toClassified);
    const rowsUpdated = options.apply ? await writeProven(client, rows) : 0;
    await client.query(options.apply ? 'COMMIT' : 'ROLLBACK');
    return {
      mode: options.apply ? 'apply' : 'dry-run',
      database: identity.rows[0]?.database ?? '',
      snapshotAt: identity.rows[0]?.snapshot_at.toISOString() ?? '',
      candidates: rows.length,
      counts: countsOf(rows),
      rowsUpdated,
      rows,
    };
  } catch (error) {
    // Keep the original error; a failed ROLLBACK would only hide it.
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}
