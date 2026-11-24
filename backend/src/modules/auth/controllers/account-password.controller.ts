import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Authenticated, OutsideClinicalStanding } from '../../../shared/authz';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { changePasswordSchema, verifyPasswordSchema, type VerifyPasswordInput } from '../dto';
import { PasswordRecoveryService } from '../services/password-recovery.service';
import { ReauthenticationService } from '../services/reauthentication.service';

/**
 * `POST /me/password` (RM M6.5, API §2.3).
 *
 * Listed under "Users & Account" in the contract and owned by M6.5 in
 * the roadmap, which is not a contradiction: the *route* belongs to the
 * account surface, and the *rules* — the policy, the differs-from-current
 * check, the session revocation — are the password lifecycle this
 * milestone owns. It lives beside the 2FA controller for the same reason
 * that one does: the hasher and the session revoker are auth's, and
 * zone 1 would not let the users module borrow them.
 */
@Authenticated()
// F-09: on the allowlist for an account outside clinical standing.
@OutsideClinicalStanding()
@Controller('me/password')
export class AccountPasswordController {
  constructor(
    private readonly recovery: PasswordRecoveryService,
    private readonly reauthentication: ReauthenticationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  change(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(changePasswordSchema)) body: ReturnType<typeof changePasswordSchema.parse>,
  ): Promise<void> {
    return this.recovery.change(user, body.currentPassword, body.newPassword);
  }

  /**
   * The lock screen's re-authentication (`docs/handoff/auth-seam.md`
   * §4.1). 204 for the right password, and nothing is issued — the
   * session being unlocked is the one that stays. See
   * `ReauthenticationService` for the shared guess budget.
   */
  @Post('verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  verify(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(verifyPasswordSchema)) body: VerifyPasswordInput,
  ): Promise<void> {
    return this.reauthentication.verify(user, body.password);
  }
}
