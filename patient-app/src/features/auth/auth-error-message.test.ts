import fs from 'node:fs';
import path from 'node:path';

import { EndpointNotImplementedError } from '@/api/seam';
import { catalogues, interpolate } from '@/i18n';
import type { ApiError, ApiErrorKind } from '@/types/api';

import { authErrorKey } from './useAuthErrorMessage';

/**
 * What a failed auth call says to the patient — checklist D-02, D-06,
 * T-05, T-06.
 *
 * `useAuthErrorMessage.ts` sat at 61.8% statements and 57.5% branches,
 * which is the wrong number for the file that decides what a patient
 * reads at the moment they cannot get in. Two of its rules are load-
 * bearing and neither had a test:
 *
 * 1. **`code` is read before `kind`.** A wrong password and an expired
 *    session are both `401`. A client that branches on status alone
 *    treats a typo as a dead session, bounces the patient to a sign-in
 *    screen they were already on and — in the web client's case —
 *    triggers a refresh that can revoke the token family. That is the
 *    defect the audit tells this app not to inherit.
 * 2. **Nothing here ever confirms whether an account exists.** The
 *    backend answers a wrong password and an unknown address
 *    identically, with identical timing. A client that renders "no
 *    account with that email" hands back the distinction the server went
 *    to trouble to hide.
 */

/**
 * The English rendering of what `authErrorKey` returns.
 *
 * Since C-09 the mapper returns a catalogue key rather than a sentence,
 * and the assertions below are about the sentence — what a patient
 * reads is where the anti-enumeration and wrong-password rules actually
 * bite. Resolving through the catalogue keeps every one of those claims
 * intact and adds one: a key that is not in the catalogue would not
 * compile.
 */
function authErrorMessage(error: unknown): string {
  const { key, params, paramKeys } = authErrorKey(error);
  // `paramKeys` carries params whose value is itself a catalogue key —
  // an unbuilt endpoint's `capability`. Resolving only `params` would
  // leave `{capability}` in the sentence, which is what this helper
  // exists to rule out. `resolveAuthMessage` does the same thing for the
  // two production callers.
  return interpolate(catalogues.en[key], {
    ...params,
    ...Object.fromEntries(
      Object.entries(paramKeys ?? {}).map(([name, nested]) => [name, catalogues.en[nested]]),
    ),
  });
}

function apiError(error: ApiError): ApiError {
  // Thrown errors in this tree are `Error` instances carrying the union's
  // fields, which is what `isApiError` recognises.
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

/** One example of every kind, so the exhaustiveness tests are honest. */
const EVERY_KIND: Readonly<Record<ApiErrorKind, ApiError>> = {
  validation: { kind: 'validation', fieldErrors: {} },
  auth: { kind: 'auth' },
  forbidden: { kind: 'forbidden' },
  not_found: { kind: 'not_found' },
  conflict: { kind: 'conflict', detail: 'x' },
  rate_limited: { kind: 'rate_limited', retryAfterSeconds: 30 },
  network: { kind: 'network' },
  timeout: { kind: 'timeout' },
  cancelled: { kind: 'cancelled' },
  server: { kind: 'server', ref: 'REF-1' },
};

describe('`code` is read before `kind` (D-02, T-05)', () => {
  it('calls a wrong password a wrong password, not an expired session', () => {
    const message = authErrorMessage(apiError({ kind: 'auth', code: 'invalid_credentials' }));

    expect(message).toMatch(/do not match/i);
    expect(message).not.toMatch(/sign in again|session|expired/i);
  });

  it('calls an expired reset link an expired link, on the same 401', () => {
    // Same `kind`, different `code`, and the two must not read alike —
    // one is "try typing it again", the other is "start over". The
    // backend sends `token_invalid` for an expired link too.
    expect(authErrorMessage(apiError({ kind: 'auth', code: 'token_invalid' }))).toMatch(
      /no longer valid/i,
    );
  });

  it.each([
    ['email_unverified', /confirm your email/i],
    ['account_inactive', /not active/i],
    ['otp_invalid', /not right/i],
    ['email_taken', /already an account/i],
    ['weak_password', /stronger password/i],
  ])('maps %s to its own sentence', (code, expected) => {
    expect(authErrorMessage(apiError({ kind: 'auth', code }))).toMatch(expected);
  });

  it('does not call an inactive account a wrong app, on the same 403 kind', () => {
    // `account_inactive` is a 403, so before A1 it read as `forbidden`:
    // "cannot sign in to the Medora patient app" — the wrong cause.
    const inactive = authErrorMessage(apiError({ kind: 'forbidden', code: 'account_inactive' }));
    const forbidden = authErrorMessage(apiError({ kind: 'forbidden' }));

    expect(inactive).not.toBe(forbidden);
    expect(inactive).not.toMatch(/patient app/i);
  });

  it.each([['account_locked'], ['otp_expired'], ['token_expired']])(
    'has no sentence of its own for %s, which the backend never sends',
    (code) => {
      // Falls through to `kind`, like any code this client does not map.
      expect(authErrorKey(apiError({ kind: 'auth', code })).key).toBe(
        'auth.error.invalidCredentials',
      );
    },
  );
});

describe('it never confirms whether an account exists (anti-enumeration)', () => {
  it('gives an unknown address the same answer as a wrong password', () => {
    // `user_not_found` is deliberately unhandled: it falls through to the
    // `kind` branch and lands on the credentials sentence. If someone
    // ever adds a case for it, this test is what stops them.
    const unknownAddress = authErrorMessage(apiError({ kind: 'auth', code: 'user_not_found' }));
    const wrongPassword = authErrorMessage(apiError({ kind: 'auth', code: 'invalid_credentials' }));

    expect(unknownAddress).toBe(wrongPassword);
  });

  it('says nothing about an account existing or not, for any kind or code', () => {
    const codes = [
      undefined,
      'user_not_found',
      'invalid_credentials',
      'email_unverified',
      'account_inactive',
      'unknown_code_from_a_future_backend',
    ];
    const leaks = /no account|does ?n.t exist|not registered|unknown email|never signed up/i;

    for (const error of Object.values(EVERY_KIND)) {
      for (const code of codes) {
        const message = authErrorMessage(apiError(code === undefined ? error : { ...error, code }));
        expect({ kind: error.kind, code, message }).toEqual({
          kind: error.kind,
          code,
          message: expect.not.stringMatching(leaks),
        });
      }
    }
  });
});

describe('every kind produces a sentence (exhaustiveness)', () => {
  it.each(Object.keys(EVERY_KIND) as ApiErrorKind[])('handles %s', (kind) => {
    const message = authErrorMessage(apiError(EVERY_KIND[kind]));

    expect(typeof message).toBe('string');
    expect(message.length).toBeGreaterThan(10);
    expect(message).not.toMatch(/undefined|\[object/i);
  });

  it('tells the patient how long to wait on a 429, because "too many attempts" alone is not actionable', () => {
    expect(authErrorMessage(apiError({ kind: 'rate_limited', retryAfterSeconds: 45 }))).toMatch(
      /45 seconds/,
    );
  });

  it('quotes the correlation reference on a 5xx, which is the one thing support can use', () => {
    expect(authErrorMessage(apiError({ kind: 'server', ref: 'REQ-abc123' }))).toContain(
      'REQ-abc123',
    );
  });

  it('does not blame the patient for a cancelled or missing request', () => {
    for (const kind of ['cancelled', 'not_found'] as const) {
      expect(authErrorMessage(apiError(EVERY_KIND[kind]))).toMatch(/something went wrong/i);
    }
  });
});

describe('it never surfaces the server’s free text (T-04)', () => {
  it('drops `detail` on a conflict, which can name a patient', () => {
    const message = authErrorMessage(
      apiError({
        kind: 'conflict',
        detail: 'Amina Yusuf (PT-4471) already has an account on this address',
      }),
    );

    expect(message).not.toMatch(/Amina|PT-4471/);
    expect(message).toMatch(/already an account/i);
  });

  it('drops `fieldErrors` on a 422 rather than concatenating them into the banner', () => {
    const message = authErrorMessage(
      apiError({
        kind: 'validation',
        fieldErrors: { email: ['amina.yusuf@example.com is already in use'] },
      }),
    );

    expect(message).not.toMatch(/amina/i);
    expect(message).toMatch(/check the form/i);
  });
});

describe('errors that are not from the API', () => {
  it('names the capability, not the dependency code, for an unbuilt endpoint', () => {
    const message = authErrorMessage(new EndpointNotImplementedError('BE-13', 'capability.messages'));

    // The capability is a catalogue key now, so this is the words it
    // resolves to rather than the key itself.
    expect(message).toContain(catalogues.en['capability.messages']);
    expect(message).toMatch(/still being built/i);
  });

  it('falls back to one plain sentence for anything else', () => {
    for (const thrown of [new Error('boom'), 'a string', null, undefined, { kind: 42 }]) {
      expect(authErrorMessage(thrown)).toBe('Something went wrong. Please try again.');
    }
  });
});

describe('it reads the catalogue, in whichever language is on (C-09)', () => {
  it('gives every code its own catalogue entry, not its own sentence', () => {
    // Stronger than comparing sentences: two codes that shared one entry
    // would read alike in every language at once, and two identical
    // sentences typed out twice would pass a prose comparison.
    const codes = [
      'invalid_credentials',
      'email_unverified',
      'account_inactive',
      'otp_invalid',
      'token_invalid',
      'email_taken',
      'weak_password',
    ];
    const keys = codes.map((code) => authErrorKey(apiError({ kind: 'auth', code })).key);

    expect(new Set(keys).size).toBe(codes.length);
  });

  it('resolves in Arabic as well as English', () => {
    const { key, params } = authErrorKey(apiError({ kind: 'rate_limited', retryAfterSeconds: 45 }));

    // The number lands wherever the sentence puts it — which is not the
    // same place in the two languages, and is why it travels as a
    // parameter rather than being concatenated.
    expect(interpolate(catalogues.en[key], params)).toContain('45');
    expect(interpolate(catalogues.ar[key], params)).toContain('45');
    expect(catalogues.ar[key]).not.toBe(catalogues.en[key]);
  });

  it('carries the correlation reference through, and nothing else from the server', () => {
    const { key, params } = authErrorKey(
      apiError({ kind: 'server', ref: 'REF-9', detail: 'Sara Ahmed' } as ApiError),
    );

    const message = interpolate(catalogues.en[key], params);
    expect(message).toContain('REF-9');
    expect(message).not.toContain('Sara Ahmed');
  });

  it('holds no sentence of its own any more', () => {
    // The regression this guards: a new error code added with its
    // sentence written inline, because that is one line shorter than
    // adding a catalogue entry in two files.
    const source = fs
      .readFileSync(path.join(__dirname, 'useAuthErrorMessage.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const sentences = [...source.matchAll(/'[^']*\s[^']*[.']\s*'/g)].map((m) => m[0]);
    expect(sentences).toEqual([]);
  });
});
