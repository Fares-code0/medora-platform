import {
  normalizeCancellationError,
  normalizeHttpError,
  normalizeNetworkError,
  normalizeTimeoutError,
} from '@/api/errors';

import { isSessionRejection } from './refresh-outcome';

/**
 * The one line between "the server ended this session" and "nothing is
 * known". Only `401 unauthorized` — the refresh route's own refusal
 * (ADR-045) — may clear the keychain; everything else keeps the token.
 */

function httpError(status: number, body: unknown = {}) {
  return normalizeHttpError(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('isSessionRejection', () => {
  it('reads 401 unauthorized as the server refusing the token', async () => {
    expect(
      isSessionRejection(await httpError(401, { message: 'Session expired', code: 'unauthorized' })),
    ).toBe(true);
  });

  it.each([
    ['no signal', () => Promise.resolve(normalizeNetworkError())],
    ['a timeout', () => Promise.resolve(normalizeTimeoutError())],
    ['a 500', () => httpError(500)],
    ['a 503', () => httpError(503)],
    ['a 429', () => httpError(429, { code: 'rate_limited' })],
    ['a 403', () => httpError(403, { code: 'forbidden' })],
    ['a 400', () => httpError(400, { code: 'validation_error' })],
    ['a 422', () => httpError(422)],
    ['a 401 with another code', () => httpError(401, { code: 'invalid_credentials' })],
    ['a 401 with no code', () => httpError(401)],
    ['a cancellation', () => Promise.resolve(normalizeCancellationError())],
  ])('reads %s as no answer about the token', async (_label, make) => {
    expect(isSessionRejection(await make())).toBe(false);
  });
});
