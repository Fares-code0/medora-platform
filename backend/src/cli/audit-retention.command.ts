import { NestFactory } from '@nestjs/core';

import { PolicyService } from '../config';

import { AuditRepository } from '../modules/audit/repositories/audit.repository';
import { AuditRetentionService } from '../modules/audit/services/audit-retention.service';

import { AuditRetentionCliModule } from './audit-retention.module';

/** What the command needs from its application — and nothing more. */
export interface AuditRetentionApplication {
  retentionEntitled(): Promise<boolean>;
  /** The administrator's window, read strictly: throws rather than fall back. */
  retentionDays(): Promise<number>;
  sweep(now: Date, retentionDays: number): ReturnType<AuditRetentionService['sweep']>;
  close(): Promise<void>;
}

export interface CommandOutput {
  log(line: string): void;
  error(line: string): void;
}

/**
 * Exit codes: 0 swept, 2 no maintenance URL, 3 the connection is not
 * entitled, 4 the retention window could not be read.
 */
export const EXIT_NO_URL = 2;
export const EXIT_NOT_ENTITLED = 3;
export const EXIT_NO_WINDOW = 4;

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
  const policy = app.get(PolicyService);
  return {
    retentionEntitled: () => audit.retentionEntitled(),
    retentionDays: async () => (await policy.currentStrict()).auditLogDays,
    sweep: (now, retentionDays) => retention.sweep(now, retentionDays),
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
    // Never the environment default in place of the administrator's window:
    // a drop computed from a window nobody set is refused, not run.
    let retentionDays: number;
    try {
      retentionDays = await app.retentionDays();
    } catch (error) {
      out.error(
        `Refusing: the retention window could not be read (${error instanceof Error ? error.message : 'unknown error'}).`,
      );
      return EXIT_NO_WINDOW;
    }
    out.log(JSON.stringify(await app.sweep(now, retentionDays)));
    return 0;
  } finally {
    await app.close();
  }
}
