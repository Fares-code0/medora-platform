import { Module } from '@nestjs/common';

import { ActivityKernelModule } from '../../shared/activity';
import { AuditKernelModule } from '../../shared/audit';
import { AuthzKernelModule } from '../../shared/authz';
import { DatabaseModule } from '../../shared/database';
import { OutboxKernelModule } from '../../shared/outbox';

import { MedicationController } from './controllers/medication.controller';
import { PrescriptionController } from './controllers/prescription.controller';
import { MedicationRepository } from './repositories/medication.repository';
import { PrescriptionRepository } from './repositories/prescription.repository';
import { SafetyRepository } from './repositories/safety.repository';
import { INTERACTION_SOURCE, PrismaInteractionSource } from './services/interaction-source';
import { MedicationService } from './services/medication.service';
import { PrescriptionService } from './services/prescription.service';
import { PrescriptionJobs } from './services/prescription.jobs';
import { PrescriptionSweepService } from './services/prescription-sweep.service';
import { SafetyService } from './services/safety.service';

/**
 * Prescriptions (Pharmacy) — API §7. M13.
 *
 * The formulary, the safety screen, prescribing, and the status machine
 * of ADR-002. **The highest-risk module in the platform**: RM M13's goal
 * line is "fail closed, 100% test coverage on the safety service", and
 * the fail-closed rule is expressed as a status — a prescription whose
 * safety check could not run stays in `draft`.
 *
 * `INTERACTION_SOURCE` is bound to the `drug_interactions` table
 * (ADR-010 group 8). It is a token rather than a direct dependency for
 * two reasons: a licensed interaction service eventually replaces the
 * table, and RM M13.3's verify step requires a chaos test that runs with
 * the source disabled — which is only expressible if it can be
 * substituted.
 */
@Module({
  imports: [
    DatabaseModule,
    AuthzKernelModule,
    AuditKernelModule,
    ActivityKernelModule,
    OutboxKernelModule,
  ],
  controllers: [MedicationController, PrescriptionController],
  providers: [
    MedicationService,
    MedicationRepository,
    PrescriptionService,
    PrescriptionRepository,
    PrescriptionSweepService,
    PrescriptionJobs,
    SafetyService,
    SafetyRepository,
    { provide: INTERACTION_SOURCE, useClass: PrismaInteractionSource },
  ],
})
export class PharmacyModule {}
