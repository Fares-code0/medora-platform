import { z } from 'zod';

import { strongPassword } from './password';

/**
 * The two forms of invitation acceptance (ADR-035 §5).
 *
 * Two schemas because there are genuinely two submissions, separated by a
 * server round trip that returns the secret the second one is checked
 * against. The token comes from the query string rather than a field, as
 * it does on the reset-password screen.
 */

/** Phase 1 — choose a password. Same policy as every other password here. */
export const acceptInvitationSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type AcceptInvitationValues = z.infer<typeof acceptInvitationSchema>;

/**
 * Phase 2 — a code from the authenticator.
 *
 * Mirrors `otpSchema`: exactly six digits, which is what
 * `activateAdminInvitationSchema` requires server-side.
 */
export const activateInvitationSchema = z.object({
  code: z
    .string()
    .length(6, 'Enter the 6-digit code')
    .regex(/^\d+$/, 'Code must be digits only'),
});

export type ActivateInvitationValues = z.infer<typeof activateInvitationSchema>;
