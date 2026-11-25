import { NestFactory } from '@nestjs/core';

import { AuditRepository } from '../modules/audit/repositories/audit.repository';
import { AuditRetentionService } from '../modules/audit/services/audit-retention.service';

import { AuditRetentionCliModule } from './audit-retention.module';

/** What the command needs from its application — and nothing more. */
export interface AuditRetentionApplication {
  retentionEntitled(): Promise<boolean>;
  sweep(now: Date): ReturnType<AuditRetentionService['sweep']>;
  close(): Promise<void>;
}

export interface CommandOutput {
  log(line: string): void;
  error(line: string): void;
}

/** Exit codes: 0 swept, 2 no maintenance URL, 3 the connection is not entitled. */
export const EXIT_NO_URL = 2;
export const EXIT_NOT_ENTITLED = 3;

/**
 * Boots only `AuditRetentionCliModule` on the given connection (H1): no
 * application module, so no lifecycle hook of any other module runs under
 * the maintenance role. Logs errors only.
 */
export async function openAuditRetention(databaseUrl: string): Promise<AuditRetentionApplication> {
  const app = await NestFactory.createApplicationContext(AuditRetentionCliModule.forConnection(databaseUrl), {
    logger: ['error', 'warn'],
  });
  const audit = app.get(AuditRepository);
  const retention = app.get(AuditRetentionService);
  return {
    retentionEntitled: () => audit.retentionEntitled(),
    sweep: (now) => retention.sweep(now),
    close: () => app.close(),
  };
}

/**
 * `npm run audit:retention`: refuses without a maintenance URL, refuses a
 * connection the database does not entitle to retention, otherwise sweeps
 * once and prints the result as JSON.
 */
export async function runAuditRetentionCommand(
  maintenanceUrl: string | undefined,
  open: (databaseUrl: string) => Promise<AuditRetentionApplication>,
  out: CommandOutput,
  now: Date = new Date(),
): Promise<number> {
  if (maintenanceUrl === undefined || maintenanceUrl === '') {
    out.error('AUDIT_MAINTENANCE_DATABASE_URL is not set: audit retention runs only as the audit maintenance role.');
    return EXIT_NO_URL;
  }

  const app = await open(maintenanceUrl);
  try {
    if (!(await app.retentionEntitled())) {
      out.error('Refusing: this connection is not entitled to run audit retention.');
      return EXIT_NOT_ENTITLED;
    }
    out.log(JSON.stringify(await app.sweep(now)));
    return 0;
  } finally {
    await app.close();
  }
}
