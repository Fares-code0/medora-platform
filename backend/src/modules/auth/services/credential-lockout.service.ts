import { Injectable } from '@nestjs/common';

import { PolicyService } from '../../../config';
import { PrismaService } from '../../../shared/database';

/**
 * The password-guess budget an account has (RM M6.2, API §1.2).
 *
 * One counter — `user_credentials.failed_attempts / locked_until` — and
 * every path that checks a password against an account spends from it:
 * sign-in, and the lock screen's re-authentication (`POST
 * /me/password/verify`). Two budgets would double the guesses an
 * attacker gets, and a lock-screen guess is the more dangerous one:
 * it is made at a workstation somebody walked away from, holding a live
 * session.
 *
 * Extracted from `LoginService` when the second path arrived, unchanged
 * in behaviour: the increment is atomic, the lock is set when the count
 * reaches the policy's `loginAttemptLimit`, and only a success clears it.
 */
@Injectable()
export class CredentialLockoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
  ) {}

  /** Seconds left on an active lock, or 0. */
  remainingSeconds(credentials: { readonly lockedUntil: Date | null } | null): number {
    const lockedUntil = credentials?.lockedUntil ?? null;
    if (lockedUntil === null) return 0;

    const remaining = Math.ceil((lockedUntil.getTime() - Date.now()) / 1_000);
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Records a failure and returns how long the account is now locked for,
   * or 0.
   *
   * The increment is an atomic `{ increment: 1 }` rather than a
   * read-modify-write: parallel guesses against one account would
   * otherwise each read the same counter and the limit would never be
   * reached — which is precisely how an attacker would defeat it.
   */
  async recordFailure(userId: string): Promise<number> {
    const { loginAttemptLimit, lockoutMinutes } = await this.policy.current();
    const lockoutSeconds = lockoutMinutes * 60;

    const updated = await this.prisma.db.userCredential.update({
      where: { userId },
      data: { failedAttempts: { increment: 1 } },
      select: { failedAttempts: true },
    });

    if (updated.failedAttempts < loginAttemptLimit) return 0;

    await this.prisma.db.userCredential.update({
      where: { userId },
      data: { lockedUntil: new Date(Date.now() + lockoutSeconds * 1_000) },
    });

    return lockoutSeconds;
  }

  /**
   * Reserves one second-factor guess from the account's budget (AUTH-07,
   * audit B-09), before the code is checked. Returns 0 when the guess may
   * proceed, or the seconds left on the lock when it may not.
   *
   * ## One budget, not a second one
   *
   * A wrong authenticator or recovery code spends from the same
   * `failed_attempts / locked_until` as a wrong password, against the same
   * `loginAttemptLimit` and `lockoutMinutes`. Before this, the bound was
   * per challenge only and a correct password cleared the counter, so
   * anybody holding the password could start challenge after challenge and
   * guess the six digits without end. The counter now survives a new
   * challenge (and, for a 2FA account, a correct password: see
   * `LoginService.login`) and is cleared only once the second factor is
   * proved.
   *
   * It is not a lockout-DoS amplifier: spending from it takes the password,
   * and the lock it reaches is the one five wrong passwords already let
   * anybody impose. A separate, larger OTP-only budget would instead have
   * added guesses.
   *
   * ## Reserved, not counted afterwards
   *
   * The slot is taken by one conditional `UPDATE`, which Postgres
   * serialises on the row and re-checks after each wait: N parallel
   * guesses get at most `loginAttemptLimit` slots between them, whatever
   * the interleaving. The request that takes the last slot sets the lock in
   * the same statement, so nothing in flight behind it gets through; if its
   * code is right, the success clears the lock it set. Once a lock has
   * expired the next guess re-locks at once, exactly as `recordFailure`
   * does for a password — one try per lockout period until a success.
   */
  async reserveSecondFactorAttempt(userId: string): Promise<number> {
    const { loginAttemptLimit, lockoutMinutes } = await this.policy.current();
    const lockoutSeconds = lockoutMinutes * 60;
    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockoutSeconds * 1_000);

    const reserved = await this.prisma.$queryRaw<{ failed_attempts: number }[]>`
      UPDATE user_credentials
         SET failed_attempts = failed_attempts + 1,
             locked_until = CASE
               WHEN failed_attempts + 1 >= ${loginAttemptLimit} THEN ${lockUntil}::timestamptz
               ELSE locked_until
             END,
             updated_at = ${now}::timestamptz
       WHERE user_id = ${userId}::uuid
         AND (locked_until IS NULL OR locked_until <= ${now}::timestamptz)
      RETURNING failed_attempts`;
    if (reserved.length === 1) return 0;

    const credentials = await this.prisma.db.userCredential.findUnique({
      where: { userId },
      select: { lockedUntil: true },
    });
    // No credentials row at all: there is no factor to guess either, and the
    // caller answers that as an ordinary invalid code. Report the full
    // lockout rather than 0 so that a missing row never reads as "go ahead".
    return credentials === null ? lockoutSeconds : Math.max(this.remainingSeconds(credentials), 1);
  }

  /** Seconds left on the account's lock right now, read from the row. */
  async lockedForSeconds(userId: string): Promise<number> {
    const credentials = await this.prisma.db.userCredential.findUnique({
      where: { userId },
      select: { lockedUntil: true },
    });
    return this.remainingSeconds(credentials);
  }

  /**
   * A successful password check clears the counter. On success only —
   * resetting on a schedule would let an attacker outlast the window
   * rather than be stopped by it.
   */
  async clear(userId: string): Promise<void> {
    await this.prisma.db.userCredential.updateMany({
      where: { userId, OR: [{ failedAttempts: { gt: 0 } }, { lockedUntil: { not: null } }] },
      data: { failedAttempts: 0, lockedUntil: null },
    });
  }
}
