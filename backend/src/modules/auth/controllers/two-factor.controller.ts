import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Authenticated, NotPhi, OutsideClinicalStanding } from '../../../shared/authz';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import {
  confirmReenrollmentSchema,
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  setupTwoFactorSchema,
  startReenrollmentSchema,
} from '../dto/two-factor.schema';
import type { TotpEnrolment } from '../services/totp.service';
import {
  type ReenrollmentResult,
  type ReenrollmentStart,
  TwoFactorService,
  type TwoFactorStatus,
} from '../services/two-factor.service';

/**
 * TOTP enrolment (RM M6.4, API §2.9).
 *
 * Mounted under `/me`, which is the account surface the doctor Settings
 * centre reads, rather than under `/auth`. That follows the contract:
 * §2.9 lists these among "Users & Account", because they are things a
 * signed-in user does to their own account — unlike §1, which is how
 * someone becomes signed in. Every route here acts on the caller's own
 * account, so `@Authenticated()` at class level is the whole
 * authorization rule — the token's subject is the decision. `@Public()`
 * appears nowhere in this file.
 *
 * The routes live in the auth module even though the path is `/me`,
 * because they need the envelope key, the password hasher and the
 * session revoker — all of which are auth's, and none of which M2.2's
 * zone 1 would let the users module borrow.
 */
@Authenticated()
// F-09: on the allowlist for an account outside clinical standing.
@OutsideClinicalStanding()
@Controller('me/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  /**
   * `{ enabled, recoveryCodesRemaining }` — the 2FA settings view.
   *
   * The only place the remaining recovery-code count is served (owner
   * decision R2): not in the redemption response and not in the mail.
   */
  @NotPhi('the caller’s own two-factor status')
  @Get()
  status(@CurrentUser() user: AuthenticatedUser): Promise<TwoFactorStatus> {
    return this.twoFactor.status(user);
  }

  /**
   * API §2.9 — `{ password }` → `{ otpauthUrl, secret, recoveryCodes }`.
   *
   * Returns the recovery codes once; they are stored as keyed digests
   * inside the encrypted column and can never be read back. **409** when
   * 2FA is already enabled: an existing factor is replaced only through
   * `/reenroll` (owner decision Q7 / R4). The current password is required
   * first (owner decision D2): **401 `invalid_credentials`** when wrong,
   * **429** once the shared guess budget is spent, and nothing is issued
   * in either case.
   */
  @Post('setup')
  @HttpCode(HttpStatus.OK)
  setup(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(setupTwoFactorSchema)) body: ReturnType<typeof setupTwoFactorSchema.parse>,
  ): Promise<TotpEnrolment> {
    return this.twoFactor.setup(user, body.password);
  }

  /** API §2.9 — 204. The flag flips only once a code from the app checks out. */
  @Post('enable')
  @HttpCode(HttpStatus.NO_CONTENT)
  enable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(enableTwoFactorSchema)) body: ReturnType<typeof enableTwoFactorSchema.parse>,
  ): Promise<void> {
    return this.twoFactor.enable(user, body.code);
  }

  /**
   * Re-enrollment, step 1 of 2 (owner decision Q7 / R4): the current
   * password and a code from the current authenticator. Returns the new
   * secret and an enrollment token; nothing changes yet, and the old factor
   * and recovery codes keep working.
   */
  @Post('reenroll')
  @HttpCode(HttpStatus.OK)
  startReenrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(startReenrollmentSchema)) body: ReturnType<typeof startReenrollmentSchema.parse>,
  ): Promise<ReenrollmentStart> {
    return this.twoFactor.startReenrollment(user, body.password, body.code);
  }

  /**
   * Re-enrollment, step 2 of 2: a code from the new secret. Only now are
   * the factor and the recovery codes replaced, atomically; the new codes
   * are returned once.
   */
  @Post('reenroll/confirm')
  @HttpCode(HttpStatus.OK)
  confirmReenrollment(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(confirmReenrollmentSchema))
    body: ReturnType<typeof confirmReenrollmentSchema.parse>,
  ): Promise<ReenrollmentResult> {
    return this.twoFactor.completeReenrollment(user, body.enrolmentToken, body.code);
  }

  /** API §2.9 — 204. Password, not a code; every other session ends. */
  @Post('disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(disableTwoFactorSchema)) body: ReturnType<typeof disableTwoFactorSchema.parse>,
  ): Promise<void> {
    return this.twoFactor.disable(user, body.password);
  }
}
