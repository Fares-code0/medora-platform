import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { Can, HospitalScope } from '../../../shared/authz';
import { RateLimited } from '../../../shared/rate-limit';
import type { AccountLinkedView, AccountUnlinkedView } from '../dto/patient-account-link.dto';
import { accountLinkSchema, type AccountLinkInput } from '../dto/patient-account-link.schema';
import { PatientAccountLinkService } from '../services/patient-account-link.service';

/**
 * Staff-mediated account linking at the hospital desk (ADR-048, contract §1).
 *
 * `patients.manageAccounts` is the administrator's governance capability over
 * patient accounts (API §4.11) — exactly this. `@HospitalScope()` opens the
 * routes to a Hospital Admin, and the service confines them to records their
 * hospital holds (404 otherwise, like every other out-of-reach record).
 *
 * The link route is rate limited: it is the one place a code is checked, so
 * it is where guessing would happen.
 */
@Can('patients.manageAccounts')
@HospitalScope()
@Controller('patients/:patientId/account-link')
export class PatientAccountLinkController {
  constructor(private readonly links: PatientAccountLinkService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimited('auth')
  link(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
    @Body(zodBody(accountLinkSchema)) body: AccountLinkInput,
  ): Promise<AccountLinkedView> {
    return this.links.link(user, patientId, body);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  unlink(
    @CurrentUser() user: AuthenticatedUser,
    @Param('patientId') patientId: string,
  ): Promise<AccountUnlinkedView> {
    return this.links.unlink(user, patientId);
  }
}
