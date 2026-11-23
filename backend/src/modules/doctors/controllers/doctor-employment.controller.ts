import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can } from '../../../shared/authz';
import type { DoctorEmploymentView, EndEmploymentResult } from '../dto/doctor-employment.dto';
import { startEmploymentSchema, type StartEmploymentInput } from '../dto/doctor-employment.schema';
import { DoctorEmploymentService } from '../services/doctor-employment.service';

/**
 * The doctor employment lifecycle (OD-12, gap G3, stage S6 — GitHub #54).
 *
 * Beside `AdminDoctorController` under the same `doctors/:doctorId` tree
 * and the same capability, `doctors.manage` (admin, platform-wide per
 * OD-07). `doctorId` is the `doctors.id` uuid, as on every administrator
 * doctor route; the hospital is named by its public id in the body.
 */
@Controller('doctors/:doctorId/employments')
export class DoctorEmploymentController {
  constructor(private readonly employments: DoctorEmploymentService) {}

  /** The doctor's employments, active and ended, newest first. */
  @Can('doctors.manage')
  @Get()
  list(@Param('doctorId') doctorId: string): Promise<DoctorEmploymentView[]> {
    return this.employments.list(doctorId);
  }

  /** Start an employment. 409 while another is active (DR-02). */
  @Can('doctors.manage')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  start(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Body(zodBody(startEmploymentSchema)) body: StartEmploymentInput,
  ): Promise<DoctorEmploymentView> {
    return this.employments.start(actor, doctorId, body);
  }

  /**
   * End an employment. OD-12: immediate — the employment's care
   * assignments and every session of the doctor's account are revoked in
   * the same transaction, so the doctor's next request answers 401.
   */
  @Can('doctors.manage')
  @Post(':employmentId/end')
  @HttpCode(HttpStatus.OK)
  end(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId') doctorId: string,
    @Param('employmentId') employmentId: string,
  ): Promise<EndEmploymentResult> {
    return this.employments.end(actor, doctorId, employmentId);
  }
}
