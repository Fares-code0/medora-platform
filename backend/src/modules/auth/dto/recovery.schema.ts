import { z } from 'zod';

import { strongPassword } from './password.schema';

/**
 * The password flows (RM M6.5, API §1.7–1.8, §2.3) and email
 * verification (RM M6.6, API §1.9–1.10).
 *
 * `resetPasswordSchema` mirrors `frontend/src/features/auth/schemas/reset.ts`
 * minus its `confirmPassword` refinement, for the same reason
 * `registerSchema` drops it: the server holds one password and has
 * nothing to compare it against.
 */
export const forgotPasswordSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: strongPassword,
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * API §2.3 — `{ currentPassword, newPassword }`.
 *
 * `currentPassword` is `min(1)`: it is checked against the stored hash,
 * and applying the policy to it would reject a user whose existing
 * password predates a policy change — locking them out of the one
 * endpoint that would let them fix it.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: strongPassword,
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/**
 * `POST /me/password/verify` — the lock screen's re-authentication
 * (`docs/handoff/auth-seam.md` §4.1, A-07).
 *
 * `min(1)` and not the policy, for `loginSchema`'s reason: the only
 * question is whether it matches, and a policy failure would answer a
 * wrong guess differently from another wrong guess.
 */
export const verifyPasswordSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
});

export type VerifyPasswordInput = z.infer<typeof verifyPasswordSchema>;

export const verifyEmailSchema = z.object({ token: z.string().min(1) });

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

/**
 * `POST /auth/verification/resend` (API §1.10).
 *
 * Takes an address rather than a token: the user is on the verify-email
 * page having never opened the first message, so an address is all they
 * have. Like `forgot-password`, it answers the same way whether or not
 * the account exists.
 */
export const resendVerificationSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
});

export type ResendVerificationInput = z.infer<typeof resendVerificationSchema>;
