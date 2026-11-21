import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AUTH_ERROR_CODES, defaultCodeForStatus } from './error-codes';

/**
 * ADR-012 — the auth error codes are a contract, and this is its parity check.
 *
 * `error-codes.ts` says the backend's `AUTH_ERROR_CODES` are transcribed from
 * the web client's `AuthErrorCode` union and "must match it exactly"; the
 * client's sign-in pages branch on these strings (RM M39.1). Until this spec,
 * nothing held the two together, so a code added or renamed on one side would
 * have reached the other as a generic failure. The union is a type, so its
 * literals are read from the source text, in order.
 *
 * Changing `frontend/src/types/auth/` already runs this suite in CI (the
 * cross-tree path filter in CLAUDE.md), so a drift fails on either side.
 */

const FRONTEND_AUTH_ERROR = resolve(__dirname, '../../../../frontend/src/types/auth/auth-error.ts');

function frontendAuthErrorCodes(): string[] {
  const source = readFileSync(FRONTEND_AUTH_ERROR, 'utf8');
  const union = /export type AuthErrorCode =([\s\S]*?);/.exec(source);
  if (union === null) throw new Error('AuthErrorCode union not found in auth-error.ts');
  // Strip comments first: the union documents some members in prose.
  const body = (union[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1] ?? '');
}

describe('AUTH_ERROR_CODES', () => {
  it('is the web client’s AuthErrorCode union, member for member and in order', () => {
    expect([...AUTH_ERROR_CODES]).toEqual(frontendAuthErrorCodes());
  });

  it('holds no duplicates', () => {
    expect(new Set(AUTH_ERROR_CODES).size).toBe(AUTH_ERROR_CODES.length);
  });

  it('uses snake_case machine codes only (ADR-012)', () => {
    for (const code of AUTH_ERROR_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});

describe('defaultCodeForStatus', () => {
  // The client's 401 handling (ADR-013, RM M39.4) refreshes only on
  // `unauthorized`; a codeless 401 must therefore default to exactly that.
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [409, 'conflict'],
    [422, 'validation_failed'],
  ])('maps %i to %s', (status, code) => {
    expect(defaultCodeForStatus(status)).toBe(code);
  });
});
