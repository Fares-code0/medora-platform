import { Module } from '@nestjs/common';

import { ActivityKernelModule } from '../../shared/activity';
import { AuditKernelModule } from '../../shared/audit';
import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';
import { FileStorageKernelModule } from '../../shared/files';
import { OutboxKernelModule } from '../../shared/outbox';

import { LabOrderController } from './controllers/lab-order.controller';
import { LabTestController } from './controllers/lab-test.controller';
import { LabTrendController } from './controllers/lab-trend.controller';
import { PatientLabController } from './controllers/patient-lab.controller';
import { LabAttachmentRepository } from './repositories/lab-attachment.repository';
import { LabOrderRepository } from './repositories/lab-order.repository';
import { LabResultRepository } from './repositories/lab-result.repository';
import { LabTestRepository } from './repositories/lab-test.repository';
import { LabTrendRepository } from './repositories/lab-trend.repository';
import { PatientLabRepository } from './repositories/patient-lab.repository';
import { LabAttachmentService } from './services/lab-attachment.service';
import { LabOrderService } from './services/lab-order.service';
import { LabResultService } from './services/lab-result.service';
import { LabReviewService } from './services/lab-review.service';
import { LabTestService } from './services/lab-test.service';
import { LabTrendService } from './services/lab-trend.service';
import { PatientLabService } from './services/patient-lab.service';

/**
 * Laboratory — API §8. M14.
 *
 * The order pipeline, the specimen's chain of custody, results and the
 * flags computed from them, and the critical-review discipline UX §2.6
 * makes mandatory.
 *
 * ## Two rules this module is built around
 *
 * **The flag is computed by the server and snapshotted on the row.**
 * `result-grading.ts` is the only place a value becomes a flag, and the
 * reference interval it was judged against is written onto
 * `lab_results` (DB §E5) rather than read back from the catalogue at
 * display time. A range revised next year must not retroactively change
 * whether last year's result was abnormal.
 *
 * **A critical result cannot be cleared by a checkbox.** `lab-review.ts`
 * is the only producer of the value `LabReviewService` accepts, in the
 * shape `safety-screen.ts` established, so the bulk path cannot reach a
 * critical row at all — not by a disabled button, which is one refactor
 * from enabled, but because there is no value to hand the service.
 *
 * `FileStorageKernelModule` is imported for §8.11: an attachment's bytes go
 * through the `FILE_STORAGE` port, which answers 503 until M25 wires
 * MinIO. The `files` row is written only after the port resolves, so no
 * row ever claims bytes that do not exist.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthzKernelModule,
    AuditKernelModule,
    ActivityKernelModule,
    OutboxKernelModule,
    FileStorageKernelModule,
  ],
  controllers: [
    LabTestController,
    LabOrderController,
    LabTrendController,
    PatientLabController,
  ],
  providers: [
    LabTestService,
    LabTestRepository,
    LabOrderService,
    LabOrderRepository,
    LabResultService,
    LabResultRepository,
    LabReviewService,
    LabTrendService,
    LabTrendRepository,
    LabAttachmentService,
    LabAttachmentRepository,
    PatientLabService,
    PatientLabRepository,
  ],
})
export class LabsModule {}
