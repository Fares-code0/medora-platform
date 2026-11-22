import { spawnSync } from 'node:child_process';
import path from 'node:path';

const backendRoot = process.cwd();
const prismaCli = path.join(backendRoot, 'node_modules', 'prisma', 'build', 'index.js');
const result = spawnSync(
  process.execPath,
  [
    prismaCli,
    'migrate',
    'diff',
    '--from-config-datasource',
    '--to-schema',
    'prisma/schema',
    '--script',
  ],
  { cwd: backendRoot, encoding: 'utf8' },
);

if (result.error) {
  console.error('Could not run Prisma schema diff:', result.error.message);
  process.exit(1);
}

if (result.status !== 0 && result.status !== 2) {
  process.stderr.write(result.stderr ?? '');
  process.stdout.write(result.stdout ?? '');
  console.error(`Prisma schema diff failed with exit code ${String(result.status)}.`);
  process.exit(result.status ?? 1);
}

const normalizeSql = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const statements = (result.stdout ?? '')
  .replace(/^Loaded Prisma config from .*?\r?\n/gm, '')
  .replace(/^--[^\n]*(?:\n|$)/gm, '')
  .split(';')
  .map(normalizeSql)
  .filter(Boolean);

if (statements.length === 0) {
  console.log('No schema difference detected.');
  process.exit(0);
}

// Prisma 7.10.x can report false DROP/CREATE drift for these existing
// partial indexes because PostgreSQL normalizes VARCHAR predicates (and
// NOT IN arrays) differently from Prisma's schema AST. The actual index
// contracts are asserted by PostgreSQL integration tests. This allowlist
// accepts only the exact migration-equivalent DDL; every other diff fails.
const knownPartialIndexDrift = new Map<string, string>([
  [
    'appointments_one_active_booking_per_slot',
    "CREATE UNIQUE INDEX \"appointments_one_active_booking_per_slot\" ON \"appointments\"(\"published_slot_id\") WHERE (published_slot_id IS NOT NULL AND status NOT IN ('cancelled', 'rescheduled', 'completed', 'no-show'))",
  ],
  [
    'patient_doctor_assignments_one_live_primary',
    'CREATE UNIQUE INDEX "patient_doctor_assignments_one_live_primary" ON "patient_doctor_assignments"("patient_id") WHERE ("role" = \'primary\' AND "revoked_at" IS NULL)',
  ],
  [
    'record_issue_reports_open_idx',
    'CREATE INDEX "record_issue_reports_open_idx" ON "record_issue_reports"("created_at") WHERE ("status" <> \'resolved\')',
  ],
]);

const allowed = new Set<string>();
for (const [name, createSql] of knownPartialIndexDrift) {
  allowed.add(`DROP INDEX "${name}"`);
  allowed.add(normalizeSql(createSql));
}

const statementSet = new Set(statements);
if (
  statements.length === allowed.size &&
  statementSet.size === allowed.size &&
  statements.every((statement) => allowed.has(statement))
) {
  console.warn(
    'Prisma reported only the three allowlisted partial-index normalization differences; PostgreSQL integration tests verify their predicates and enforcement.',
  );
  console.warn(statements.join('\n'));
  process.exit(0);
}

console.error('Unexpected schema drift detected:');
console.error(statements.join('\n'));
process.exit(2);
