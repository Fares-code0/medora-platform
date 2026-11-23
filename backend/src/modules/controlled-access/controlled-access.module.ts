import { Module } from '@nestjs/common';

import { ControlledAccessController } from './controllers/controlled-access.controller';
import { ControlledAccessRepository } from './repositories/controlled-access.repository';
import { ControlledAccessService } from './services/controlled-access.service';

/**
 * Exceptional Access / Emergency Override and cross-hospital information
 * requests (multi-hospital §2.11, §2.12). Supersedes the unused legacy
 * `patient_access_grants` table, which no code path reads.
 */
@Module({
  controllers: [ControlledAccessController],
  providers: [ControlledAccessRepository, ControlledAccessService],
})
export class ControlledAccessModule {}
