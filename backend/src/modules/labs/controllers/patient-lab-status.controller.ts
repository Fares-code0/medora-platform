import { Controller, Get, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi } from '../../../shared/authz';
import type { PatientLabOrderPage } from '../dto/patient-lab-status.dto';
import {
  patientLabStatusQuerySchema,
  type PatientLabStatusQuery,
} from '../dto/patient-lab-status.schema';
import { PatientLabStatusService } from '../services/patient-lab-status.service';

/**
 * `GET /me/lab-orders` — the patient's own lab test *status* (contract §4).
 *
 * The laboratory owns it for the reason `PatientLabController` gives: the
 * data and its vocabulary are this module's. `@Authenticated()` because a
 * patient holds no capability (ADR-030 §6); the service refuses every other
 * role (403 `patient_only`) and resolves the patient from the session only.
 */
@Authenticated()
@Controller('me/lab-orders')
export class PatientLabStatusController {
  constructor(private readonly orders: PatientLabStatusService) {}

  @NotPhi('the patient’s own lab test status, no results (self access)')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(patientLabStatusQuerySchema)) query: PatientLabStatusQuery,
  ): Promise<PatientLabOrderPage> {
    return this.orders.listOwn(user, query);
  }
}
