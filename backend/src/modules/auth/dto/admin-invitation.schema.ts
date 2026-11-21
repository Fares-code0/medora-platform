import { z } from 'zod';

import { PERMISSIONS, isPermission } from '../../../shared/authz';

import { strongPassword } from './password.schema';

/**
 * Administrator provisioning (ADR-035 §5).
 *
 * The three bodies of the invitation flow: an authorized administrator
 * creates an invitation, the invitee accepts it by setting a password,
 * and the invitee activates the account by proving a second factor.
 *
 * There is no "register as administrator" body here and there never will
 * be. That is the whole point of the flow — see `register.schema.ts` on
 * why `role: 'admin'` was removed from the public union.
 */

/**
 * The roles an invitation may confer.
 *
 * `admin` plus the three staff roles that hold real bundles. Not
 * `doctor`: a doctor's account carries a professional registration number
 * and a verification status, which this flow does not collect and must
 * not fabricate — doctors self-register through `POST /auth/register` and
 * are then verified. Not `patient` either, for the obvious reason that a
 * patient is not provisioned by an administrator.
 *
 * Transcribed rather than imported from `PLATFORM_ROLES` deliberately.
 * That constant is the *permission matrix's* column list, and it includes
 * `doctor`; this is the list of roles that may be **created by
 * invitation**, which is a different question with a different answer.
 * Deriving one from the other would silently add `doctor` here the moment
 * someone read the two as synonyms.
 */
export const INVITABLE_ROLES = ['admin', 'reception', 'laboratory', 'pharmacy'] as const;

export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * `POST /auth/admin-invitations` — guarded by `@Can('roles.manage')`.
 *
 * `permissions` is the per-user override list applied on acceptance, as
 * `permissions.code` values validated against the catalogue. Empty is the
 * ordinary case and means "the role bundle, unmodified" — an invitation
 * that grants nothing extra is not a degenerate invitation, it is the
 * normal one.
 *
 * Validated against the real 22-code union rather than accepting any
 * string: an unknown code would be stored, applied at acceptance, resolve
 * to no `permissions` row, and read in the matrix editor as a granted
 * capability that silently does nothing. The seed makes the same check
 * for the same reason.
 */
export const createAdminInvitationSchema = z.object({
  email: z.string().min(1, 'Enter an email address').email('Enter a valid email address'),
  role: z.enum(INVITABLE_ROLES, { message: 'Select a role to invite' }),
  permissions: z
    .array(z.string().refine(isPermission, 'Unknown capability'))
    .max(PERMISSIONS.length)
    .default([]),
});

export type CreateAdminInvitationInput = z.infer<typeof createAdminInvitationSchema>;

/**
 * `POST /auth/admin-invitations/accept` — public, the token is the
 * credential.
 *
 * Phase 1 of two. Creates the account INACTIVE with a TOTP secret
 * provisioned and returns the enrolment material; it does **not** produce
 * a session, because an administrator account with no second factor is
 * not an account anyone should be signed in to.
 */
export const acceptAdminInvitationSchema = z.object({
  token: z.string().min(1, 'This invitation link is not valid'),
  password: strongPassword,
});

export type AcceptAdminInvitationInput = z.infer<typeof acceptAdminInvitationSchema>;

/**
 * `POST /auth/admin-invitations/activate` — public, same token.
 *
 * Phase 2. Proves a code from the secret phase 1 issued, turns
 * `two_factor_enabled` on and moves the account to ACTIVE. The same token
 * spans both phases and each is guarded by a different column
 * (`accepted_at`, `completed_at`), so neither replays.
 */
export const activateAdminInvitationSchema = z.object({
  token: z.string().min(1, 'This invitation link is not valid'),
  code: z.string().length(6, 'Enter the 6-digit code').regex(/^\d+$/, 'Code must be digits only'),
});

export type ActivateAdminInvitationInput = z.infer<typeof activateAdminInvitationSchema>;
