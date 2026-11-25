import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { TransactionalAuditWriter } from '../../../shared/audit';
import { PrismaService } from '../../../shared/database';
import { IdentityRepository } from '../repositories/identity.repository';

import { AuthMailService } from './auth-mail.service';
import { LoginService, type LoginSuccess, type RequestContext } from './login.service';
import {
  OtpChallengeService,
  RESEND_COOLDOWN_SECONDS,
  OTP_CHALLENGE_TTL_SECONDS,
} from './otp-challenge.service';
import { RecoveryCodeService } from './recovery-code.service';
import { TotpService } from './totp.service';
import { TwoFactorService } from './two-factor.service';

/**
 * `POST /auth/otp/verify` and `/auth/otp/resend` (RM M6.4, API §1.3–1.4).
 *
 * The second half of the sign-in M6.2 left suspended. The session it
 * creates goes through `LoginService.establishSession`, the same call
 * the password-only path uses — a session established after a second
 * factor must be indistinguishable from one established without, and the
 * only way to guarantee that is for there to be one implementation.
 *
 * ## What "resend" means when the code comes from an app
 *
 * Nothing is sent. The six digits live in the user's authenticator and
 * rotate every thirty seconds on their own; there is no message to
 * repeat. The endpoint keeps its contract — 204, refused with 429 inside
 * the cooldown, attempt count **not** reset — but since the owner's
 * 2026-11-06 decision it gives **no more time**: the challenge's deadline
 * is absolute, ten minutes from issue (`OTP_CHALLENGE_TTL_SECONDS`), and a
 * resend never moves it. The still-valid challenge is not replaced either,
 * so a resend cannot invalidate a code the user is about to type.
 *
 * The frontend's countdown is real either way: `VerifyOtpPage` declares
 * `RESEND_SECONDS = 30`, so the cooldown here is 30 seconds. When M19
 * adds email and SMS channels this is the method that gains a delivery.
 */
@Injectable()
export class StepUpService {
  private readonly logger = new Logger(StepUpService.name);

  constructor(
    private readonly challenges: OtpChallengeService,
    private readonly twoFactor: TwoFactorService,
    private readonly totp: TotpService,
    private readonly identity: IdentityRepository,
    private readonly login: LoginService,
    private readonly prisma: PrismaService,
    private readonly recoveryCodes: RecoveryCodeService,
    private readonly disclosureAudit: TransactionalAuditWriter,
    private readonly mail: AuthMailService,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  async verify(
    otpToken: string,
    code: string,
    context: RequestContext = {},
  ): Promise<LoginSuccess> {
    const challenge = await this.challenges.resolve(otpToken);
    // Forged, expired, already used, or out of attempts — API §1.3 gives
    // them all the same 401, so nothing here distinguishes them.
    if (challenge === null) throw otpInvalid();

    const secret = await this.twoFactor.secretFor(challenge.userId);
    if (secret === null || !this.totp.verify(secret, code)) {
      const spent = await this.challenges.countFailure(challenge.challengeId);
      // The bound is the same `loginAttemptLimit` the password lockout
      // uses. Reusing it is deliberate: it is the platform's answer to
      // "how many tries", and a second number would be a second thing an
      // administrator has to find (ADR-025).
      if (spent) throw AppException.rateLimited(OTP_CHALLENGE_TTL_SECONDS, 'Too many attempts');
      throw otpInvalid();
    }

    // Claimed before the session is created, and the claim decides. Two
    // verifications of one challenge arriving together must not both
    // mint a session.
    if (!(await this.challenges.consume(challenge.challengeId))) throw otpInvalid();

    const user = await this.identity.findById(challenge.userId);
    // Deactivated between the password check and the code. Rare, and the
    // one case where a valid code must still not produce a session.
    if (user === null) throw otpInvalid();
    // L5: suspended or terminated while the challenge was open.
    await this.login.assertMaySignIn(user, context);

    return this.login.establishSession(user, challenge.rememberMe, context);
  }

  /**
   * `POST /auth/otp/recovery` — completes a suspended sign-in with a
   * recovery code instead of an authenticator code (owner decision R1).
   *
   * ## Bound to the pending challenge
   *
   * The code is accepted only against a live `otpToken`: the password has
   * already been proved at `/auth/login`, so a recovery code replaces the
   * **second** factor and never the first. The challenge's attempt bound is
   * the same one the six-digit path spends, so the two paths share one
   * guess budget per challenge.
   *
   * ## Atomic and single-use
   *
   * One transaction, under a row lock on the account's credentials:
   * match → spend the challenge → write back the remaining digests →
   * insert the audit row. Two redemptions of one code (on one challenge or
   * on two) serialise on the lock; the second finds the code gone. If the
   * audit row cannot be written the whole redemption rolls back with
   * 503 `audit_unavailable`: the code stays unspent and nothing is issued,
   * because a recovery that cannot be recorded must not happen.
   *
   * ## What it does not do
   *
   * It does not turn 2FA off and it does not tell the caller how many codes
   * remain — that count is shown only in the 2FA settings (owner decision
   * R2, `GET /me/2fa`). The session it creates is the ordinary one.
   *
   * ## The notification (R3)
   *
   * Sent after the session exists, and its failure changes nothing: the
   * mailer port never throws by contract, and the call is guarded anyway.
   * The audit row was committed with the redemption, so the event is
   * recorded whether or not the mail arrives.
   */
  async redeemRecoveryCode(
    otpToken: string,
    recoveryCode: string,
    context: RequestContext = {},
  ): Promise<LoginSuccess> {
    const challenge = await this.challenges.resolve(otpToken);
    if (challenge === null) throw otpInvalid();

    const user = await this.identity.findById(challenge.userId);
    if (user === null) throw otpInvalid();
    // L5, before anything is redeemed: an account suspended or terminated
    // while the challenge was open is refused without spending one of its
    // recovery codes (nor the challenge).
    await this.login.assertMaySignIn(user, context);

    const outcome = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT user_id FROM user_credentials WHERE user_id = ${user.id}::uuid FOR UPDATE`;

      const credential = await tx.userCredential.findUnique({
        where: { userId: user.id },
        select: { recoveryCodesEnc: true },
      });
      const stored = this.recoveryCodes.open(credential?.recoveryCodesEnc ?? null);
      const index = stored === null ? -1 : this.recoveryCodes.match(stored, recoveryCode);
      if (stored === null || index === -1) return { kind: 'no-match' } as const;

      // Spent first and decided by row count, exactly as the six-digit
      // path does: a challenge already used by a parallel verification
      // must not also be redeemable here.
      if (!(await this.challenges.consumeWithin(tx, challenge.challengeId))) {
        return { kind: 'spent' } as const;
      }

      const remaining = stored.digests.filter((_, position) => position !== index);
      await tx.userCredential.update({
        where: { userId: user.id },
        data: { recoveryCodesEnc: this.recoveryCodes.sealDigests(remaining) },
      });

      await this.disclosureAudit.recordWithin(tx, {
        action: 'auth.recovery_code_used',
        actor: {
          userId: user.id,
          role: user.role.code,
          ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
        },
        entityType: 'user',
        entityId: user.publicId,
        // The count is an investigator's fact ("how many were left when
        // this was used"); it is never returned to the caller.
        metadata: { remaining: remaining.length },
      });

      return { kind: 'redeemed' } as const;
    });

    if (outcome.kind === 'spent') throw otpInvalid();
    if (outcome.kind === 'no-match') {
      const spent = await this.challenges.countFailure(challenge.challengeId);
      if (spent) throw AppException.rateLimited(OTP_CHALLENGE_TTL_SECONDS, 'Too many attempts');
      throw otpInvalid();
    }

    const session = await this.login.establishSession(user, challenge.rememberMe, context);

    await this.activity.record({
      userId: user.id,
      kind: 'security',
      summary: 'Signed in with a recovery code',
    });

    try {
      await this.mail.sendRecoveryCodeUsed(user.email, user.displayName, new Date());
    } catch (error) {
      // The mailer port does not throw; this guard keeps that a property of
      // this method rather than of whichever adapter is bound.
      this.logger.warn({ auth: 'recovery-code-mail-failed' }, describe(error));
    }

    return session;
  }

  /**
   * Starts a new resend cooldown. Returns the seconds a caller must wait
   * next time.
   *
   * It does **not** extend the challenge: `expires_at` is left exactly as
   * issued (absolute ten-minute deadline, owner decision 2026-11-06, C-11).
   * An expired challenge resolves to `null` here and answers 401, so the
   * caller has to sign in again for a new challenge.
   */
  async resend(otpToken: string): Promise<number> {
    const challenge = await this.challenges.resolve(otpToken);
    if (challenge === null) throw otpInvalid();

    const elapsedSeconds = (Date.now() - challenge.createdAt.getTime()) / 1_000;
    const waitFor = Math.ceil(RESEND_COOLDOWN_SECONDS - elapsedSeconds);
    // Derived from the row rather than from a counter in memory, so the
    // cooldown survives a restart and holds across every instance behind
    // the load balancer.
    if (waitFor > 0) throw AppException.rateLimited(waitFor, 'Wait before requesting another code');

    await this.prisma.db.otpCode.update({
      where: { id: challenge.challengeId },
      data: {
        // `created_at` moves so the next cooldown is measured from this
        // request. Without it, one resend would unlock every later one.
        // It is the cooldown's marker only: the deadline is `expires_at`,
        // fixed at issue and deliberately not written here.
        createdAt: new Date(),
      },
    });

    return RESEND_COOLDOWN_SECONDS;
  }
}

/** The error's class only: never a message that could quote an address. */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}

/** 401 `otp_invalid` — the code `VerifyOtpPage` branches on. */
function otpInvalid(): AppException {
  return AppException.unauthorized('otp_invalid', 'That code is not valid');
}
