import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can, PlatformScope } from '../../../shared/authz';
import {
  endAccessSchema,
  grantAdminSchema,
  startAffiliationSchema,
  startEmploymentSchema,
  transferSchema,
  type EndAccessInput,
  type GrantAdminInput,
  type StartAffiliationInput,
  type StartEmploymentInput,
  type TransferInput,
} from '../dto/hospital-staffing.schema';
import {
  HospitalStaffingService,
  type StaffingResult,
} from '../services/hospital-staffing.service';

/** A malformed id is an unknown resource, answered as such. */
const uuidParam = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

/**
 * Hospital staffing and administrative scope (multi-hospital §2.2–§2.6).
 * Capability first (`doctors.manage` / `roles.manage`, admin-only by the
 * server policy), then tier: `@PlatformScope()` routes refuse a Hospital
 * Admin; the others confine a Hospital Admin to its own hospital in the
 * service.
 */
@Controller()
export class HospitalStaffingController {
  constructor(private readonly staffing: HospitalStaffingService) {}

  @Can('doctors.manage')
  @Post('hospitals/:hospitalId/doctor-employments')
  startEmployment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(startEmploymentSchema)) body: StartEmploymentInput,
  ): Promise<StaffingResult> {
    return this.staffing.startEmployment(actor, hospitalId, body);
  }

  @Can('doctors.manage')
  @Post('hospitals/:hospitalId/doctor-employments/:employmentId/end')
  @HttpCode(HttpStatus.OK)
  endEmployment(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('employmentId', uuidParam) employmentId: string,
    @Body(zodBody(endAccessSchema)) body: EndAccessInput,
  ): Promise<StaffingResult> {
    return this.staffing.endEmployment(actor, hospitalId, employmentId, body);
  }

  @Can('doctors.manage')
  @PlatformScope()
  @Post('doctors/:doctorId/transfer')
  @HttpCode(HttpStatus.OK)
  transfer(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('doctorId', uuidParam) doctorId: string,
    @Body(zodBody(transferSchema)) body: TransferInput,
  ): Promise<StaffingResult> {
    return this.staffing.transfer(actor, doctorId, body);
  }

  @Can('roles.manage')
  @Post('hospitals/:hospitalId/staff-affiliations')
  startAffiliation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(startAffiliationSchema)) body: StartAffiliationInput,
  ): Promise<StaffingResult> {
    return this.staffing.startAffiliation(actor, hospitalId, body);
  }

  @Can('roles.manage')
  @Post('hospitals/:hospitalId/staff-affiliations/:affiliationId/end')
  @HttpCode(HttpStatus.OK)
  endAffiliation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('affiliationId', uuidParam) affiliationId: string,
    @Body(zodBody(endAccessSchema)) body: EndAccessInput,
  ): Promise<StaffingResult> {
    return this.staffing.endAffiliation(actor, hospitalId, affiliationId, body);
  }

  @Can('roles.manage')
  @PlatformScope()
  @Post('hospitals/:hospitalId/admins')
  assignHospitalAdmin(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Body(zodBody(grantAdminSchema)) body: GrantAdminInput,
  ): Promise<StaffingResult> {
    return this.staffing.assignHospitalAdmin(actor, hospitalId, body);
  }

  @Can('roles.manage')
  @PlatformScope()
  @Post('hospitals/:hospitalId/admins/:userId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeHospitalAdmin(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('hospitalId', uuidParam) hospitalId: string,
    @Param('userId') userId: string,
    @Body(zodBody(endAccessSchema)) body: EndAccessInput,
  ): Promise<StaffingResult> {
    return this.staffing.revokeHospitalAdmin(actor, hospitalId, userId, body);
  }

  @Can('roles.manage')
  @PlatformScope()
  @Post('platform/admins')
  grantPlatformAdmin(
    @CurrentUser() actor: AuthenticatedUser,
    @Body(zodBody(grantAdminSchema)) body: GrantAdminInput,
  ): Promise<StaffingResult> {
    return this.staffing.grantPlatformAdmin(actor, body);
  }

  @Can('roles.manage')
  @PlatformScope()
  @Post('platform/admins/:userId/revoke')
  @HttpCode(HttpStatus.OK)
  revokePlatformAdmin(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body(zodBody(endAccessSchema)) body: EndAccessInput,
  ): Promise<StaffingResult> {
    return this.staffing.revokePlatformAdmin(actor, userId, body);
  }
}
