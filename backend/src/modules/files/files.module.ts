import { Module } from '@nestjs/common';

import { FilesController } from './controllers/files.controller';
import { FileRepository } from './repositories/file.repository';
import { FilesJobs } from './services/files.jobs';
import { MalwareScanService } from './services/malware-scan.service';
import { FileAccessService } from './services/file-access.service';
import { FilesService } from './services/files.service';
import { OrphanSweepService } from './services/orphan-sweep.service';

/**
 * Files — API §17, RM M25.
 *
 * The bytes live behind `FILE_STORAGE` in the shared kernel, bound to
 * the S3 adapter at M25.2; this module owns the `files` rows, the
 * per-kind rules, the scan gate and the scope decision.
 *
 * `OrphanSweepService` is exported, and `FilesJobs` (**M30.2**'s
 * registrations) calls it. It registers no timer of its own — see its header.
 */
@Module({
  controllers: [FilesController],
  providers: [
    FileRepository,
    FileAccessService,
    FilesService,
    MalwareScanService,
    OrphanSweepService,
    FilesJobs,
  ],
  exports: [OrphanSweepService],
})
export class FilesModule {}
