import { PLATFORM_ROLES } from '../permissions';

/**
 * A custom role's rules (API §15.4), restated from the server's
 * `createRoleSchema` (`backend/src/modules/users/dto/roles.schema.ts`) in its
 * own words, plus the 409 it answers for a code already in use. Checked
 * before sending so a refusal is never the first the user hears of a rule;
 * the server still decides.
 */

export interface RoleDraft {
  readonly code: string;
  readonly label: string;
  readonly baseRole: string;
}

export type RoleDraftErrors = Partial<Record<keyof RoleDraft, string>>;

const CODE_PATTERN = /^[a-z][a-z0-9_-]*$/i;

/** The server normalises a code rather than rejecting it for case. */
export function normalizeRoleCode(code: string): string {
  return code.trim().toLowerCase();
}

export function validateRoleDraft(
  draft: RoleDraft,
  existingCodes: readonly string[],
): RoleDraftErrors {
  const errors: RoleDraftErrors = {};
  const code = draft.code.trim();
  if (code.length < 2) errors.code = 'Use at least 2 characters';
  else if (code.length > 30) errors.code = 'Keep it under 30 characters';
  else if (!CODE_PATTERN.test(code)) {
    errors.code = 'Letters, digits, underscore and hyphen; start with a letter';
  } else if (existingCodes.some((existing) => existing.toLowerCase() === code.toLowerCase())) {
    errors.code = `A role with the code "${normalizeRoleCode(code)}" already exists`;
  }

  const label = draft.label.trim();
  if (label.length < 2) errors.label = 'Name the role';
  else if (label.length > 60) errors.label = 'Keep it under 60 characters';

  // The server accepts any existing role as a template; the client offers
  // the platform roles only, because a custom role's own bundle is a copy
  // the matrix cannot show (it has no column for it).
  if (!(PLATFORM_ROLES as readonly string[]).includes(draft.baseRole)) {
    errors.baseRole = 'Choose a base role';
  }
  return errors;
}
