import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ConfigService } from '../../../config';
import { EnvelopeService } from '../../../shared/crypto';

/**
 * Recovery-code storage (owner decisions R1–R5, 2026-11-06; RA-025.2, RA-035.2).
 *
 * ## Hashed, inside the existing encrypted field (R5)
 *
 * `user_credentials.recovery_codes_enc` is a `bytea` holding an
 * `EnvelopeService` ciphertext. Until now the plaintext inside it was the
 * JSON array of the codes themselves, so anyone holding the database *and*
 * `DATA_ENCRYPTION_KEY` held every account's codes. The column is kept and
 * no migration is needed: the plaintext inside the envelope becomes a
 * versioned document holding **digests**, `{"v":2,"h":["<hex>", …]}`.
 *
 * Encryption and hashing are not interchangeable, and both are kept on
 * purpose. The envelope keeps a stolen row from revealing even the digests'
 * count pattern without the key; the digests mean that decrypting the row
 * still does not yield a code anyone can type.
 *
 * ## Why a keyed hash and not `SecretService.hash`
 *
 * `SecretService.hash` is plain SHA-256, which is right for its 256-bit
 * tokens. A recovery code carries **40 bits** (`totp.service.ts`), and 2⁴⁰
 * unkeyed SHA-256 guesses are an afternoon on commodity hardware. The digest
 * here is HMAC-SHA-256 under a key derived from `DATA_ENCRYPTION_KEY` with
 * HKDF, so a database copy alone cannot be searched offline. The derivation
 * shares that key's known limitation (it cannot be rotated in place,
 * `PRODUCTION_SETUP.md` §2) and adds no new secret to manage.
 *
 * ## Legacy rows
 *
 * A row written before this change decrypts to a plain array of codes.
 * It is read as such and digested in memory, and it is rewritten in the new
 * format the next time the codes change (a redemption or a re-enrollment).
 * Nothing is rewritten merely by reading.
 */
const FORMAT_VERSION = 2;
const HMAC_INFO = 'medora:recovery-codes:v2';
const CODE_PATTERN = /^[0-9a-f]{10}$/;

export interface StoredRecoveryCodes {
  /** HMAC-SHA-256 digests (hex), one per unused code. */
  readonly digests: readonly string[];
}

@Injectable()
export class RecoveryCodeService {
  private readonly hmacKey: Buffer;

  constructor(
    config: ConfigService,
    private readonly envelope: EnvelopeService,
  ) {
    const ikm = Buffer.from(config.env.DATA_ENCRYPTION_KEY, 'base64');
    this.hmacKey = Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), HMAC_INFO, 32));
  }

  /** Ciphertext for a fresh set of codes. The codes themselves are not stored. */
  seal(codes: readonly string[]): Uint8Array<ArrayBuffer> {
    return this.sealDigests(codes.map((code) => this.digest(normalize(code) ?? code)));
  }

  /** Ciphertext for an already-digested set (what a redemption writes back). */
  sealDigests(digests: readonly string[]): Uint8Array<ArrayBuffer> {
    return this.envelope.encrypt(JSON.stringify({ v: FORMAT_VERSION, h: digests }));
  }

  /**
   * The stored set, or `null` for no codes.
   *
   * An absent column, a ciphertext that no longer authenticates and an
   * unrecognised document are all "no usable codes". That is the safe
   * direction: a redemption then fails, it never succeeds by accident.
   */
  open(payload: Uint8Array | null): StoredRecoveryCodes | null {
    if (payload === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(this.envelope.decrypt(payload));
    } catch {
      return null;
    }

    if (Array.isArray(parsed)) {
      // Legacy format: the codes in the clear, inside the envelope.
      const entries: readonly unknown[] = parsed;
      const codes = entries.filter((code): code is string => typeof code === 'string');
      return { digests: codes.map((code) => this.digest(normalize(code) ?? code)) };
    }

    if (isVersioned(parsed)) return { digests: parsed.h };
    return null;
  }

  /**
   * The index of the stored digest the presented code matches, or -1.
   *
   * Every stored digest is compared, matched or not, so the time taken does
   * not reveal which position matched. A presented value that is not the
   * shape of a code matches nothing.
   */
  match(stored: StoredRecoveryCodes, presented: string): number {
    const code = normalize(presented);
    const candidate = Buffer.from(this.digest(code ?? ''), 'hex');

    let found = -1;
    stored.digests.forEach((digest, index) => {
      const value = Buffer.from(digest, 'hex');
      const equal = value.length === candidate.length && timingSafeEqual(value, candidate);
      if (equal && found === -1 && code !== null) found = index;
    });
    return found;
  }

  private digest(code: string): string {
    return createHmac('sha256', this.hmacKey).update(code, 'utf8').digest('hex');
  }
}

/**
 * Lower case, separators removed. Codes are issued as `xxxxx-xxxxx` in
 * lower-case hex; a user copying one from paper may change the case or drop
 * the dash, and neither should cost them an attempt.
 */
export function normalize(value: string): string | null {
  const compact = value.toLowerCase().replace(/[\s-]/g, '');
  return CODE_PATTERN.test(compact) ? compact : null;
}

function isVersioned(value: unknown): value is { v: number; h: string[] } {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const digests = record['h'];
  if (record['v'] !== FORMAT_VERSION || !Array.isArray(digests)) return false;
  const entries: readonly unknown[] = digests;
  return entries.every((entry) => typeof entry === 'string');
}
