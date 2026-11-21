import { describe, expect, it } from 'vitest';

import { PasswordStrengthMeter as SharedMeter } from '@/components/patterns/PasswordStrengthMeter';

import { PasswordStrengthMeter } from '.';

/**
 * NEW-34. The auth pages used to render a private copy of the strength meter
 * while Settings rendered the shared one, and the two drifted: only this
 * copy was translated. The barrel now re-exports the shared meter, and this
 * fails the day a second copy comes back.
 */
describe('the auth strength meter', () => {
  it('is the shared, translated meter — not a copy of it', () => {
    expect(PasswordStrengthMeter).toBe(SharedMeter);
  });
});
