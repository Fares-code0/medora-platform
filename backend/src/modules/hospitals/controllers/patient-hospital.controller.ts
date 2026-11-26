import { Controller, Get, Param, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi } from '../../../shared/authz';
import type { PatientHospitalDetail, PatientHospitalPage } from '../dto/patient-hospital.dto';
import {
  patientHospitalQuerySchema,
  type PatientHospitalQuery,
} from '../dto/patient-hospital.schema';
import { PatientHospitalService } from '../services/patient-hospital.service';

/**
 * `GET /patient/hospitals` and `/patient/hospitals/:id` (contract §2).
 *
 * `@Authenticated()` — a patient holds no capability (ADR-030 §6); the
 * service answers any other role 403 `patient_only`. Unknown, inactive and
 * malformed ids are the same 404.
 */
@Authenticated()
@Controller('patient/hospitals')
export class PatientHospitalController {
  constructor(private readonly hospitals: PatientHospitalService) {}

  @NotPhi('public hospital directory')
  @Get()
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(patientHospitalQuerySchema)) query: PatientHospitalQuery,
  ): Promise<PatientHospitalPage> {
    return this.hospitals.search(user, query);
  }

  @NotPhi('public hospital profile')
  @Get(':hospitalId')
  byId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('hospitalId') hospitalId: string,
  ): Promise<PatientHospitalDetail> {
    return this.hospitals.byId(user, hospitalId);
  }
}
