import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, PhiRead } from '../../../shared/authz';
import type { RescheduleRequestView } from '../dto/patient-appointment.dto';
import {
  rejectRescheduleRequestSchema,
  rescheduleRequestListSchema,
  type RejectRescheduleRequestInput,
  type RescheduleRequestListQuery,
} from '../dto/patient-appointment.schema';
import { RescheduleRequestService } from '../services/reschedule-request.service';

/**
 * The clinic's queue of patient reschedule requests (ADR-049).
 *
 * Same capability and same doctor scope as the appointment book. Registered
 * **before** `AppointmentController` in the module, so
 * `GET /appointments/reschedule-requests` is matched here rather than read
 * as `GET /appointments/:appointmentId`.
 */
@Can('appointments.manageOwn')
@Controller('appointments/reschedule-requests')
export class RescheduleRequestController {
  constructor(private readonly requests: RescheduleRequestService) {}

  @PhiRead('appointment_reschedule_requests')
  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(rescheduleRequestListSchema)) query: RescheduleRequestListQuery,
  ): Promise<RescheduleRequestView[]> {
    return this.requests.list(user, query);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':requestId/approve')
  approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
  ): Promise<RescheduleRequestView> {
    return this.requests.approve(user, requestId);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':requestId/reject')
  reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('requestId') requestId: string,
    @Body(zodBody(rejectRescheduleRequestSchema)) body: RejectRescheduleRequestInput,
  ): Promise<RescheduleRequestView> {
    return this.requests.reject(user, requestId, body);
  }
}
