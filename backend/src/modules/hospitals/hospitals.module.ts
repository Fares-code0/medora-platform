import { Module } from '@nestjs/common';

import { HospitalStaffingController } from './controllers/hospital-staffing.controller';
import { HospitalStaffingRepository } from './repositories/hospital-staffing.repository';
import { HospitalStaffingService } from './services/hospital-staffing.service';

/**
 * Hospital staffing and administrative scope (multi-hospital §2.2–§2.6):
 * employments, staff affiliations, transfers, Hospital Admin assignments and
 * Platform Admin grants.
 */
@Module({
  controllers: [HospitalStaffingController],
  providers: [HospitalStaffingRepository, HospitalStaffingService],
})
export class HospitalsModule {}
