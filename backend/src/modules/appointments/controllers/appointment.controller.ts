import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi, PhiRead } from '../../../shared/authz';
import { Idempotent } from '../../../shared/idempotency';
import type {
  AppointmentDetailView,
  AppointmentSummaryView,
  AppointmentView,
} from '../dto/appointment.dto';
import {
  appointmentListSchema,
  cancelAppointmentSchema,
  createAppointmentSchema,
  proposeSlotsSchema,
  rejectAppointmentSchema,
  rescheduleAppointmentSchema,
  type AppointmentListQuery,
  type CancelAppointmentInput,
  type CreateAppointmentInput,
  type ProposeSlotsInput,
  type RejectAppointmentInput,
  type RescheduleAppointmentInput,
} from '../dto/appointment.schema';
import { AppointmentService, type PaginatedAppointments } from '../services/appointment.service';

/**
 * The doctor's appointment book (RM M11 — API §5.1–§5.8, §5.11).
 *
 * ## The capability, and the scope inside it
 *
 * `appointments.manageOwn` is the matrix's capability for this surface,
 * and it is only half the decision — the other half is *whose* book,
 * which the service answers from `doctors.user_id` rather than from the
 * role string. An administrator holding `appointments.manageOwn` with no
 * `doctors` row gets 404 from every route here, and reaches appointments
 * through the oversight surface of §5.10 instead. That split is
 * reconciliation §5 rule 5: authorization never asks "is this the
 * admin".
 *
 * ## Route ordering
 *
 * `GET /appointments/summary` is declared **before** `GET /appointments/:id`.
 * Nest matches in declaration order, so the reverse would read `summary`
 * as an appointment reference and answer 404 — the same trap the
 * patients controller documents for `/patients/export`.
 *
 * ## Why the actions answer 200 and not 201
 *
 * Nest answers 201 for a `POST` by default, which is right for
 * `POST /appointments` — a resource was created and the contract says
 * 201 — and wrong for every action route below it. `POST …/approve`
 * creates nothing; it moves a resource that already exists, and the
 * contract's own example for §5.5 shows `200`. So each action carries an
 * explicit `@HttpCode(HttpStatus.OK)` and the create route does not.
 *
 * ## Why the actions are POST and not PATCH
 *
 * Each one is a named transition with its own preconditions and its own
 * history row, not a field assignment. `PATCH { status: 'cancelled' }`
 * would offer a client the shape of a state machine it does not own, and
 * would have nowhere to put the mandatory reason.
 */
@Can('appointments.manageOwn')
@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointments: AppointmentService) {}

  /** API §5.1 — the book, in list or calendar form. */
  @PhiRead('appointment_list')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(appointmentListSchema)) query: AppointmentListQuery,
  ): Promise<PaginatedAppointments> {
    return this.appointments.list(user, query);
  }

  /** API §5.11 — the cards above the book. Declared before `:id`. */
  @NotPhi('counts by status')
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<AppointmentSummaryView> {
    return this.appointments.summary(user);
  }

  /** API §5.2 — one appointment with its transition history. */
  @PhiRead('appointment')
  @Get(':appointmentId')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
  ): Promise<AppointmentDetailView> {
    return this.appointments.detail(user, appointmentId);
  }

  /** API §5.3 — book. 409 when the slot conflicts (ADR-005 §4). */
  @Post()
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(createAppointmentSchema)) body: CreateAppointmentInput,
  ): Promise<AppointmentView> {
    return this.appointments.create(user, body);
  }

  /** API §5.4 — `pending → confirmed`. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
  ): Promise<AppointmentView> {
    return this.appointments.approve(user, appointmentId);
  }

  /** API §5.5 — `pending → cancelled`, P4 with a category. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(rejectAppointmentSchema)) body: RejectAppointmentInput,
  ): Promise<AppointmentView> {
    return this.appointments.reject(user, appointmentId, body);
  }

  /** API §5.7 — cancel, P4 with a mandatory reason. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/cancel')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(cancelAppointmentSchema)) body: CancelAppointmentInput,
  ): Promise<AppointmentView> {
    return this.appointments.cancel(user, appointmentId, body);
  }

  /** API §5.6 — move to a new slot; the slot is conflict-checked. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/reschedule')
  reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(rescheduleAppointmentSchema)) body: RescheduleAppointmentInput,
  ): Promise<AppointmentView> {
    return this.appointments.reschedule(user, appointmentId, body);
  }

  /** API §5.7 — completed. 409 before the slot date (ADR-001). */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/complete')
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
  ): Promise<AppointmentView> {
    return this.appointments.complete(user, appointmentId);
  }

  /** API §5.7 — no-show. Same clock gate as completion. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/no-show')
  noShow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
  ): Promise<AppointmentView> {
    return this.appointments.noShow(user, appointmentId);
  }

  /** API §5.8 — up to three alternatives → `awaiting-patient`. */
  @HttpCode(HttpStatus.OK)
  @Post(':appointmentId/propose-slots')
  proposeSlots(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(proposeSlotsSchema)) body: ProposeSlotsInput,
  ): Promise<AppointmentDetailView> {
    return this.appointments.proposeSlots(user, appointmentId, body);
  }
}
