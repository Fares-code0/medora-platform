import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import type { Prisma } from '../../../generated/prisma/client';
import type { TokenKind } from '../../../generated/prisma/enums';

import { SecretService } from './secret.service';

/**
 * Single-use tokens for email verification and password reset
 * (RM M6.1, M6.5, M6.6 — DB §A10).
 *
 * ## Only the hash is stored
 *
 * The raw token exists in the emailed link and nowhere else. A database
 * disclosure therefore leaks digests, which cannot be replayed into an
 * account takeover — which is the entire reason `verification_tokens`
 * has a `token_hash` column and not a `token` one.
 *
 * ## Issuing does not invalidate the previous token
 *
 * A resend inserts a new row (DB §A10's own note). Two links then work
 * until one is used or both expire, which is the behaviour a user
 * expects when the first mail arrives late and they have already
 * clicked resend. Consuming one does not touch the other; both are
 * single-use, and the account can only be verified once anyway.
 */

/** API §1.1 — the verification link is good for 24 hours. */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 60 * 60;

/**
 * Password-reset links are shorter-lived than verification links.
 *
 * No source states either number for reset; API §1.1 states 24 h for
 * verification only. One hour is this backend's default (ADR-025) and
 * follows from what the two links do: a verification link proves an
 * address, a reset link *is* an account takeover in one click, so it
 * should sit in an inbox for as little time as the flow allows.
 */
export const PASSWORD_RESET_TTL_SECONDS = 60 * 60;

/** A token that passed every check in `inspect` and has not been spent. */
export interface PendingToken {
  readonly id: string;
  readonly userId: string;
}

export interface IssuedToken {
  /** The value that goes in the link. Never persisted. */
  readonly raw: string;
  readonly expiresAt: Date;
}

@Injectable()
export class VerificationTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretService,
  ) {}

  async issue(userId: string, kind: TokenKind, ttlSeconds: number): Promise<IssuedToken> {
    const raw = this.secrets.randomToken();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1_000);

    await this.prisma.db.verificationToken.create({
      data: { userId, kind, tokenHash: this.secrets.hash(raw), expiresAt },
    });

    return { raw, expiresAt };
  }

  /**
   * Consumes a token, returning the user it belongs to — or `null` for
   * every failure mode there is: unknown, expired, already used, or the
   * right token for the wrong purpose.
   *
   * **One return value for four failures on purpose.** API §1.8 and §1.9
   * answer all of them with `token_invalid`, and a caller that could
   * tell "expired" from "never existed" would eventually surface the
   * difference to someone holding a stolen link.
   *
   * The update is conditional on `usedAt: null` and runs as the
   * *claim*, not as a follow-up write: two clicks on the same link
   * arriving together would otherwise both read an unused row and both
   * proceed. `updateMany` reports how many rows it changed, so the loser
   * of that race sees zero and is refused.
   */
  async consume(raw: string, kind: TokenKind): Promise<{ userId: string } | null> {
    const token = await this.inspect(raw, kind);
    if (token === null) return null;

    return (await this.claim(token.id, this.prisma)) ? { userId: token.userId } : null;
  }

  /**
   * The token a raw value names, if it is still usable — **without
   * spending it**. `null` for the same four failures `consume` folds
   * together.
   *
   * For a caller whose own write can fail after the token is checked:
   * password reset. Spending the token first and failing afterwards
   * leaves the user holding a dead link and an unchanged password, which
   * is what a reset of an account with no credential row used to do
   * (it answered 500 *and* burned the link). Such a caller inspects here,
   * does its slow work, then `claim`s inside the transaction that writes
   * its result, so the claim and the write commit or roll back together.
   */
  async inspect(raw: string, kind: TokenKind): Promise<PendingToken | null> {
    const tokenHash = this.secrets.hash(raw);

    const token = await this.prisma.db.verificationToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, kind: true, expiresAt: true, usedAt: true },
    });

    if (token === null || token.kind !== kind) return null;
    if (token.usedAt !== null) return null;
    if (token.expiresAt.getTime() <= Date.now()) return null;

    return { id: token.id, userId: token.userId };
  }

  /**
   * Spends a token `inspect` returned. `true` for exactly one caller.
   *
   * Conditional on `usedAt: null` — and on expiry again, since time has
   * passed since `inspect` — so this update *is* the claim: two requests
   * racing on one link both reach it, Postgres serialises them on the row
   * lock, and the second re-evaluates the predicate against the first's
   * committed `used_at` and changes zero rows. Run inside a transaction,
   * the row stays locked until that transaction ends, so a loser waiting
   * on a winner that rolls back gets the token instead of a refusal.
   */
  async claim(tokenId: string, client: Prisma.TransactionClient): Promise<boolean> {
    const now = new Date();
    const claimed = await client.verificationToken.updateMany({
      where: { id: tokenId, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });

    return claimed.count === 1;
  }

  /**
   * When the most recent token of this kind was issued, for the resend
   * cooldown (API §1.4, §1.10).
   *
   * Derived from the rows rather than held in memory: the cooldown then
   * survives a restart and holds across every instance behind the load
   * balancer, neither of which an in-process counter manages. M31's
   * Redis limiter generalises this; the auth resends do not need to wait
   * for it.
   */
  async lastIssuedAt(userId: string, kind: TokenKind): Promise<Date | null> {
    const latest = await this.prisma.db.verificationToken.findFirst({
      where: { userId, kind },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    return latest?.createdAt ?? null;
  }
}
