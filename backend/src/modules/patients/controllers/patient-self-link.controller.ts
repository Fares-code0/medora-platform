import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Authenticated, NotPhi } from '../../../shared/authz';
import { RateLimited } from '../../../shared/rate-limit';
import type {
  PatientInsuranceView,
  PatientLinkCodeView,
  PatientLinkStatusView,
} from '../dto/patient-account-link.dto';
import { PatientAccountLinkService } from '../services/patient-account-link.service';

/**
 * The patient's side of account linking (ADR-048) and their insurance on
 * file (contract §1, §4).
 *
 * `@Authenticated()` rather than `@Can(...)`: a patient holds no capability
 * (ADR-030 §6). The service refuses every other role with 403
 * `patient_only`. The subject is the session — no route takes a patient id.
 */
@Authenticated()
@Controller('me')
export class PatientSelfLinkController {
  constructor(private readonly links: PatientAccountLinkService) {}

  @NotPhi('the caller’s own link state (self access)')
  @Get('patient-link')
  status(@CurrentUser() user: AuthenticatedUser): Promise<PatientLinkStatusView> {
    return this.links.status(user);
  }

  /** Rate limited: issuing is cheap, and each call invalidates the last code. */
  @Post('patient-link/code')
  @HttpCode(HttpStatus.CREATED)
  @RateLimited('auth')
  issueCode(@CurrentUser() user: AuthenticatedUser): Promise<PatientLinkCodeView> {
    return this.links.issueCode(user);
  }

  @NotPhi('the patient’s own insurance on file, last four digits only (self access)')
  @Get('insurance')
  insurance(@CurrentUser() user: AuthenticatedUser): Promise<PatientInsuranceView> {
    return this.links.insurance(user);
  }
}
