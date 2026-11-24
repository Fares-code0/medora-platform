import { z } from 'zod';

import { PASSWORD_MIN_LENGTH, passwordChecks } from '@/utils/password';

/**
 * Auth password schema — the Zod rule for signup + reset. The policy itself
 * (min length + character checks) and the strength scoring now live in the
 * platform `@/utils/password` util so the auth flows and the doctor Account
 * settings share one source of truth. Re-exported here so existing auth
 * imports keep working.
 *
 * The messages are catalogue keys; the form renders them with
 * `translateIfKey(t, message, { count: PASSWORD_MIN_LENGTH })`.
 */

export { PASSWORD_MIN_LENGTH, passwordChecks };

export const strongPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'validation.passwordLength')
  .refine(passwordChecks.lower, 'validation.passwordLower')
  .refine(passwordChecks.upper, 'validation.passwordUpper')
  .refine(passwordChecks.digit, 'validation.passwordDigit')
  .refine(passwordChecks.symbol, 'validation.passwordSymbol');
