import { Algorithm, hash, verify } from '@node-rs/argon2';
import { Injectable, Logger } from '@nestjs/common';

/**
 * Password hashing (RM M6.1, MG §11.1).
 *
 * Argon2id, which MG §11.1 names outright — the hybrid mode, so the
 * hash resists both GPU cracking (Argon2d's data-dependent addressing)
 * and side-channel recovery (Argon2i's data-independent addressing).
 *
 * ## Parameters
 *
 * The OWASP Password Storage Cheat Sheet's Argon2id baseline: 19 MiB of
 * memory, two iterations, one degree of parallelism. Memory is the
 * expensive dimension for an attacker and the cheap one for a server
 * doing this once per sign-in, which is why the recommendation raises
 * memory rather than iterations.
 *
 * They are written down here rather than left to the library's defaults
 * so that a dependency upgrade cannot quietly change the cost of every
 * future hash — and so the numbers are reviewable.
 *
 * Existing hashes carry their own parameters in the `$argon2id$…` string,
 * so raising these later re-verifies old hashes correctly; M37 can rehash
 * on next sign-in when it revisits the security posture.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, ARGON2_OPTIONS);
  }

  /**
   * `false` rather than a throw on a malformed stored hash.
   *
   * `verify` rejects when the encoded hash cannot be parsed — a row
   * truncated by a bad migration, say. Propagating that would turn one
   * corrupt row into a 500 on an endpoint whose whole contract is that
   * failure looks identical whatever went wrong (API §1.2 —
   * "identical timing/shape — no enumeration"). It is logged, because a
   * password hash that will not parse is a defect, and answered as a
   * failed verification, because from the caller's side it is one.
   */
  async verify(storedHash: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(storedHash, plaintext, ARGON2_OPTIONS);
    } catch (error) {
      this.logger.error({ err: error }, 'Stored password hash could not be parsed');
      return false;
    }
  }
}
