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
