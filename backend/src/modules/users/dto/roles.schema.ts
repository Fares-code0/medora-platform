/**
 * Request shapes for roles & permissions (API §15.3–15.5).
 *
 * The grid is validated structurally here — five known roles, arrays of
 * known capability codes — and *semantically* in the service, where the
 * locks, the orphan check and the revision compare live. The split is
 * deliberate: a 422 answers "this body is not a grid", and a 409 answers
 * "this grid is not allowed", and a client branches on them differently.
 */

import { z } from 'zod';

import { isPermission, PERMISSIONS, PLATFORM_ROLES } from '../../../shared/authz';

const capability = z.string().refine(isPermission, 'Unknown capability');

/**
 * The grid: every matrix role present, each with its capability list.
 *
 * Every role is **required**, not optional. A partial grid would have to
 * be merged with the stored one to mean anything, and "the roles you did
 * not mention keep what they had" is a rule that silently preserves a
 * cell an administrator believed they had cleared. `PUT` means the whole
 * grid, and this makes that literal.
 */
export const matrixGridSchema = z.object(
  Object.fromEntries(
    PLATFORM_ROLES.map((role) => [role, z.array(capability).max(PERMISSIONS.length)] as const),
  ) as Record<(typeof PLATFORM_ROLES)[number], z.ZodArray<typeof capability>>,
);

/** `POST /roles/matrix/preview` — a grid and nothing else. */
export const matrixPreviewSchema = z.object({ grid: matrixGridSchema });

export type MatrixPreviewInput = z.infer<typeof matrixPreviewSchema>;

/**
 * `PUT /roles/matrix`.
 *
 * `confirm: true` is `z.literal(true)` rather than a boolean, for the
 * same reason the consent fields at registration are: the contract calls
 * for an explicit confirmation, and accepting `false` is the one way a
 * save could go through without one. A caller who has not run the
 * preview cannot satisfy it by accident.
 */
export const matrixUpdateSchema = z.object({
  grid: matrixGridSchema,
  /** The revision the editor was opened on. A stale one is a 409. */
  revision: z.number().int().min(0),
  confirm: z.literal(true, { message: 'Confirm the change set before saving' }),
});

export type MatrixUpdateInput = z.infer<typeof matrixUpdateSchema>;

/**
 * `POST /roles` — a custom role from a base template (API §15.4).
 *
 * The code is the machine identifier the matrix and every `@Roles(...)`
 * would key on, so it is constrained the way one should be: lower-case,
 * no spaces, and normalised rather than rejected for case.
 */
export const createRoleSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Use at least 2 characters')
    .max(30, 'Keep it under 30 characters')
    .regex(/^[a-z][a-z0-9_-]*$/i, 'Letters, digits, underscore and hyphen; start with a letter')
    .transform((value) => value.toLowerCase()),
  label: z.string().trim().min(2, 'Name the role').max(60, 'Keep it under 60 characters'),
  /** The `roles.code` of the template whose bundle the new role copies. */
  baseRole: z.string().trim().min(1, 'Choose a base role').max(30),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;

/**
 * `PUT /users/{id}/permissions` — per-user overrides (API §15.5).
 *
 * Two lists rather than one, mirroring `user_permissions.allowed`: an
 * override must be able to *remove* a capability the role grants, and a
 * single "extra permissions" array cannot express that.
 *
 * A code in both lists is rejected here rather than resolved by
 * precedence. The resolver's order (union, then difference) would make
 * `revoked` win, but a body that says both is a client bug, and silently
 * picking one of two contradictory instructions about who may read a
 * chart is not a thing to do quietly.
 */
export const userPermissionsSchema = z
  .object({
    granted: z.array(capability).max(PERMISSIONS.length).default([]),
    revoked: z.array(capability).max(PERMISSIONS.length).default([]),
  })
  .refine((body) => body.granted.every((code) => !body.revoked.includes(code)), {
    message: 'A capability cannot be both granted and revoked',
    path: ['granted'],
  });

export type UserPermissionsInput = z.infer<typeof userPermissionsSchema>;
