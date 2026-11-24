import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import {
  AdminScoped,
  Can,
  CurrentAdminScope,
  hospitalFilterOf,
  type ResolvedAdminScope,
} from '../../../shared/authz';
import type { DoctorEmploymentView, EndEmploymentResult } from '../dto/doctor-employment.dto';
import { startEmploymentSchema, type StartEmploymentInput } from '../dto/doctor-employment.schema';
import { DoctorAdminScopeService } from '../services/doctor-admin-scope.service';
import { DoctorEmploymentService } from '../services/doctor-employment.service';

/**
 * The doctor employment lifecycle (OD-12, gap G3, stage S6 — GitHub #54).
 *
 * Beside `AdminDoctorController` under the same `doctors/:doctorId` tree
 * and the same capability, `doctors.manage` (admin, platform-wide per
 * OD-07). `doctorId` is the `doctors.id` uuid, as on every administrator
 * doctor route; the hospital is named by its public id in the body.
 */
// S5 (OD-07): Platform Admin — every employment; Hospital Admin — its own
// hospital's doctors and employments only, hiring only into its own hospital
// (`DoctorAdminScopeService`), others 404; no administrative scope — 403.
@AdminScoped('any')
@Controller('doctors/:doctorId/employments')
export class DoctorEmploymentController {
  constructor(
    private readonly employments: DoctorEmploymentService,
    private readonly scopes: DoctorAdminScopeService,
  ) {}

  /** The doctor's employments, active and ended, newest first. */
  @Can('doctors.manage')
  @Get()
  async list(
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('doctorId') doctorId: string,
  ): Promise<DoctorEmploymentView[]> {
    await this.scopes.assertDoctor(scope, doctorId);
    return this.employments.list(doctorId, hospitalFilterOf(scope));
  }

  /** Start an employment. 409 while another is active (DR-02). */
  @Can('doctors.manage')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async start(
    @CurrentUser() actor: AuthenticatedUser,
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('doctorId') doctorId: string,
    @Body(zodBody(startEmploymentSchema)) body: StartEmploymentInput,
  ): Promise<DoctorEmploymentView> {
    await this.scopes.assertCanStart(scope, doctorId, body.hospitalId);
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
  async end(
    @CurrentUser() actor: AuthenticatedUser,
    @CurrentAdminScope() scope: ResolvedAdminScope,
    @Param('doctorId') doctorId: string,
    @Param('employmentId') employmentId: string,
  ): Promise<EndEmploymentResult> {
    await this.scopes.assertEmployment(scope, doctorId, employmentId);
    return this.employments.end(actor, doctorId, employmentId);
  }
}
