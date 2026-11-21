import { Secret, TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';

import { TotpService } from './totp.service';

/**
 * TOTP verification (RM M6.4, M8.2).
 *
 * The e2e suites drive enrolment and step-up end to end. What they cannot
 * reach is the stored secret being unreadable: `verify` must answer
 * `false` for a corrupt row rather than throw, because every caller turns
 * a throw into a 500 and the contract (`otp_invalid`, API §1.3) is that
 * every failure looks the same.
 */
const service = new TotpService();

function codeFor(secretBase32: string, at = Date.now()): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: at });
}

describe('TotpService.verify', () => {
  const { secret } = service.enrol('amelia@medora.test');

  it('accepts the current code', () => {
    expect(service.verify(secret, codeFor(secret))).toBe(true);
  });

  it('accepts the previous step, and nothing older', () => {
    // A one-step window absorbs a phone clock thirty seconds slow.
    expect(service.verify(secret, codeFor(secret, Date.now() - 30_000))).toBe(true);
    expect(service.verify(secret, codeFor(secret, Date.now() - 120_000))).toBe(false);
  });

  it('refuses a wrong code', () => {
    const right = codeFor(secret);
    const wrong = right === '000000' ? '111111' : '000000';
    expect(service.verify(secret, wrong)).toBe(false);
  });

  it('answers false, not a throw, for a stored secret that is not base32', () => {
    expect(() => service.verify('not base32 at all!', '123456')).not.toThrow();
    expect(service.verify('not base32 at all!', '123456')).toBe(false);
  });
});

describe('TotpService.enrol', () => {
  it('names the account in the URI and issues ten distinct recovery codes', () => {
    const enrolment = service.enrol('amelia@medora.test');

    expect(enrolment.otpauthUrl).toContain('issuer=Medora');
    expect(decodeURIComponent(enrolment.otpauthUrl)).toContain('amelia@medora.test');
    expect(new Set(enrolment.recoveryCodes).size).toBe(10);
  });
});
