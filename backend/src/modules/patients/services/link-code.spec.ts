import { describe, expect, it } from 'vitest';

import {
  generateLinkCode,
  hashLinkCode,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  normalizeLinkCode,
} from './link-code';

describe('account-linking code (ADR-048)', () => {
  it('uses an alphabet without the characters read aloud ambiguously', () => {
    for (const ambiguous of ['0', 'O', '1', 'I', 'L']) {
      expect(LINK_CODE_ALPHABET).not.toContain(ambiguous);
    }
    expect(new Set(LINK_CODE_ALPHABET).size).toBe(LINK_CODE_ALPHABET.length);
  });

  it('generates eight characters from the alphabet only', () => {
    for (let run = 0; run < 200; run += 1) {
      const code = generateLinkCode();
      expect(code).toHaveLength(LINK_CODE_LENGTH);
      for (const char of code) expect(LINK_CODE_ALPHABET).toContain(char);
    }
  });

  it('does not repeat itself across a batch', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateLinkCode()));
    expect(codes.size).toBe(500);
  });

  it('normalizes separators and case, and refuses anything that cannot be a code', () => {
    expect(normalizeLinkCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeLinkCode(' ABCD EFGH ')).toBe('ABCDEFGH');
    expect(normalizeLinkCode('ABCDEFG')).toBeNull();
    expect(normalizeLinkCode('ABCDEFGHJ')).toBeNull();
    expect(normalizeLinkCode('ABCDEFG0')).toBeNull();
    expect(normalizeLinkCode('ABCDEFGI')).toBeNull();
    expect(normalizeLinkCode('')).toBeNull();
  });

  it('stores a 64-hex SHA-256 digest that never contains the code', () => {
    const digest = hashLinkCode('ABCDEFGH');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('ABCDEFGH');
    expect(hashLinkCode('ABCDEFGH')).toBe(digest);
    expect(hashLinkCode('ABCDEFGJ')).not.toBe(digest);
  });
});
