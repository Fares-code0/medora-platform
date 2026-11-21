import { Controller, Get, Param, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import type { LabTrendsView } from '../dto/lab-trend.dto';
import { labTrendSchema, type LabTrendQuery } from '../dto/lab-order.schema';
import { LabTrendService } from '../services/lab-trend.service';

/**
 * Analyte trends (RM M14.6 — API §8.8).
 *
 * ## Why this is its own controller
 *
 * The route is `GET /patients/{patientId}/lab-trends`, which is a
 * **patient-child** path rather than a lab-order one — a trend is the
 * patient's history of an analyte, not one order's. Nest binds a path
 * prefix per controller, so hanging it off `LabOrderController` would
 * have meant a second prefix on one class, which Nest does not offer,
 * or a route declared outside its module's namespace, which reads as a
 * mistake to the next person grepping for `/patients`.
 *
 * Ownership stays with this module: the analytes, the reference bands
 * and the flags are the laboratory's, and `PatientsModule` has no
 * business knowing how a reference interval is snapshotted. The same
 * split M10 already lives with — `GET /patients/{id}/medications` is
 * served from the patients module while the *writes* that maintain it
 * are the pharmacy's.
 *
 * `labs.review` guards it for the reason `LabOrderController` records,
 * and the patient is care-scoped in the service before a single result
 * is read.
 */
@Can('labs.review')
@Controller('patients')
export class LabTrendController {
  constructor(private readonly labTrends: LabTrendService) {}

  /** API §8.8 — `?analytes=a,b,c&from=&to=`, at most three. */
  @Get(':patientId/lab-trends')
  trends(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Query(zodQuery(labTrendSchema)) query: LabTrendQuery,
  ): Promise<LabTrendsView> {
    return this.labTrends.forPatient(user, patientId, query);
  }
}
