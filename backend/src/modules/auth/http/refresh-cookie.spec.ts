import type { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { readRefreshCookie } from './refresh-cookie';

/**
 * Reading the refresh cookie off a request (RM M6.3).
 *
 * The header is written by the client, so this parser sees whatever an
 * attacker sends. Each case is one shape a real header takes.
 */
function withCookie(header: string | undefined): Request {
  return { headers: header === undefined ? {} : { cookie: header } } as Request;
}

describe('readRefreshCookie', () => {
  it('finds the cookie among others, and decodes it', () => {
    expect(readRefreshCookie(withCookie('theme=dark; medora_rt=abc%2Ddef; lang=en'))).toBe(
      'abc-def',
    );
  });

  it('answers undefined when there is no cookie header or no refresh cookie', () => {
    expect(readRefreshCookie(withCookie(undefined))).toBeUndefined();
    expect(readRefreshCookie(withCookie('theme=dark'))).toBeUndefined();
    // A bare name with no `=` is not a cookie with an empty value.
    expect(readRefreshCookie(withCookie('medora_rt'))).toBeUndefined();
  });

  it('does not match a cookie whose name merely ends in the refresh cookie’s', () => {
    expect(readRefreshCookie(withCookie('xmedora_rt=forged'))).toBeUndefined();
  });

  it('returns a value that does not percent-decode as it is, rather than throwing', () => {
    // `decodeURIComponent('%')` throws URIError; thrown here, it was a 500.
    for (const raw of ['%', '%zz', '%E0%A4%A']) {
      expect(() => readRefreshCookie(withCookie(`medora_rt=${raw}`))).not.toThrow();
      expect(readRefreshCookie(withCookie(`medora_rt=${raw}`))).toBe(raw);
    }
  });
});
