import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { TokenKind } from '../../../generated/prisma/enums';
import { IdentityRepository } from '../repositories/identity.repository';

import { AuthMailService } from './auth-mail.service';
import { RESEND_COOLDOWN_SECONDS } from './otp-challenge.service';
import {
  EMAIL_VERIFICATION_TTL_SECONDS,
  VerificationTokenService,
} from './verification-token.service';

/**
 * `POST /auth/verify-email` and `/auth/verification/resend`
 * (RM M6.6, API §1.9–1.10).
 *
 * The other half of M6.1: registration issues the token and sends the
 * link, and this is what the link does. Until it runs, `users.
 * email_verified_at` is null and M6.2 refuses the sign-in with
 * `email_unverified` — so this endpoint is the only thing standing
 * between a registered account and a usable one.
 *
 * ## Verifying twice
 *
 * The second click on the same link is a 422 `token_invalid`, because
 * the token is spent. That is the honest answer and it is what
 * `VerifyEmailPage` renders: the page fires the request from an effect
 * on mount, so a refresh after a successful verification hits exactly
 * this case. A resend is what the user does about it, and the account is
 * verified either way — the second click failing does not undo the
 * first.
 *
 * ## The resend answers the same way for an unknown address
 *
 * As with `forgot-password`, and for the same reason: the endpoint is
 * unauthenticated, and a different answer for an address with no account
 * is an enumeration oracle. An already-verified address is also a silent
 * no-op — telling a caller "that address is already verified" says the
 * account exists.
 */
@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly tokens: VerificationTokenService,
    private readonly mail: AuthMailService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  async verify(rawToken: string, ipAddress?: string): Promise<void> {
    const claim = await this.tokens.consume(rawToken, TokenKind.EMAIL_VERIFICATION);
    if (claim === null) throw tokenInvalid();

    const user = await this.identity.findById(claim.userId);
    if (user === null) throw tokenInvalid();

    // Idempotent on the column: a token can only be claimed once, so
    // this runs at most once per token, and re-stamping an already
    // verified account would move a timestamp someone may be auditing.
    if (user.emailVerifiedAt === null) {
      await this.identity.markEmailVerified(user.id);
    }

    await this.audit.record({
      action: 'user.email_verified',
      actor: {
        userId: user.id,
        role: user.role.code,
        ...(ipAddress === undefined ? {} : { ipAddress }),
      },
      entityType: 'user',
      entityId: user.publicId,
    });
  }

  /** Always resolves — see the note above. */
  async resend(email: string): Promise<void> {
    const user = await this.identity.findByEmail(email.trim());
    if (user === null) return;
    if (user.emailVerifiedAt !== null) return;

    const lastIssued = await this.tokens.lastIssuedAt(user.id, TokenKind.EMAIL_VERIFICATION);
    if (
      lastIssued !== null &&
      Date.now() - lastIssued.getTime() < RESEND_COOLDOWN_SECONDS * 1_000
    ) {
      return;
    }

    const token = await this.tokens.issue(
      user.id,
      TokenKind.EMAIL_VERIFICATION,
      EMAIL_VERIFICATION_TTL_SECONDS,
    );
    await this.mail.sendEmailVerification(user.email, token.raw, user.displayName);
  }
}

/** 422 `token_invalid` (API §1.9), matching the reset flow's shape. */
function tokenInvalid(): AppException {
  return AppException.validation(
    { token: ['This link is no longer valid'] },
    'This verification link is no longer valid',
    'token_invalid',
  );
}
