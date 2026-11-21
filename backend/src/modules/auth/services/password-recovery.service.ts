import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PrismaService } from '../../../shared/database';
import type { Prisma } from '../../../generated/prisma/client';
import { TokenKind } from '../../../generated/prisma/enums';
import { IdentityRepository } from '../repositories/identity.repository';

import { AuthMailService } from './auth-mail.service';
import { PasswordService } from './password.service';
import { RESEND_COOLDOWN_SECONDS } from './otp-challenge.service';
import { ReauthenticationService } from './reauthentication.service';
import { SessionService } from './session.service';
import { PASSWORD_RESET_TTL_SECONDS, VerificationTokenService } from './verification-token.service';

/**
 * Forgot, reset and change (RM M6.5 — API §1.7, §1.8, §2.3).
 *
 * ## The anti-enumeration contract
 *
 * `forgot` answers **202 `{ accepted: true }` always** — for a real
 * address, an unknown one, a deactivated account, and an address whose
 * cooldown has not elapsed. API §1.7 fixes this, and the reason is that
 * the endpoint is unauthenticated: any difference at all, in the body,
 * the status or the timing, turns it into a way of asking "does this
 * person have an account here", which in a clinic is a question about
 * employment rather than about software.
 *
 * The cooldown is therefore enforced by *not sending*, never by
 * answering differently — a 429 here would leak precisely what the 202
 * exists to hide.
 *
 * ## Resetting ends every session
 *
 * API §1.8. Someone resets a password because they have lost control of
 * it, and a reset that left the attacker's session running would be a
 * reset in name only. `change` is different: it revokes every session
 * *but the current one*, because there the user is present and signed
 * in, and signing them out of the page they are standing on is a
 * punishment for good behaviour (API §2 business rules).
 */
@Injectable()
export class PasswordRecoveryService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly tokens: VerificationTokenService,
    private readonly mail: AuthMailService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly reauthentication: ReauthenticationService,
    private readonly prisma: PrismaService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /** Always resolves. See the anti-enumeration note above. */
  async forgot(email: string): Promise<void> {
    const user = await this.identity.findByEmail(email.trim());
    if (user === null) return;

    const lastIssued = await this.tokens.lastIssuedAt(user.id, TokenKind.PASSWORD_RESET);
    if (lastIssued !== null && withinCooldown(lastIssued)) return;

    const token = await this.tokens.issue(
      user.id,
      TokenKind.PASSWORD_RESET,
      PASSWORD_RESET_TTL_SECONDS,
    );
    await this.mail.sendPasswordReset(user.email, token.raw, user.displayName);
  }

  /**
   * API §1.8 — 204, or 422 `token_invalid`.
   *
   * ## One transaction: the claim, the password, the revocation
   *
   * The token used to be spent *first*, in its own write, and everything
   * after it could still fail. A reset for an account with no
   * `user_credentials` row did exactly that: the update found no row
   * (P2025), the request answered 500, and the link was already burned —
   * an unchanged password and no way to retry.
   *
   * Now the token is only *checked* up front, the Argon2id hash is
   * computed outside any transaction (it is the slow step and holds no
   * lock), and the claim, the credential write and the session revocation
   * commit together or not at all. A failure anywhere leaves the token
   * unspent and every session as it was. Two requests racing on one link
   * serialise on the token row inside the transaction; the loser's claim
   * changes nothing and it answers `token_invalid` (see
   * `VerificationTokenService.claim`).
   *
   * ## An account with no credential row gets one
   *
   * The link proves control of the address, which is what a reset has
   * always rested on, so an account that has never had a password — the
   * seeded demo accounts before provisioning, or any account created
   * without one — is *given* one here rather than refused. Nothing else
   * about the account changes: `users.status`, email verification and the
   * administrator second-factor rule are all still enforced at sign-in.
   */
  async reset(rawToken: string, newPassword: string, ipAddress?: string): Promise<void> {
    const pending = await this.tokens.inspect(rawToken, TokenKind.PASSWORD_RESET);
    if (pending === null) throw tokenInvalid();

    const user = await this.identity.findById(pending.userId);
    // The account was deactivated after the link was sent. Same answer as
    // a dead link, and the same answer on every retry: the token is left
    // unspent, but it names an account `findById` will never return.
    if (user === null) throw tokenInvalid();

    const passwordHash = await this.passwords.hash(newPassword);

    await this.prisma.$transaction(async (tx) => {
      if (!(await this.tokens.claim(pending.id, tx))) throw tokenInvalid();

      await writeCredential(tx, user.id, passwordHash);

      // Every session, including the one the attacker may be holding — and
      // only once the new password is certain to commit with it.
      await this.sessions.revokeAllFor(user.id, tx);
    });

    await this.recordActivity(user.id, 'Password reset');

    await this.audit.record({
      action: 'auth.password_reset',
      actor: {
        userId: user.id,
        role: user.role.code,
        ...(ipAddress === undefined ? {} : { ipAddress }),
      },
      entityType: 'user',
      entityId: user.publicId,
    });
  }

  /**
   * API §2.3 — 204. Current password, policy, and it must actually differ.
   *
   * The current password is checked by the lock screen's re-authentication
   * (owner decision D1, 2026-11-14; `docs/mfa-recovery/addenda/`): a wrong
   * one spends from the account's one guess budget, the guess that reaches
   * the limit locks the account and revokes this session (429), and a right
   * one clears the counter. Before D1 this route checked the password with
   * no budget at all — an unbounded guessing oracle behind any live session.
   */
  async change(
    principal: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.identity.findById(principal.id);
    if (user?.credentials == null) throw AppException.notFound('Account not found');

    await this.reauthentication.verify(principal, currentPassword);

    // Verified against the stored hash rather than by comparing the two
    // strings, because the *stored* value is what "differs from current"
    // has to mean — a caller could otherwise pass a differently-cased
    // copy and be told it is a new password.
    if (await this.passwords.verify(user.credentials.passwordHash, newPassword)) {
      throw AppException.validation(
        { newPassword: ['Choose a password you have not used here before'] },
        'The new password must differ from the current one',
        'weak_password',
      );
    }

    // An update, not `writeCredential`'s upsert: the guard above has
    // already proved the row exists, and a change never creates one.
    await this.prisma.db.userCredential.update({
      where: { userId: user.id },
      data: {
        passwordHash: await this.passwords.hash(newPassword),
        passwordUpdatedAt: new Date(),
        // A password change is also the end of a lockout: the person who
        // proved they can change it is not the person being locked out.
        failedAttempts: 0,
        lockedUntil: null,
      },
    });

    // Every session but this one: the user is present, and signing them
    // out of the page they are standing on is a punishment for a good
    // habit. The [RECOMMENDATION] in API §2's business rules; MG's
    // preamble makes those non-binding, and this one is worth taking.
    await this.revokeOtherSessions(user.id, principal.sessionId);
    await this.recordActivity(user.id, 'Password changed');

    await this.audit.record({
      action: 'auth.password_change',
      actor: { userId: user.id, role: user.role.code },
      entityType: 'user',
      entityId: user.publicId,
    });
  }

  private async revokeOtherSessions(userId: string, keepSessionId: string): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { userId, revokedAt: null, id: { not: keepSessionId } },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * DB §A12 — `kind: 'password'`, which API §1.8 names explicitly.
   *
   * Through the M8.6 recorder rather than a direct `create`. The reason
   * is not tidiness: the recorder swallows and logs a write failure,
   * where this method used to let one propagate — so a full disk or a
   * locked table would have turned a *completed* password change into a
   * 500 the client retries, and the retry would present the old password
   * that no longer works. The feed is a convenience; the password change
   * it describes has already happened.
   */
  private async recordActivity(userId: string, summary: string): Promise<void> {
    await this.activity.record({ userId, kind: 'password', summary });
  }
}

/**
 * Writes a new password hash, creating the credential row if the account
 * has none.
 *
 * An upsert on `user_credentials`' primary key (`user_id`), so it is one
 * `INSERT … ON CONFLICT DO UPDATE` and two writers for one account cannot
 * both insert: the row is created once and updated thereafter, never
 * duplicated and never missing — the P2025 this replaced was an `update`
 * that assumed the row.
 *
 * A password change is also the end of a lockout: the person who proved
 * they can change it is not the person being locked out. A newly created
 * row starts at the column defaults, which are the same state. The
 * second-factor columns are never touched here.
 */
async function writeCredential(
  client: Prisma.TransactionClient,
  userId: string,
  passwordHash: string,
): Promise<void> {
  const passwordUpdatedAt = new Date();

  await client.userCredential.upsert({
    where: { userId },
    create: { userId, passwordHash, passwordUpdatedAt },
    update: { passwordHash, passwordUpdatedAt, failedAttempts: 0, lockedUntil: null },
  });
}

/**
 * 422 `token_invalid` — unknown, expired, already used, or the right
 * token for the wrong purpose.
 *
 * 422 and not 401, because API §1.8 says so: the token is a field of the
 * request body rather than a credential in a header, and the frontend's
 * `ResetPasswordPage` branches on the code, not the status.
 */
function tokenInvalid(): AppException {
  return AppException.validation(
    { token: ['This link is no longer valid'] },
    'This reset link is no longer valid',
    'token_invalid',
  );
}

/**
 * The same 30 seconds the OTP resend uses, and the same reasoning: the
 * frontend renders a countdown from `RESEND_SECONDS = 30`.
 */
function withinCooldown(lastIssuedAt: Date): boolean {
  return Date.now() - lastIssuedAt.getTime() < RESEND_COOLDOWN_SECONDS * 1_000;
}
