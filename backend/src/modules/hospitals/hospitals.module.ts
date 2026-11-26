import { Module } from '@nestjs/common';

import { HospitalStaffingController } from './controllers/hospital-staffing.controller';
import { PatientHospitalController } from './controllers/patient-hospital.controller';
import { HospitalStaffingRepository } from './repositories/hospital-staffing.repository';
import { PatientHospitalRepository } from './repositories/patient-hospital.repository';
import { HospitalStaffingService } from './services/hospital-staffing.service';
import { PatientHospitalService } from './services/patient-hospital.service';

/**
 * Hospital staffing and administrative scope (multi-hospital §2.2–§2.6):
 * employments, staff affiliations, transfers, Hospital Admin assignments and
 * Platform Admin grants.
 */
@Module({
  controllers: [HospitalStaffingController, PatientHospitalController],
  providers: [
    HospitalStaffingRepository,
    HospitalStaffingService,
    PatientHospitalRepository,
    PatientHospitalService,
  ],
})
export class HospitalsModule {}
