/**
 * The one-time account-linking code (ADR-048).
 *
 * Eight characters from a 31-symbol alphabet: `A–Z` and `2–9` without the
 * characters a person reading a phone screen aloud confuses — `0/O`,
 * `1/I/L`. 31^8 ≈ 8.5 × 10^11 values, live for fifteen minutes, single use,
 * one per account, and the routes that issue and consume them are rate
 * limited. The client shows it grouped `ABCD-EFGH`; the server accepts it
 * with or without the separator, in any case.
 *
 * Only the SHA-256 digest is stored (`patient_account_link_codes.code_hash`).
 * A lookup is by digest on a unique index, so the comparison the server makes
 * is digest equality inside PostgreSQL — no plaintext comparison happens in
 * the application at all, and nothing about a near-miss leaks through
 * timing of a string compare.
 */

import { createHash, randomInt } from 'node:crypto';

export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
/** Fifteen minutes (contract §1). */
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

const CODE_PATTERN = new RegExp(`^[${LINK_CODE_ALPHABET}]{${LINK_CODE_LENGTH}}$`);

/** A fresh code from a CSPRNG, uniform over the alphabet. */
export function generateLinkCode(): string {
  let code = '';
  for (let index = 0; index < LINK_CODE_LENGTH; index += 1) {
    code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The canonical form of what staff typed, or `null` when it cannot be a code.
 *
 * Spaces and hyphens are dropped and letters upper-cased, so `abcd-efgh`,
 * `ABCD EFGH` and `ABCDEFGH` are one code. Anything else — a wrong length,
 * an ambiguous character — is not a code, and the caller answers it exactly
 * as it answers an unknown one.
 */
export function normalizeLinkCode(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  return CODE_PATTERN.test(compact) ? compact : null;
}

/** The stored digest: lowercase hex SHA-256 of the canonical code. */
export function hashLinkCode(code: string): string {
  return createHash('sha256').update(code, 'utf8').digest('hex');
}
