import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

/**
 * The secret material every auth flow shares (RM M6.1–M6.5).
 *
 * Four kinds of value pass through here, and the rule is the same for
 * all of them: **the database never holds the value that grants access.**
 * A verification link, a refresh token, an OTP — each exists in exactly
 * one place outside this process (an inbox, a cookie, a phone) and as a
 * SHA-256 digest in a row. A database disclosure then leaks digests,
 * which cannot be replayed into an account.
 *
 * ## Why SHA-256 and not Argon2 here
 *
 * Passwords are Argon2id (`PasswordService`) because they are chosen by
 * humans and therefore guessable: the cost parameter is what makes an
 * offline dictionary attack expensive. These tokens are 256 bits from
 * the system CSPRNG. There is no dictionary to try, so the only property
 * needed is a one-way function — and a fast one, because `refresh` runs
 * it on every request the frontend makes on boot.
 */
@Injectable()
export class SecretService {
  /**
   * A URL-safe 256-bit token. base64url so it survives being pasted
   * into a query string (`/verify-email?token=…`) without escaping —
   * a `+` in a link becomes a space when the browser decodes it, which
   * turns a valid token into `token_invalid`.
   */
  randomToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * A six-digit OTP, zero-padded (`/^\d{6}$/` — the frontend's
   * `otpSchema` and API §1.3 both require exactly six digits).
   *
   * `randomInt` and not `Math.random()`: this is a credential, and the
   * range is small enough that a predictable PRNG is genuinely
   * exploitable. `randomInt` is rejection-sampled, so `000000`–`999999`
   * are uniform — a modulo of random bytes would not be.
   */
  randomOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  /** The digest stored in `token_hash`, `code_hash`, `refresh_token_hash`. */
  hash(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  /**
   * Constant-time comparison of two digests.
   *
   * Lookups here are by unique index on the hash, so most comparisons
   * happen in Postgres. This exists for the paths that compare in
   * application code — OTP verification reads the newest unconsumed row
   * for a user, then compares — where `===` on a hex string leaks its
   * matching prefix through timing.
   */
  matches(value: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(value), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    // `timingSafeEqual` throws on a length mismatch, which would itself
    // be an oracle. Both sides are SHA-256, so a differing length means
    // a malformed stored value rather than a wrong guess.
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  }
}
