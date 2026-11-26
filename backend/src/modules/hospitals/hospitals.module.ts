import { Module } from '@nestjs/common';

import { HospitalAdminController } from './controllers/hospital-admin.controller';
import { HospitalStaffingController } from './controllers/hospital-staffing.controller';
import { InsuranceAdminController } from './controllers/insurance-admin.controller';
import { HospitalAdminRepository } from './repositories/hospital-admin.repository';
import { HospitalStaffingRepository } from './repositories/hospital-staffing.repository';
import { InsuranceAdminRepository } from './repositories/insurance-admin.repository';
import { HospitalAdminService } from './services/hospital-admin.service';
import { HospitalStaffingService } from './services/hospital-staffing.service';
import { InsuranceAdminService } from './services/insurance-admin.service';

/**
 * Hospital staffing and administrative scope (multi-hospital §2.2–§2.6):
 * employments, staff affiliations, transfers, Hospital Admin assignments and
 * Platform Admin grants; hospital, clinic, location and department
 * administration (ADM-01) and insurance configuration (ADM-03).
 */
@Module({
  controllers: [HospitalStaffingController, HospitalAdminController, InsuranceAdminController],
  providers: [
    HospitalStaffingRepository,
    HospitalStaffingService,
    HospitalAdminRepository,
    HospitalAdminService,
    InsuranceAdminRepository,
    InsuranceAdminService,
  ],
})
export class HospitalsModule {}
