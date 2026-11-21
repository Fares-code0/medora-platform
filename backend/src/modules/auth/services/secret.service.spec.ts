import { describe, expect, it } from 'vitest';

import { SecretService } from './secret.service';

/**
 * The properties every auth token depends on (RM M6.1).
 *
 * These look like tests of `node:crypto` and are not: each one pins a
 * decision that a plausible refactor would undo — base64url over base64,
 * `randomInt` over a modulo, a length guard before `timingSafeEqual`.
 */
describe('SecretService', () => {
  const secrets = new SecretService();

  describe('randomToken', () => {
    it('is URL-safe, so a link survives being pasted into a query string', () => {
      // 200 draws: `+` and `/` appear in roughly 1.5% of base64 characters,
      // so a single token would pass this by luck more often than not.
      for (let i = 0; i < 200; i += 1) {
        expect(secrets.randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
      }
    });

    it('carries 256 bits', () => {
      // base64url of 32 bytes, unpadded.
      expect(Buffer.from(secrets.randomToken(), 'base64url')).toHaveLength(32);
    });

    it('does not repeat', () => {
      const drawn = new Set(Array.from({ length: 1_000 }, () => secrets.randomToken()));
      expect(drawn.size).toBe(1_000);
    });
  });

  describe('randomOtp', () => {
    it('is always exactly six digits, including when the value is small', () => {
      for (let i = 0; i < 2_000; i += 1) {
        expect(secrets.randomOtp()).toMatch(/^\d{6}$/);
      }
    });

    it('reaches both ends of the range over enough draws', () => {
      // A zero-padded `000123` is the case a naive `toString()` breaks,
      // and the frontend's `otpSchema` requires length 6 exactly.
      const draws = Array.from({ length: 20_000 }, () => secrets.randomOtp());
      expect(draws.some((code) => code.startsWith('0'))).toBe(true);
      expect(draws.some((code) => Number(code) > 900_000)).toBe(true);
    });
  });

  describe('hash', () => {
    it('is stable and one-way in the sense that matters: it is not the input', () => {
      const token = secrets.randomToken();
      expect(secrets.hash(token)).toBe(secrets.hash(token));
      expect(secrets.hash(token)).not.toContain(token);
      expect(secrets.hash(token)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('separates two tokens that differ by one character', () => {
      expect(secrets.hash('token-a')).not.toBe(secrets.hash('token-b'));
    });
  });

  describe('matches', () => {
    it('accepts the value behind a digest and rejects anything else', () => {
      const token = secrets.randomToken();
      expect(secrets.matches(token, secrets.hash(token))).toBe(true);
      expect(secrets.matches('not-it', secrets.hash(token))).toBe(false);
    });

    it('returns false for a malformed stored hash instead of throwing', () => {
      // `timingSafeEqual` throws on a length mismatch. A row truncated by
      // a bad migration must fail the comparison, not the request.
      expect(secrets.matches('anything', 'deadbeef')).toBe(false);
      expect(secrets.matches('anything', '')).toBe(false);
    });
  });
});
