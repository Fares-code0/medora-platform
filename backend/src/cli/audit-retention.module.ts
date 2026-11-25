import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigService, PolicyService } from '../config';
import { loadEnv } from '../config/env';
import { PLATFORM_POLICY_SOURCE } from '../config/policy.types';
import { AuditRepository } from '../modules/audit/repositories/audit.repository';
import { AuditRetentionService } from '../modules/audit/services/audit-retention.service';
import { PrismaService } from '../shared/database';
import { PrismaPlatformPolicySource } from '../shared/platform-policy/prisma-platform-policy.source';

/**
 * The audit retention command's whole application: nothing else.
 *
 * `npm run audit:retention` used to boot `AppModule`. That started every
 * module's lifecycle hooks — among them the refresh-successor sweep, which
 * queries `sessions` at bootstrap whatever `JOBS_ENABLED` says — under the
 * audit maintenance role, which may (and must) read none of it. Retention
 * needs exactly: configuration, one database client on the maintenance
 * connection, the administrator's retention window (`platform_settings`,
 * through the same `PolicyService` and source the application uses) and the
 * audit repository and retention service. Nothing in here touches a session,
 * a user, a patient or an audit event row.
 *
 * `databaseUrl` is a parameter rather than a rewrite of `process.env`, so the
 * connection the command uses is the one its caller named and nothing else.
 */
@Module({})
export class AuditRetentionCliModule {
  static forConnection(databaseUrl: string): DynamicModule {
    return {
      module: AuditRetentionCliModule,
      providers: [
        { provide: ConfigService, useFactory: () => new ConfigService({ ...loadEnv(), DATABASE_URL: databaseUrl }) },
        PrismaService,
        { provide: PLATFORM_POLICY_SOURCE, useClass: PrismaPlatformPolicySource },
        PolicyService,
        AuditRepository,
        AuditRetentionService,
      ],
      exports: [AuditRepository, AuditRetentionService],
    };
  }
}
