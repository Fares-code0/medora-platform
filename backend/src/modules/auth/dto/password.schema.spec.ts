import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH, passwordPolicyErrors, strongPassword } from './password.schema';

/**
 * The policy is a transcription of `frontend/src/utils/password.ts`
 * (RM M6.1). These cases are the frontend's five checks, asserted
 * one at a time so a weakened rule names itself.
 */
describe('password policy', () => {
  const VALID = 'Medora123!';

  it('accepts the demo password the frontend ships', () => {
    expect(strongPassword.safeParse(VALID).success).toBe(true);
  });

  it.each([
    ['Me1!', 'too short'],
    ['MEDORA123!', 'no lowercase'],
    ['medora123!', 'no uppercase'],
    ['MedoraPass!', 'no digit'],
    ['Medora1234', 'no symbol'],
  ])('rejects %s (%s)', (password) => {
    expect(strongPassword.safeParse(password).success).toBe(false);
  });

  it('states the minimum the frontend states', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect('Med1!ab'.length).toBe(PASSWORD_MIN_LENGTH - 1);
    expect(strongPassword.safeParse('Med1!ab').success).toBe(false);
    expect(strongPassword.safeParse('Med1!abc').success).toBe(true);
  });

  describe('passwordPolicyErrors', () => {
    it('is empty for a compliant password', () => {
      expect(passwordPolicyErrors(VALID)).toEqual([]);
    });

    it('lists every unmet rule at once, not just the first', () => {
      // The Zod pipeline stops at the length failure, which is right for
      // a form and wrong for a 422 the client renders as a checklist.
      expect(passwordPolicyErrors('abc')).toHaveLength(4);
    });

    it('names only the rule that failed', () => {
      expect(passwordPolicyErrors('Medora1234')).toEqual(['Add a symbol']);
    });
  });
});
