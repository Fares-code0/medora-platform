import { describe, expect, it } from 'vitest';

import { normalizeRoleCode, validateRoleDraft } from './role-rules';

/**
 * `POST /roles` (API §15.4) refuses what `createRoleSchema` refuses
 * (`backend/src/modules/users/dto/roles.schema.ts`) and answers 409 for a
 * code already in use. The dialog checks the same rules first, in the
 * server's words, so a refusal is never the first the user hears of a rule.
 */

const EXISTING = ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy', 'senior_nurse'];

describe('validateRoleDraft', () => {
  it('accepts a well-formed custom role over a platform base role', () => {
    expect(
      validateRoleDraft(
        { code: 'ward-clerk', label: 'Ward clerk', baseRole: 'reception' },
        EXISTING,
      ),
    ).toEqual({});
  });

  it('applies the server’s code rules', () => {
    expect(validateRoleDraft({ code: 'a', label: 'Ok', baseRole: 'doctor' }, []).code).toBe(
      'Use at least 2 characters',
    );
    expect(
      validateRoleDraft({ code: 'x'.repeat(31), label: 'Ok', baseRole: 'doctor' }, []).code,
    ).toBe('Keep it under 30 characters');
    expect(validateRoleDraft({ code: '9lives', label: 'Ok', baseRole: 'doctor' }, []).code).toBe(
      'Letters, digits, underscore and hyphen; start with a letter',
    );
    expect(
      validateRoleDraft({ code: 'ward clerk', label: 'Ok', baseRole: 'doctor' }, []).code,
    ).toBe('Letters, digits, underscore and hyphen; start with a letter');
  });

  it('applies the server’s label rules', () => {
    expect(validateRoleDraft({ code: 'clerk', label: ' a ', baseRole: 'doctor' }, []).label).toBe(
      'Name the role',
    );
    expect(
      validateRoleDraft({ code: 'clerk', label: 'x'.repeat(61), baseRole: 'doctor' }, []).label,
    ).toBe('Keep it under 60 characters');
  });

  it('requires a platform role as the base template', () => {
    expect(validateRoleDraft({ code: 'clerk', label: 'Clerk', baseRole: '' }, []).baseRole).toBe(
      'Choose a base role',
    );
    expect(
      validateRoleDraft({ code: 'clerk', label: 'Clerk', baseRole: 'senior_nurse' }, EXISTING)
        .baseRole,
    ).toBe('Choose a base role');
  });

  it('refuses a code already in use, ignoring case as the server does', () => {
    expect(
      validateRoleDraft(
        { code: 'Senior_Nurse', label: 'Senior nurse', baseRole: 'doctor' },
        EXISTING,
      ).code,
    ).toBe('A role with the code "senior_nurse" already exists');
  });
});

describe('normalizeRoleCode', () => {
  it('trims and lower-cases, as the server stores it', () => {
    expect(normalizeRoleCode('  Ward-Clerk ')).toBe('ward-clerk');
  });
});
