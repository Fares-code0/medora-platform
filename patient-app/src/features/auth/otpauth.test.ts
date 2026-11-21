import { isOtpauthUrl } from './otpauth';

describe('isOtpauthUrl', () => {
  it('accepts the scheme authenticator apps register', () => {
    expect(
      isOtpauthUrl('otpauth://totp/Medora:sara@example.com?secret=JBSWY3DP&issuer=Medora'),
    ).toBe(true);
    expect(isOtpauthUrl('OTPAUTH://totp/x?secret=A')).toBe(true);
  });

  it.each([
    'https://medora.example/enrol',
    'javascript:alert(1)',
    ' otpauth://totp/x',
    'intent://scan/#Intent;scheme=otpauth;end',
    'otpauth:',
    '',
  ])('refuses %j', (value) => {
    expect(isOtpauthUrl(value)).toBe(false);
  });
});
