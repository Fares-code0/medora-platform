/**
 * Request shapes for the account surface (API §2.2, §2.8, §2.10).
 *
 * Transcribed from the contract's own validation notes rather than
 * invented: §2.2 fixes username at "3–30, `/^[a-z0-9._-]+$/i`" and phone
 * at "7–30".
 */

import { z } from 'zod';

import { ACTIVITY_KINDS } from '../../../shared/activity';

/**
 * The username character class, from API §2.2 verbatim.
 *
 * Case-insensitive in the pattern but **stored lower-cased** (see the
 * transform): `Amelia` and `amelia` must not be two accounts, and the
 * column's unique index is case-*sensitive* — unlike `users.email`,
 * which is citext. Normalising on the way in is what closes that gap;
 * making the column citext too would be a migration for the same effect
 * and would still let a caller believe they had claimed `Amelia`.
 */
const USERNAME_PATTERN = /^[a-z0-9._-]+$/i;

/**
 * `PATCH /me/account` — API §2.2.
 *
 * Both fields optional so the client can send one slice; `.strict()` is
 * deliberately **not** used, matching `registerSchema`'s reasoning — an
 * unknown key is stripped rather than rejected, so a client sending back
 * the whole `AccountSettings` document it read is not an error.
 *
 * `email` is absent on purpose. Changing a sign-in address is not a
 * profile edit: it needs the new address verified before it takes effect
 * and the old one notified, or an attacker with a borrowed session moves
 * the account to their own inbox and the password-reset flow hands them
 * the keys. That flow has no endpoint in API §2 and is not built here.
 */
export const updateAccountSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'Use at least 3 characters')
    .max(30, 'Keep it under 30 characters')
    .regex(USERNAME_PATTERN, 'Letters, digits, dot, underscore and hyphen only')
    .transform((value) => value.toLowerCase())
    .optional(),
  phone: z
    .string()
    .trim()
    .min(7, 'Use at least 7 characters')
    .max(30, 'Keep it under 30 characters')
    .optional(),
});

export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;

/** `GET /me/activity` — API §2.8. Optional `kind` filter plus paging. */
export const activityQuerySchema = z.object({
  kind: z.enum(ACTIVITY_KINDS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ActivityQuery = z.infer<typeof activityQuerySchema>;

/**
 * `GET /admin/users` — API §2.10.
 *
 * `q` searches name and email. `role` and `active` are the two columns
 * the panel filters on. Nothing here is a sort parameter: the list is
 * newest-first and a sort whitelist belongs with M10.1's, where the
 * pattern is established for a list that actually needs one.
 */
export const platformUserQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  role: z.string().trim().min(1).max(40).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PlatformUserQuery = z.infer<typeof platformUserQuerySchema>;

/**
 * `PATCH /admin/users/{id}` — API §2.10.
 *
 * Role and active flag, and nothing else. Notably **not** here:
 *
 * `password` — an administrator never sets a user's password. M10.7
 * states the rule for patients ("secure reset link — admin never sets a
 * password") and it is not a patient-specific rule; the supported path is
 * `POST /auth/forgot-password`.
 *
 * `email` — see `updateAccountSchema`. Moving someone's sign-in address
 * from an admin panel is the same takeover with a different actor.
 *
 * `permissions` — per-user capability overrides are API §15's surface
 * (M7.4), where the lock rules and the affected-user preview live. A
 * second write path into `user_permissions` that skipped those checks
 * would be the hole `PermissionService`'s lock re-application exists to
 * close.
 */
export const updatePlatformUserSchema = z
  .object({
    role: z.string().trim().min(1).max(40).optional(),
    active: z.boolean().optional(),
  })
  .refine((body) => body.role !== undefined || body.active !== undefined, {
    message: 'Change a role or the active flag',
  });

export type UpdatePlatformUserInput = z.infer<typeof updatePlatformUserSchema>;
