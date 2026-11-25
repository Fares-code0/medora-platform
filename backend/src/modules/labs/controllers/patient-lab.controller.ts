import { Controller, Get, Param } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Can, PhiRead } from '../../../shared/authz';
import type { PatientLabStudiesView } from '../dto/patient-lab.dto';
import { PatientLabService } from '../services/patient-lab.service';

/**
 * The patient profile's Lab results tab (RM M15.3 — API §4.5).
 *
 * ## Why the laboratory owns a `/patients` route
 *
 * The same split `LabTrendController` records, and for the same reason.
 * The path is patient-child — this is *that patient's* laboratory
 * history, not one order's — but the data is the laboratory's: the
 * catalogue categories, the released-result counts and the M14.5 review
 * state are this module's, and `PatientsModule` has no business knowing
 * how a review is recorded or which flags count as abnormal.
 *
 * It is a second controller rather than a method on the trend one
 * because Nest binds one path prefix per class and the two answer
 * different questions: a trend plots released values for named analytes,
 * this lists orders. Sharing a class would have meant sharing a guard
 * and a service that have no reason to agree.
 *
 * `labs.review` guards it for the reason `LabOrderController` records,
 * and the patient is care-scoped in the service before a single order
 * is read.
 */
@Can('labs.review')
@Controller('patients')
export class PatientLabController {
  constructor(private readonly studies: PatientLabService) {}

  /** API §4.5 — the tab, grouped by category. */
  @PhiRead('lab_results')
  @Get(':patientId/labs')
  labs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<PatientLabStudiesView> {
    return this.studies.forPatient(user, patientId);
  }
}
