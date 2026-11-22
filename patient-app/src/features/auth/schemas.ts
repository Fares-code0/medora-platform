import { z } from 'zod';

import { extractEmailedToken } from './emailed-token';

/**
 * Form schemas.
 *
 * These mirror `backend/src/modules/auth/dto/*.schema.ts` field for field
 * and message for message — including `strongPassword`'s five checks in
 * the same order, so a password the client accepts is one the server
 * accepts, and a 422 shows the same wording the form already showed.
 *
 * Transcribed rather than imported: this package does not depend on the
 * backend package. `src/test/parity.test.ts` reads the backend source and
 * fails if the two drift, which is the same discipline the backend
 * applies to the frontend's permission catalogue (audit R-11).
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

/** Every unmet rule at once — what the strength meter renders. */
export function passwordPolicyErrors(password: string): string[] {
  const failures: string[] = [];
  if (!passwordChecks.length(password))
    failures.push(`Use at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!passwordChecks.lower(password)) failures.push('Add a lowercase letter');
  if (!passwordChecks.upper(password)) failures.push('Add an uppercase letter');
  if (!passwordChecks.digit(password)) failures.push('Add a number');
  if (!passwordChecks.symbol(password)) failures.push('Add a symbol');
  return failures;
}

/**
 * `min(1)` on the password, NOT the signup policy. Rejecting a short
 * password here would give a different answer for a wrong guess than for
 * a wrong password — the enumeration leak the backend's own comment on
 * this schema calls out.
 */
export const loginFormSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  rememberMe: z.boolean().default(false),
});
export type LoginForm = z.infer<typeof loginFormSchema>;

export const otpFormSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code').regex(/^\d+$/, 'Code must be digits only'),
});
export type OtpForm = z.infer<typeof otpFormSchema>;

/** The frontend's `phoneRegex`, verbatim. */
const phoneRegex = /^\+?[0-9][0-9\s-]{6,18}$/;

/**
 * Registration.
 *
 * `role` is absent and `licenseNumber` is absent. `licenseNumber` is a
 * clinician field that has no business on a patient form and stays out
 * permanently. `role` was absent because patient identity was AD-1's to
 * decide; ADR-030 decided it, so `role: 'patient'` now has a real value
 * to carry and belongs here when the signup flow is built. Until then
 * `parity.test.ts` asserts its absence, so the gap is tracked rather
 * than forgotten.
 *
 * `confirmPassword` stays on the client: the server holds one password
 * and has nothing to compare a second against (the backend schema's own
 * note), so it is refined here and never sent.
 */
export const registerFormSchema = z
  .object({
    firstName: z.string().min(1, 'Enter your first name').max(60),
    lastName: z.string().min(1, 'Enter your last name').max(60),
    email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
    phone: z
      .string()
      .min(1, 'Enter your phone number')
      .regex(phoneRegex, 'Enter a valid phone number'),
    password: strongPassword,
    confirmPassword: z.string().min(1, 'Re-enter your password'),
    /*
     * `boolean` refined to `true`, where the backend's own schema says
     * `.literal(true)`. Same rule, same message, and only `true` passes
     * either — `users.terms_accepted_at` is NOT NULL by design, so an
     * account with unrecorded consent is a compliance gap and accepting
     * `false` is the one way one could be created.
     *
     * The difference is the TYPE, and it is the point. `literal(true)`
     * makes `false` unrepresentable, so a form typed on it cannot hold
     * "not ticked yet" and its defaults have to claim the boxes are
     * already accepted. That is not consent: the patient has done
     * nothing, `terms_accepted_at` would record the moment at which they
     * did nothing, and the message below could never fire because the
     * condition it guards could never be false.
     *
     * The backend keeps `literal(true)`, which is right: it guards the
     * wire, where the value has been decided. This guards a checkbox,
     * where it has not.
     */
    acceptTerms: z
      .boolean()
      .refine((accepted) => accepted, 'You must accept the Terms & Conditions'),
    acceptPrivacy: z.boolean().refine((accepted) => accepted, 'You must accept the Privacy Policy'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type RegisterForm = z.infer<typeof registerFormSchema>;

export const forgotPasswordFormSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
});
export type ForgotPasswordForm = z.infer<typeof forgotPasswordFormSchema>;

export const resetPasswordFormSchema = z
  .object({
    // The whole emailed link is accepted as well as the bare token; what
    // is validated is the token it carries (`emailed-token.ts`).
    token: z
      .string()
      .refine((value) => extractEmailedToken(value).length > 0, 'Paste the code from your email'),
    password: strongPassword,
    confirmPassword: z.string().min(1, 'Re-enter your password'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordForm = z.infer<typeof resetPasswordFormSchema>;

/**
 * Change password, from inside a session (checklist P-05).
 *
 * Mirrors `changePasswordSchema` in
 * `backend/src/modules/auth/dto/recovery.schema.ts` field for field:
 * `currentPassword` is `min(1)` and NOT the policy — applying the policy
 * to it would reject a patient whose existing password predates a policy
 * change, locking them out of the one endpoint that would let them fix
 * it. That is the backend's own reasoning and it holds here for the same
 * reason.
 *
 * `confirmNewPassword` is added on top of the wire shape, as
 * `resetPasswordFormSchema` adds it: a mistyped new password that is
 * never revealed is a lockout, and the server has nothing to compare a
 * second copy against.
 *
 * The "must differ from the current one" refinement is a courtesy, not
 * the rule. The server owns it and enforces it against the stored HASH,
 * so it catches cases a string comparison cannot (a differently-cased
 * copy, a password the hash matches but the form's own `currentPassword`
 * field does not hold). Failing fast here saves a round trip; the 422 is
 * still handled.
 */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: strongPassword,
    confirmNewPassword: z.string().min(1, 'Re-enter your new password'),
  })
  .refine((values) => values.newPassword === values.confirmNewPassword, {
    message: 'Passwords do not match',
    path: ['confirmNewPassword'],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: 'Choose a password you have not used here before',
    path: ['newPassword'],
  });
export type ChangePasswordForm = z.infer<typeof changePasswordFormSchema>;

/**
 * `POST /me/2fa/enable` — checklist D-16.
 *
 * A field-for-field mirror of `enableTwoFactorSchema` in
 * `backend/src/modules/auth/dto/two-factor.schema.ts`: exactly six
 * characters, digits only, and the server's own two messages. Six
 * digits is the TOTP standard and the backend's `.length(6)`, so
 * anything else is a typo the patient can fix without a round trip.
 */
export const enableTwoFactorFormSchema = z.object({
  code: z.string().length(6, 'Enter the 6-digit code').regex(/^\d+$/, 'Code must be digits only'),
});
export type EnableTwoFactorForm = z.infer<typeof enableTwoFactorFormSchema>;

/**
 * `POST /me/2fa/disable` — the account password, mirroring
 * `disableTwoFactorSchema`.
 *
 * `min(1)` and not the signup policy, for the same reason `loginSchema`
 * uses it: what matters is whether the password MATCHES, and a policy
 * failure would answer differently from a wrong one — which would tell
 * an attacker something about the password they do not have.
 */
export const disableTwoFactorFormSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
});
export type DisableTwoFactorForm = z.infer<typeof disableTwoFactorFormSchema>;

/**
 * `POST /me/2fa/setup` (owner decision D2, 2026-11-14): the current password
 * before the server mints a secret or recovery codes. Any non-empty value,
 * as for disable — whether it matches is the server's question.
 */
export const setupTwoFactorFormSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
});
export type SetupTwoFactorForm = z.infer<typeof setupTwoFactorFormSchema>;
