import { describe, expect, it } from 'vitest';

import { isOtpauthUrl } from './otpauth';

describe('isOtpauthUrl', () => {
  it('accepts the scheme authenticator apps register', () => {
    expect(
      isOtpauthUrl('otpauth://totp/Medora:dr@medora.health?secret=JBSWY3DP&issuer=Medora'),
    ).toBe(true);
    expect(isOtpauthUrl('OTPAUTH://totp/x?secret=A')).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'https://medora.example/enrol',
    'data:text/html,<script>alert(1)</script>',
    'intent://scan/#Intent;scheme=otpauth;end',
    '',
    'otpauth',
  ])('refuses %j', (value) => {
    expect(isOtpauthUrl(value)).toBe(false);
  });
});
