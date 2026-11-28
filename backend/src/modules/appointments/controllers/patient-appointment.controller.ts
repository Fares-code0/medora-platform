import { Controller, Get, Param, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi, principalOf } from '../../../shared/authz';
import type { PatientAppointmentDetail } from '../dto/patient-appointment.dto';
import {
  patientAppointmentQuerySchema,
  type PatientAppointmentQuery,
} from '../dto/patient-appointment.schema';
import {
  PatientAppointmentService,
  type PaginatedAppointments,
} from '../services/patient-appointment.service';

/**
 * `GET /me/appointments` and `/me/appointments/{id}` — contract §4.1/§4.2.
 *
 * **Reads only.** `POST /me/appointments`, `/cancel`, `/confirm` and the
 * slot endpoint are specified in the contract and are **not** implemented,
 * because each needs a rule no source states — see the service docblock
 * and contract §4.
 *
 * ## Authorization is ownership, and it is a WHERE clause
 *
 * There is no `patientId` parameter on either route, by design: the
 * subject is the token. `PatientSelfScopeService` resolves it to the
 * caller's own `patients` row and every query is filtered by it, so a row
 * that is not the caller's is never loaded — not fetched and then
 * rejected.
 *
 * `@Authenticated()` rather than `@Can(...)`: a patient holds zero
 * capabilities by ADR-030 §6, so any capability would deny exactly the
 * audience these routes exist for. A doctor or admin calling them gets an
 * empty list, because no `patients` row links to their user account —
 * correct, and disclosing nothing.
 *
 * An unknown id, another patient's id, and an unlinked account all
 * produce the same **404**. Never 403: a 403 would confirm the
 * appointment exists.
 */
@Authenticated()
@Controller('me/appointments')
export class PatientAppointmentController {
  constructor(private readonly appointments: PatientAppointmentService) {}

  @NotPhi('the patient’s own appointments (self access)')

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(patientAppointmentQuerySchema)) query: PatientAppointmentQuery,
  ): Promise<PaginatedAppointments> {
    return this.appointments.listOwn(principalOf(user), query);
  }

  @NotPhi('the patient’s own appointment (self access)')

  @Get(':appointmentId')
  byId(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
  ): Promise<PatientAppointmentDetail & { clinicTimezone: string }> {
    return this.appointments.ownById(principalOf(user), appointmentId);
  }
}
