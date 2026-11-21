import { describe, expect, it } from 'vitest';

import { AuthError } from '@/types/auth';

import { authErrorKey } from './error-message';

describe('authErrorKey', () => {
  it("uses the page's own wording for a code it lists", () => {
    expect(
      authErrorKey(
        new AuthError('token_invalid'),
        { token_invalid: 'reset.error.token' },
        'reset.error.generic',
      ),
    ).toBe('reset.error.token');
  });

  it('names a throttle on a page that did not list it', () => {
    expect(authErrorKey(new AuthError('rate_limited'), {}, 'forgot.error.generic')).toBe(
      'common.rateLimited',
    );
  });

  it('lets a page word a throttle its own way', () => {
    expect(
      authErrorKey(
        new AuthError('rate_limited'),
        { rate_limited: 'login.error.rateLimited' },
        'login.error.generic',
      ),
    ).toBe('login.error.rateLimited');
  });

  it('falls back for an unlisted code and for a failure that is not an auth refusal', () => {
    expect(authErrorKey(new AuthError('email_taken'), {}, 'otp.error.generic')).toBe(
      'otp.error.generic',
    );
    expect(authErrorKey(new Error('network down'), {}, 'otp.error.generic')).toBe(
      'otp.error.generic',
    );
  });
});
