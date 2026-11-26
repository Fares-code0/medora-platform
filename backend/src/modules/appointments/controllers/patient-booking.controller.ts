import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi, principalOf } from '../../../shared/authz';
import { Idempotent } from '../../../shared/idempotency';
import type {
  PatientAppointmentDetail,
  PatientSlotView,
  PatientVisitTypeView,
  RescheduleRequestView,
} from '../dto/patient-appointment.dto';
import {
  patientBookSchema,
  patientCancelSchema,
  patientRescheduleRequestSchema,
  patientSlotQuerySchema,
  type PatientBookInput,
  type PatientCancelInput,
  type PatientRescheduleRequestInput,
  type PatientSlotQuery,
} from '../dto/patient-appointment.schema';
import { PatientBookingService } from '../services/patient-booking.service';

/**
 * `Idempotency-Key` is **required** on the patient's create routes
 * (contract §3): a mobile client on a flaky network retries, and a retry
 * without a key would book twice. The interceptor (ADR-014) replays a seen
 * key; this refuses its absence.
 */
function requireIdempotencyKey(key: string | undefined): void {
  if (key === undefined || key.trim() === '') {
    throw AppException.validation(
      { 'Idempotency-Key': ['The Idempotency-Key header is required'] },
      'The Idempotency-Key header is required',
      'idempotency_key_required',
    );
  }
}

/**
 * The patient's appointment actions (ADR-049).
 *
 * `@Authenticated()` rather than `@Can(...)`: a patient holds no
 * capabilities (ADR-030 §6). The service admits the `patient` role only
 * (403 `patient_only`), resolves the patient from the session, and scopes
 * every row in its WHERE — there is no patient parameter on any route.
 */
@Authenticated()
@Controller('me')
export class PatientBookingController {
  constructor(private readonly bookings: PatientBookingService) {}

  @Post('appointments')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  book(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string | undefined,
    @Body(zodBody(patientBookSchema)) body: PatientBookInput,
  ): Promise<PatientAppointmentDetail & { clinicTimezone: string }> {
    requireIdempotencyKey(key);
    return this.bookings.book(principalOf(user), body);
  }

  @Post('appointments/:appointmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(patientCancelSchema)) body: PatientCancelInput,
  ): Promise<PatientAppointmentDetail & { clinicTimezone: string }> {
    return this.bookings.cancel(principalOf(user), appointmentId, body);
  }

  @Post('appointments/:appointmentId/reschedule-requests')
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  requestReschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Headers('idempotency-key') key: string | undefined,
    @Param('appointmentId') appointmentId: string,
    @Body(zodBody(patientRescheduleRequestSchema)) body: PatientRescheduleRequestInput,
  ): Promise<RescheduleRequestView> {
    requireIdempotencyKey(key);
    return this.bookings.requestReschedule(principalOf(user), appointmentId, body);
  }

  @NotPhi('the patient’s own reschedule requests (self access)')
  @Get('appointments/:appointmentId/reschedule-requests')
  listRequests(
    @CurrentUser() user: AuthenticatedUser,
    @Param('appointmentId') appointmentId: string,
  ): Promise<RescheduleRequestView[]> {
    return this.bookings.listRequests(principalOf(user), appointmentId);
  }

  @Post('reschedule-requests/:requestId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<RescheduleRequestView> {
    return this.bookings.withdraw(principalOf(user), requestId);
  }
}

/** Patient discovery reads owned by the appointments module (contract §2–§3). */
@Authenticated()
@Controller('patient')
export class PatientSlotController {
  constructor(private readonly bookings: PatientBookingService) {}

  @NotPhi('published slots — organisational availability, no patient data')
  @Get('doctors/:doctorId/slots')
  slots(
    @CurrentUser() user: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Query(zodQuery(patientSlotQuerySchema)) query: PatientSlotQuery,
  ): Promise<PatientSlotView[]> {
    return this.bookings.slots(principalOf(user), doctorId, query);
  }

  @NotPhi('the visit-type catalogue')
  @Get('visit-types')
  visitTypes(@CurrentUser() user: AuthenticatedUser): Promise<PatientVisitTypeView[]> {
    return this.bookings.visitTypes(principalOf(user));
  }
}
