import { z } from 'zod';

import { PASSWORD_MIN_LENGTH, passwordChecks } from '@/utils/password';

/**
 * Auth password schema — the Zod rule for signup + reset. The policy itself
 * (min length + character checks) and the strength scoring now live in the
 * platform `@/utils/password` util so the auth flows and the doctor Account
 * settings share one source of truth. Re-exported here so existing auth
 * imports keep working.
 */

export { PASSWORD_MIN_LENGTH, passwordChecks };

export const strongPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`)
  .refine(passwordChecks.lower, 'Add a lowercase letter')
  .refine(passwordChecks.upper, 'Add an uppercase letter')
  .refine(passwordChecks.digit, 'Add a number')
  .refine(passwordChecks.symbol, 'Add a symbol');
