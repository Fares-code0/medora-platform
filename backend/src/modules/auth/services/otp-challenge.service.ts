import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { PolicyService } from '../../../config';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

import { SecretService } from './secret.service';

/**
 * The pending second-factor challenge (RM M6.2 issues it, M6.4 resolves it).
 *
 * A sign-in that passes the password check but needs a second factor is
 * not a session — API §1.2 is explicit that the 200 carries
 * `{ requiresOtp: true, otpToken }` and "no session yet". This service
 * owns that in-between state.
 *
 * ## What an `otp_codes` row holds for an app-channel challenge
 *
 * DB §A11 describes the table as "2FA one-time codes", which fits an
 * emailed or texted code exactly. With an authenticator app there is no
 * server-minted code to store — the six digits are derived on both sides
 * from the enrolled TOTP secret. So for `channel = 'app'` the row records
 * the **challenge** rather than a code: `code_hash` holds the digest of a
 * nonce the client must present, `attempts` bounds the guesses, and
 * `consumed_at` makes the challenge single-use. Every column keeps its
 * meaning ("the secret this row is unlocked by"); only the *source* of
 * the six digits differs, and that difference is what `channel` is for.
 *
 * ## Why the client's handle is a signed token and not the row id
 *
 * `rememberMe` is chosen on the login form and applies to the session
 * created *after* the step-up, and API §1.3's body is `{ otpToken, code }`
 * — the client never sends the flag again. The token carries it. Signing
 * it also means a caller cannot enumerate challenge rows by id.
 */

/**
 * How long a step-up may sit unfinished: **ten minutes, absolute**.
 *
 * Owner decision (2026-11-06): the OTP lifetime is ten minutes, measured
 * from the moment the challenge is issued, and resending does **not**
 * extend it (C-11). The deadline is written once, at issue, to both the
 * row's `expires_at` and the signed token's `exp`; nothing moves either
 * afterwards, so no sequence of resends keeps a challenge alive past it.
 * After the deadline the only way forward is a new sign-in, which issues a
 * new challenge with its own ten minutes.
 *
 * This replaces the earlier five-minute backend default recorded in
 * ADR-025 (that ADR's text is amended separately).
 */
export const OTP_CHALLENGE_TTL_SECONDS = 10 * 60;

/**
 * The resend cooldown, in seconds.
 *
 * Transcribed from the frontend: `VerifyOtpPage` and `VerifyEmailPage`
 * both declare `RESEND_SECONDS = 30` and render a countdown from it. A
 * server that allowed a resend sooner would make the countdown a lie; one
 * that demanded longer would show an enabled button that 429s.
 */
export const RESEND_COOLDOWN_SECONDS = 30;

export interface OtpChallenge {
  /** The opaque handle the client returns to `/auth/otp/verify`. */
  readonly otpToken: string;
  readonly expiresAt: Date;
}

/** What a presented `otpToken` resolves to. */
export interface ResolvedChallenge {
  readonly challengeId: string;
  readonly userId: string;
  readonly rememberMe: boolean;
  readonly attempts: number;
  readonly createdAt: Date;
}

interface ChallengeClaims {
  readonly typ: 'otp';
  readonly sub: string;
  readonly cid: string;
  readonly nce: string;
  readonly rmb: boolean;
}

@Injectable()
export class OtpChallengeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretService,
    private readonly jwt: JwtService,
    private readonly policy: PolicyService,
  ) {}

  async issue(userId: string, rememberMe: boolean): Promise<OtpChallenge> {
    const nonce = this.secrets.randomToken();
    const expiresAt = new Date(Date.now() + OTP_CHALLENGE_TTL_SECONDS * 1_000);

    const row = await this.prisma.db.otpCode.create({
      data: { userId, codeHash: this.secrets.hash(nonce), channel: 'app', expiresAt },
    });

    const claims: ChallengeClaims = {
      typ: 'otp',
      sub: userId,
      cid: row.id,
      nce: nonce,
      rmb: rememberMe,
    };

    return {
      otpToken: await this.jwt.signAsync(claims, { expiresIn: OTP_CHALLENGE_TTL_SECONDS }),
      expiresAt,
    };
  }

  /**
   * Resolves a presented token to a live challenge, or `null`.
   *
   * `null` covers forged, expired, already-consumed, out-of-attempts and
   * "the row was deleted with the account" — every one of which API §1.3
   * answers with the same 401 `otp_invalid`. A caller that could tell
   * them apart would eventually surface the difference to whoever is
   * holding the stolen token.
   */
  async resolve(otpToken: string): Promise<ResolvedChallenge | null> {
    let claims: ChallengeClaims;
    try {
      claims = await this.jwt.verifyAsync<ChallengeClaims>(otpToken);
    } catch {
      return null;
    }

    // A signed access token is also a signed token. Without this check a
    // caller could present one here and skip the second factor entirely.
    if (claims.typ !== 'otp') return null;

    const row = await this.prisma.db.otpCode.findUnique({ where: { id: claims.cid } });
    if (row === null || row.userId !== claims.sub) return null;
    if (row.consumedAt !== null) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    if (!this.secrets.matches(claims.nce, row.codeHash)) return null;

    const { loginAttemptLimit } = await this.policy.current();
    if (row.attempts >= loginAttemptLimit) return null;

    return {
      challengeId: row.id,
      userId: row.userId,
      rememberMe: claims.rmb,
      attempts: row.attempts,
      createdAt: row.createdAt,
    };
  }

  /** Counts a wrong guess. Returns true once the challenge is spent. */
  async countFailure(challengeId: string): Promise<boolean> {
    const [{ loginAttemptLimit }, row] = await Promise.all([
      this.policy.current(),
      this.prisma.db.otpCode.update({
        where: { id: challengeId },
        data: { attempts: { increment: 1 } },
        select: { attempts: true },
      }),
    ]);

    return row.attempts >= loginAttemptLimit;
  }

  async consume(challengeId: string): Promise<boolean> {
    // Conditional on `consumed_at IS NULL`, and reported by row count:
    // two verifications of one challenge arriving together must not both
    // mint a session.
    const claimed = await this.prisma.db.otpCode.updateMany({
      where: { id: challengeId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return claimed.count === 1;
  }

  /**
   * `consume`, on the caller's transaction.
   *
   * Recovery-code redemption (R1) spends the challenge and the code
   * together: if the code cannot be removed, or its audit row cannot be
   * written, the challenge must not have been spent either.
   */
  async consumeWithin(tx: Prisma.TransactionClient, challengeId: string): Promise<boolean> {
    const claimed = await tx.otpCode.updateMany({
      where: { id: challengeId, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    return claimed.count === 1;
  }
}
