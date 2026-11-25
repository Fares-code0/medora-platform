import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { EnvValidationError, loadDotenvFile, loadEnv } from '../config/env';
import { AuditRepository } from '../modules/audit/repositories/audit.repository';
import { AuditRetentionService } from '../modules/audit/services/audit-retention.service';

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
 * maintenance-role.sql) — never with the application's DATABASE_URL, and it
 * refuses to run unless the database itself says that connection is
 * entitled. The window is the administrator's `retention.auditLogDays`,
 * read through the same PolicyService the application uses.
 *
 * Runs from the **build** (`node dist/cli/audit-retention.js`), as the other
 * commands do: Nest's injector needs the decorator metadata `tsc` emits.
 */
async function main(): Promise<number> {
  process.env['JOBS_ENABLED'] = 'false';
  loadDotenvFile();

  const maintenanceUrl = process.env['AUDIT_MAINTENANCE_DATABASE_URL'];
  if (maintenanceUrl === undefined || maintenanceUrl === '') {
    console.error(
      'AUDIT_MAINTENANCE_DATABASE_URL is not set: audit retention runs only as the audit maintenance role.',
    );
    return 2;
  }
  // Every connection this context opens is the maintenance login's.
  process.env['DATABASE_URL'] = maintenanceUrl;
  loadEnv();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    if (!(await app.get(AuditRepository).retentionEntitled())) {
      console.error('Refusing: this connection is not entitled to run audit retention.');
      return 3;
    }
    const result = await app.get(AuditRetentionService).sweep(new Date());
    console.log(JSON.stringify(result));
    return 0;
  } finally {
    await app.close();
  }
}

main().then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    console.error(
      error instanceof EnvValidationError || error instanceof Error ? error.message : error,
    );
    process.exit(1);
  },
);
