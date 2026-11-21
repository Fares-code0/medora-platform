import { z } from 'zod';

/**
 * `POST /me/2fa/enable` and `/me/2fa/disable` (RM M6.4, API §2.9).
 *
 * `enable` takes the six digits from the authenticator; `disable` takes
 * the account password, which the contract fixes and which is right —
 * someone holding the phone but not the password is exactly who must not
 * be able to remove the second factor.
 *
 * The password here carries `min(1)` rather than the signup policy, for
 * the same reason `loginSchema` does: what matters is whether it matches,
 * and a policy failure would answer differently from a wrong password.
 */
export const enableTwoFactorSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code').regex(/^\d+$/, 'Code must be digits only'),
});

export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;

export const disableTwoFactorSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
});

export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;

/**
 * `POST /me/2fa/setup` (owner decision D2, 2026-11-14): the current
 * password before any secret or recovery code is generated. `min(1)`, as
 * for `disable`: what matters is whether it matches.
 */
export const setupTwoFactorSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
});

export type SetupTwoFactorInput = z.infer<typeof setupTwoFactorSchema>;

const sixDigits = z
  .string()
  .length(6, 'Enter the 6-digit code')
  .regex(/^\d+$/, 'Code must be digits only');

/**
 * `POST /me/2fa/reenroll` (owner decision Q7 / R4, steps 1–2): the current
 * password and a code from the **current** authenticator.
 */
export const startReenrollmentSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
  code: sixDigits,
});

export type StartReenrollmentInput = z.infer<typeof startReenrollmentSchema>;

/** `POST /me/2fa/reenroll/confirm` (steps 4–5): a code from the **new** secret. */
export const confirmReenrollmentSchema = z.object({
  enrolmentToken: z.string().min(1),
  code: sixDigits,
});

export type ConfirmReenrollmentInput = z.infer<typeof confirmReenrollmentSchema>;
