import { Module } from '@nestjs/common';

import { ActivityKernelModule } from '../../shared/activity';
import { AuditKernelModule } from '../../shared/audit';
import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';
import { OutboxKernelModule } from '../../shared/outbox';

import { AdminRecordIssueController } from './controllers/admin-record-issue.controller';
import { RecordController } from './controllers/record.controller';
import { RecordIssueRepository } from './repositories/record-issue.repository';
import { RecordRepository } from './repositories/record.repository';
import { RecordIssueService } from './services/record-issue.service';
import { RecordService } from './services/record.service';

/**
 * Medical records — API §6. M12.
 *
 * The clinical document, its children, its guarded lifecycle and its
 * version history. Every read and write resolves through
 * `PatientScopeService`, per RM M7.2's standing obligation.
 *
 * **Attachments (§6.7) are deliberately absent.** They need the object
 * store, the per-kind size and type rules, and the malware-scan gate
 * that keeps a download at 403 until the file is clean — all of which is
 * M25, and all of which `shared/files` currently answers `unconfigured`
 * for. An upload endpoint built against the stub would accept a file,
 * store nothing, and return a 201 the clinician would believe. The
 * schema (`record_attachments`) and the projection are in place, so M25
 * wires the adapter rather than adding a surface.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthzKernelModule,
    AuditKernelModule,
    ActivityKernelModule,
    OutboxKernelModule,
  ],
  controllers: [RecordController, AdminRecordIssueController],
  providers: [RecordService, RecordRepository, RecordIssueService, RecordIssueRepository],
})
export class MedicalRecordsModule {}
