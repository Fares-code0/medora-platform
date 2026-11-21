import { z } from 'zod';

/**
 * `POST /auth/login` (RM M6.2, API §1.2).
 *
 * Transcribed from `frontend/src/features/auth/schemas/login.ts`. The
 * password carries `min(1)` and **not** the signup policy: the rule that
 * matters here is whether it matches the stored hash, and rejecting a
 * short password with a 422 would tell an attacker their guess was too
 * short — a different answer for a wrong password, which is exactly what
 * "identical timing/shape" forbids.
 */
export const loginSchema = z.object({
  email: z.string().min(1, 'Enter your email').email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
  /** The frontend always sends it; the default keeps a mobile client honest. */
  rememberMe: z.boolean().default(false),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** `POST /auth/otp/verify` (API §1.3) — six digits, exactly. */
export const otpVerifySchema = z.object({
  otpToken: z.string().min(1),
  code: z.string().length(6, 'Enter the 6-digit code').regex(/^\d+$/, 'Code must be digits only'),
});

export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

/** `POST /auth/otp/resend` (API §1.4). */
export const otpResendSchema = z.object({ otpToken: z.string().min(1) });

export type OtpResendInput = z.infer<typeof otpResendSchema>;

/**
 * `POST /auth/otp/recovery` (owner decision R1) — a recovery code in place
 * of the six digits, against the same pending challenge.
 *
 * The bound is loose on purpose: case, spaces and the dash are normalised
 * by `RecoveryCodeService`, and a value that is not shaped like a code is
 * an ordinary wrong code (401, one attempt spent) rather than a 422 that
 * would tell a guesser which inputs are worth trying.
 */
export const otpRecoverySchema = z.object({
  otpToken: z.string().min(1),
  recoveryCode: z.string().min(1, 'Enter a recovery code').max(64),
});

export type OtpRecoveryInput = z.infer<typeof otpRecoverySchema>;
