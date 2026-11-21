import { Module } from '@nestjs/common';

import { AuditController } from './controllers/audit.controller';
import { IncidentBookmarkController } from './controllers/incident-bookmark.controller';
import { AuditRepository } from './repositories/audit.repository';
import { AuditJobs } from './services/audit.jobs';
import { AuditExportService } from './services/audit-export.service';
import { AuditQueryService } from './services/audit-query.service';
import { AuditRetentionService } from './services/audit-retention.service';

/**
 * The audit ledger's read surface — API §14, RM M28.3–M28.5.
 *
 * **The writer is not here.** `shared/audit` owns it, because M28.1's
 * "single write choke point" means exactly one, and a repository in a
 * domain module able to insert a row would be a second. Nothing in this
 * module writes an `audit_events` row; the one write it performs is the
 * export's own audit event, and that goes through the same dispatcher
 * every other module uses.
 *
 * `AuditRetentionService` is exported so **M30.2**'s scheduled-job
 * registry can call it. It registers no timer — the rule
 * `OrphanSweepService` states, for the same reason.
 */
@Module({
  controllers: [AuditController, IncidentBookmarkController],
  providers: [
    AuditRepository,
    AuditQueryService,
    AuditExportService,
    AuditRetentionService,
    AuditJobs,
  ],
  exports: [AuditRetentionService],
})
export class AuditModule {}
