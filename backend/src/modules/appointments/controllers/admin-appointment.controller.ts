import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi, PhiRead } from '../../../shared/authz';
import type {
  AppointmentAdminSummaryView,
  OversightAppointmentView,
} from '../dto/appointment.dto';
import {
  administrativeCancelSchema,
  nudgeSchema,
  oversightListSchema,
  reassignSchema,
  type AdministrativeCancelInput,
  type NudgeInput,
  type OversightListQuery,
  type ReassignInput,
} from '../dto/appointment.schema';
import {
  AppointmentOversightService,
  type PaginatedOversight,
} from '../services/appointment-oversight.service';

/**
 * Appointment oversight (RM M11.6 — API §5.10, UX §3.5).
 *
 * ## Two capabilities, and the reads sit under the narrower one
 *
 * The contract names `appointments.reassign` and
 * `appointments.cancelAdministratively` for the two writes. The reads
 * have no capability of their own in the matrix, and inventing one would
 * mean adding a column the permission editor does not have.
 * `appointments.reassign` is the one that carries them: an
 * administrator who may move an appointment between doctors must be able
 * to see the table they would move it from, and the two are granted
 * together in every role bundle that has either.
 *
 * `@Can(...)` on a method **narrows** the controller's decoration — the
 * guard requires every listed capability — so the administrative cancel
 * demands both its own and the class's. That is the safe direction to be
 * wrong in: a route that asks too much fails loudly in review.
 *
 * ## 200, not 201
 *
 * Nest answers 201 for a `POST` by default. None of these routes creates
 * a resource — each acts on an appointment that already exists and
 * returns its updated oversight row — so each carries an explicit
 * `@HttpCode(HttpStatus.OK)`, matching the doctor-facing actions.
 *
 * ## `/admin/appointments`, not `/appointments?scope=all`
 *
 * A query parameter that widens a scope is a scope that can be widened
 * by a client. The unscoped book has its own path and its own guard, so
 * reaching it is a decision made at the router rather than in a `where`
 * clause.
 */
@Can('appointments.reassign')
@Controller('admin/appointments')
export class AdminAppointmentController {
  constructor(private readonly oversight: AppointmentOversightService) {}

  /** API §5.10 — every doctor's book, with `ageInState` and the flags. */
  @PhiRead('appointment_list')
  @Get()
  list(
    @Query(zodQuery(oversightListSchema)) query: OversightListQuery,
  ): Promise<PaginatedOversight & { flaggedItems: number }> {
    return this.oversight.list(query);
  }

  /** API §5.11's administrator strip. Declared before `:appointmentId`. */
  @NotPhi('counts by status')
  @Get('summary')
  summary(): Promise<AppointmentAdminSummaryView> {
    return this.oversight.summary();
  }

  /** API §5.10 — a templated, logged reminder. Changes no status. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/nudge')
  nudge(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(nudgeSchema)) body: NudgeInput,
  ): Promise<OversightAppointmentView> {
    return this.oversight.nudge(user, appointmentId, body);
  }

  /** API §5.10 — same specialty, live availability, both parties notified. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/reassign')
  reassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(reassignSchema)) body: ReassignInput,
  ): Promise<OversightAppointmentView> {
    return this.oversight.reassign(user, appointmentId, body);
  }

  /** API §5.10 — administrative cancellation, category plus reason (P4). */
  @Can('appointments.cancelAdministratively')
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/cancel-administratively')
  cancelAdministratively(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(administrativeCancelSchema)) body: AdministrativeCancelInput,
  ): Promise<OversightAppointmentView> {
    return this.oversight.cancelAdministratively(user, appointmentId, body);
  }
}
