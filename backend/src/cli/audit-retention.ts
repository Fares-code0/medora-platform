import 'reflect-metadata';

import { EnvValidationError, loadDotenvFile, loadEnv } from '../config/env';

import { openAuditRetention, runAuditRetentionCommand } from './audit-retention.command';

/**
 * `npm run audit:retention` — audit partition retention under the audit
 * maintenance role (security remediation H1).
 *
 * The application runtime role may not drop audit partitions: the drop
 * function refuses it (migration 20261125100000) and the in-app sweep only
 * keeps future months ready, reporting expired months as `deferred`. This
 * operator-scheduled command is the legitimate retention path. It connects
 * with `AUDIT_MAINTENANCE_DATABASE_URL` — a login in the
 * `medora_audit_maintenance` group (prisma/roles/provision-audit-
 * maintenance-role.sql) — never with the application's DATABASE_URL, boots
 * only `AuditRetentionCliModule` (no session, user or clinical module), and
 * refuses to run unless the database itself says that connection is
 * entitled. The window is the administrator's `retention.auditLogDays`.
 *
 * Runs from the **build** (`node dist/cli/audit-retention.js`), as the other
 * commands do: Nest's injector needs the decorator metadata `tsc` emits.
 */
loadDotenvFile();
loadEnv();

runAuditRetentionCommand(process.env['AUDIT_MAINTENANCE_DATABASE_URL'], openAuditRetention, {
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
}).then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    console.error(error instanceof EnvValidationError || error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
