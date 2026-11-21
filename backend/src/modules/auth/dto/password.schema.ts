import { z } from 'zod';

/**
 * The password policy (RM M6.1, MG §11.1).
 *
 * Transcribed from `frontend/src/utils/password.ts` — the frontend's own
 * comment calls that file "ONE source of truth" for the rule, and the
 * signup and reset forms both compile it into `strongPassword`
 * (`features/auth/schemas/password.ts`). The five checks and the minimum
 * length below are that file, in the same order.
 *
 * Transcribed rather than imported: the backend does not depend on the
 * frontend package, and a rule that read itself from the client could be
 * weakened by anyone who edits the client.
 *
 * **The messages are deliberately identical too.** The frontend shows
 * whatever `fieldErrors.password` contains, so a differently-worded
 * server message would appear under the same input as the client's own —
 * two spellings of one rule, on one form.
 */

export const PASSWORD_MIN_LENGTH = 8;

export const passwordChecks = {
  length: (v: string): boolean => v.length >= PASSWORD_MIN_LENGTH,
  lower: (v: string): boolean => /[a-z]/.test(v),
  upper: (v: string): boolean => /[A-Z]/.test(v),
  digit: (v: string): boolean => /\d/.test(v),
  symbol: (v: string): boolean => /[^A-Za-z0-9]/.test(v),
} as const;

export const strongPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .refine(passwordChecks.lower, 'Add a lowercase letter')
  .refine(passwordChecks.upper, 'Add an uppercase letter')
  .refine(passwordChecks.digit, 'Add a number')
  .refine(passwordChecks.symbol, 'Add a symbol');

/**
 * Every message the policy can produce, for a password that fails it.
 *
 * The Zod pipeline above stops reporting after the length check fails,
 * which is right for a form. It is wrong for the 422 `weak_password`
 * responses of API §1.1 and §1.8, where the client renders the whole
 * list at once — so those paths collect every unmet rule instead.
 */
export function passwordPolicyErrors(password: string): string[] {
  const failures: string[] = [];
  if (!passwordChecks.length(password)) {
    failures.push(`Use at least ${String(PASSWORD_MIN_LENGTH)} characters`);
  }
  if (!passwordChecks.lower(password)) failures.push('Add a lowercase letter');
  if (!passwordChecks.upper(password)) failures.push('Add an uppercase letter');
  if (!passwordChecks.digit(password)) failures.push('Add a number');
  if (!passwordChecks.symbol(password)) failures.push('Add a symbol');
  return failures;
}
