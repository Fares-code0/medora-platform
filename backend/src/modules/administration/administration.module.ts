import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database';

import { AdministrationController } from './controllers/administration.controller';
import { JobsController } from './controllers/jobs.controller';
import { DirectoryRepository } from './repositories/directory.repository';
import { OperationsRepository } from './repositories/operations.repository';
import { DirectoryService } from './services/directory.service';
import { JobsService } from './services/jobs.service';
import { OperationsService } from './services/operations.service';
import { OverviewService } from './services/overview.service';

/**
 * Administration Center — API §18. M23.
 *
 * Clinic operations: staff, departments, rooms, resources, the working
 * week, holidays, shifts, the queue, the waiting room, announcements,
 * policies, document templates and a thin audit feed.
 *
 * **Derived fields are computed, never returned from a column.**
 * `Department.staffCount` is a relation count, `Resource.status` comes
 * from quantity against the reorder level, and the queue's waiting
 * minutes and `delayed` flag come from timestamps against the request's
 * own clock. None of them appears in any request schema, so no client
 * can assert one.
 *
 * **Patient identifiers are masked on the two surfaces that face a
 * room.** The queue and the waiting room show a masked MRN and the
 * display name an operator needs to call someone — M23.4 names exactly
 * these two, and M7.3 is the masking.
 *
 * Not built here:
 *
 * · **M23.6 `platform-status`** — its verify step requires real probe
 *   data and the probes are **M38.1**'s. Answering with constants is the
 *   one thing that step forbids. See RA-M23.1.
 *
 * **M30.1 added the background-jobs screen** (`/administration/jobs`).
 * It belongs here for the reason the centre exists — MG §5 has an
 * administrator "monitor platform status" from it — and it is the one
 * surface on which a *blocked* schedule is visible, which a broker's own
 * dashboard could never show. See `dto/jobs.dto.ts`.
 */
@Module({
  imports: [DatabaseModule],
  controllers: [AdministrationController, JobsController],
  providers: [
    DirectoryService,
    DirectoryRepository,
    OperationsService,
    OperationsRepository,
    OverviewService,
    JobsService,
  ],
})
export class AdministrationModule {}
