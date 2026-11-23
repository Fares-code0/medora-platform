/**
 * Legacy hospital-ownership backfill — DRY RUN ONLY (multi-hospital §2.12,
 * fix-list item 17).
 *
 * Rows written before multi-hospital attribution carry `hospital_id IS
 * NULL`. This tool proposes an owner for each such row **only from
 * evidence**, and changes nothing:
 *
 * - It runs inside a `READ ONLY` transaction. PostgreSQL itself refuses any
 *   write, so a bug here cannot assign anything.
 * - It refuses to start when `NODE_ENV=production`, or without the explicit
 *   acknowledgement `MEDORA_BACKFILL_DRY_RUN=non-production`. Production
 *   backfill is a separate, reviewed operation (see the PR's production
 *   steps); this tool exists to measure and review the evidence first.
 * - No NULL is ever defaulted. A row with no evidence, or with conflicting
 *   evidence, is reported `unresolved` and stays isolated — invisible to
 *   every hospital — until a human decides.
 *
 * Evidence rules, strongest first. A row is proposed only when every rule
 * that applies to it agrees on exactly one hospital:
 *
 * | Rule | Applies to | Evidence |
 * | --- | --- | --- |
 * | `employment_stamp` | rows with `doctor_employment_id` | that employment's hospital |
 * | `record_stamp` | rows with `hospital_medical_record_id` | that record's hospital |
 * | `employment_at_time` | rows with a doctor column | the one employment of that doctor whose `[started_at, ended_at)` covers the row's timestamp |
 * | `single_patient_record` | rows with `patient_id` | the patient's only Hospital Medical Record |
 *
 * A future real backfill writes each accepted proposal together with an
 * `ownership_assignments` row holding the rule and its evidence (append-only
 * by trigger), so every assignment stays explainable. That writer is not
 * part of this change.
 *
 * Usage (non-production database only):
 *   MEDORA_BACKFILL_DRY_RUN=non-production npx tsx prisma/backfill/ownership-dry-run.ts [--json]
 */

import 'dotenv/config';

import { Client } from 'pg';

interface TableRule {
  readonly table: string;
  /** Column holding the row's timestamp for `employment_at_time`. */
  readonly at: string;
  readonly doctorColumn?: string;
  readonly hasEmployment: boolean;
  readonly hasRecord: boolean;
  readonly hasPatient: boolean;
}

/** Tables whose `hospital_id` is nullable and may hold legacy rows. */
export const TABLES: readonly TableRule[] = [
  { table: 'appointments', at: 'starts_at', doctorColumn: 'doctor_id', hasEmployment: true, hasRecord: true, hasPatient: true },
  { table: 'medical_records', at: 'created_at', doctorColumn: 'doctor_id', hasEmployment: true, hasRecord: true, hasPatient: true },
  { table: 'lab_orders', at: 'created_at', doctorColumn: 'ordered_by', hasEmployment: true, hasRecord: true, hasPatient: true },
  { table: 'prescriptions', at: 'created_at', doctorColumn: 'prescribing_doctor_id', hasEmployment: true, hasRecord: true, hasPatient: true },
  { table: 'patient_doctor_assignments', at: 'assigned_at', doctorColumn: 'doctor_id', hasEmployment: true, hasRecord: true, hasPatient: true },
  { table: 'doctor_availability', at: 'created_at', doctorColumn: 'doctor_id', hasEmployment: true, hasRecord: false, hasPatient: false },
  { table: 'doctor_time_off', at: 'starts_at', doctorColumn: 'doctor_id', hasEmployment: true, hasRecord: false, hasPatient: false },
  { table: 'ai_conversations', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'conversations', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'notifications', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_allergies', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_clinical_alerts', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_documents', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_medical_history', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_medications', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_notes', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_studies', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'patient_vital_signs', at: 'created_at', hasEmployment: false, hasRecord: true, hasPatient: true },
  { table: 'queue_entries', at: 'created_at', hasEmployment: false, hasRecord: false, hasPatient: true },
];

export interface Proposal {
  readonly table: string;
  readonly rowId: string;
  readonly hospitalId: string | null;
  readonly status: 'proposed' | 'unresolved';
  readonly reason: string;
  readonly evidence: Record<string, string[]>;
}

/** The SQL for one table: every legacy row with each rule's candidate set. */
export function evidenceQuery(rule: TableRule): string {
  const parts: string[] = [];
  if (rule.hasEmployment) {
    parts.push(`ARRAY(SELECT de.hospital_id::text FROM doctor_employments de
                       WHERE de.id = t.doctor_employment_id) AS employment_stamp`);
  }
  if (rule.hasRecord) {
    parts.push(`ARRAY(SELECT hmr.hospital_id::text FROM hospital_medical_records hmr
                       WHERE hmr.id = t.hospital_medical_record_id) AS record_stamp`);
  }
  if (rule.doctorColumn !== undefined) {
    parts.push(`ARRAY(SELECT DISTINCT de.hospital_id::text FROM doctor_employments de
                       WHERE de.doctor_id = t.${rule.doctorColumn}
                         AND de.started_at <= t.${rule.at}
                         AND (de.ended_at IS NULL OR de.ended_at > t.${rule.at})) AS employment_at_time`);
  }
  if (rule.hasPatient) {
    parts.push(`CASE WHEN (SELECT count(*) FROM hospital_medical_records hmr
                            WHERE hmr.patient_id = t.patient_id) = 1
                     THEN ARRAY(SELECT hmr.hospital_id::text FROM hospital_medical_records hmr
                                 WHERE hmr.patient_id = t.patient_id)
                     ELSE NULL END AS single_patient_record`);
  }
  return `SELECT t.id::text AS id, ${parts.join(',\n       ')}
            FROM ${rule.table} t
           WHERE t.hospital_id IS NULL`;
}

/** Combines a row's rule results into one proposal (pure; unit-testable). */
export function decide(table: string, row: Record<string, unknown>): Proposal {
  const evidence: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'id' || value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length > 0) evidence[key] = value.map(String);
  }
  const rowId = String(row['id']);
  const rules = Object.entries(evidence);
  if (rules.length === 0) {
    return { table, rowId, hospitalId: null, status: 'unresolved', reason: 'no_evidence', evidence };
  }
  const ambiguous = rules.find(([, hospitals]) => hospitals.length > 1);
  if (ambiguous !== undefined) {
    return { table, rowId, hospitalId: null, status: 'unresolved', reason: `ambiguous:${ambiguous[0]}`, evidence };
  }
  const candidates = new Set(rules.map(([, hospitals]) => hospitals[0]));
  if (candidates.size !== 1) {
    return { table, rowId, hospitalId: null, status: 'unresolved', reason: 'conflicting_evidence', evidence };
  }
  const [hospitalId] = [...candidates];
  return {
    table,
    rowId,
    hospitalId: hospitalId ?? null,
    status: 'proposed',
    reason: rules.map(([name]) => name).join('+'),
    evidence,
  };
}

export function assertNonProduction(env: NodeJS.ProcessEnv): void {
  if (env['NODE_ENV'] === 'production') {
    throw new Error('Refusing to run: NODE_ENV=production. This tool is dry-run only and never runs against production.');
  }
  if (env['MEDORA_BACKFILL_DRY_RUN'] !== 'non-production') {
    throw new Error('Refusing to run: set MEDORA_BACKFILL_DRY_RUN=non-production to acknowledge this is a non-production database.');
  }
}

async function main(): Promise<void> {
  assertNonProduction(process.env);
  const url = process.env['DATABASE_URL'];
  if (url === undefined) throw new Error('DATABASE_URL is not set');

  const client = new Client({ connectionString: url });
  await client.connect();
  const proposals: Proposal[] = [];
  try {
    // PostgreSQL enforces this: no statement below can write.
    await client.query('BEGIN TRANSACTION READ ONLY');
    for (const rule of TABLES) {
      const result = await client.query<Record<string, unknown>>(evidenceQuery(rule));
      for (const row of result.rows) proposals.push(decide(rule.table, row));
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }

  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(proposals, null, 2)}\n`);
    return;
  }
  const summary = new Map<string, { proposed: number; unresolved: number }>();
  for (const proposal of proposals) {
    const entry = summary.get(proposal.table) ?? { proposed: 0, unresolved: 0 };
    entry[proposal.status] += 1;
    summary.set(proposal.table, entry);
  }
  process.stdout.write('Ownership backfill DRY RUN — nothing was written.\n');
  for (const [table, counts] of summary) {
    process.stdout.write(`  ${table}: ${counts.proposed} proposed, ${counts.unresolved} unresolved (stay isolated)\n`);
  }
  if (summary.size === 0) process.stdout.write('  No legacy rows with hospital_id IS NULL.\n');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
