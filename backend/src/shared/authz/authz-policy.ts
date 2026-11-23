/**
 * Server-side authorization policy overlay (multi-hospital §2.1, §2.4, §2.8).
 *
 * `permission-catalogue.ts` and `permission-matrix.ts` are the shared
 * vocabulary and the editable matrix; parity specs keep them identical to
 * the frontend's copies, which render the matrix screen. They are not the
 * last word on what a principal may hold. This module is: every effective
 * permission set — the one `AuthorizationGuard` enforces (`PermissionResolver`)
 * and the one copied into a token for display (`PermissionService`) — passes
 * through `applyServerPolicy` after the matrix, the custom-role bundle and the
 * per-user overrides have been combined. Nothing can add a capability back
 * after it.
 *
 * The rules, each from an approved decision:
 *
 * 1. **No default PHI for administrators (§2.1).** The `admin` role never
 *    holds a capability that reads or writes clinical content or clear
 *    identity. Exceptional Access (`exceptional_access_grants`) is the only
 *    route to PHI for an administrator, checked per read, never a standing
 *    capability.
 * 2. **No global administrative power outside `admin` (§2.4, §2.8).** Staff
 *    categories, doctors, patients and every custom role are capped below the
 *    platform-administration capabilities, whatever an override says.
 * 3. **Category ceilings for every role (§2.4, §2.8).** Each staff category
 *    has a ceiling; a custom role is capped by the ceiling of the category it
 *    derives from. A role with no known category holds nothing (deny by
 *    default).
 */

import { PERMISSIONS, type Permission } from './permission-catalogue';

/** Clinical content and clear identity: never standing capabilities of `admin`. */
export const ADMIN_DENIED_PHI: readonly Permission[] = [
  'patients.revealIdentity',
  'records.view',
  'records.edit',
  'prescriptions.create',
  'labs.review',
  'communications.viewContent',
  'ai.use',
];

/** Platform administration: only ever held by `admin`. */
export const ADMIN_ONLY: readonly Permission[] = [
  'roles.manage',
  'settings.manageSystem',
  'integrations.manage',
  'logs.view',
  'logs.export',
  'doctors.manage',
  'doctors.verify',
  'patients.manageAccounts',
];

/** Staff categories (§2.4) plus the two system roles every account maps to. */
export type RoleCategory =
  | 'admin'
  | 'doctor'
  | 'reception'
  | 'laboratory'
  | 'pharmacy'
  | 'nurse'
  | 'patient';

const CATEGORIES: ReadonlySet<string> = new Set<RoleCategory>([
  'admin',
  'doctor',
  'reception',
  'laboratory',
  'pharmacy',
  'nurse',
  'patient',
]);

export function isRoleCategory(code: string): code is RoleCategory {
  return CATEGORIES.has(code);
}

const without = (...excluded: (readonly Permission[])[]): ReadonlySet<Permission> => {
  const out = new Set<Permission>(PERMISSIONS);
  for (const list of excluded) for (const capability of list) out.delete(capability);
  return out;
};

/**
 * The most a role of each category may ever hold.
 *
 * - `reception`, `laboratory`, `pharmacy` keep the catalogue's existing
 *   locks (no record authoring, no prescribing, no message content for
 *   laboratory and pharmacy) and lose platform administration.
 * - `nurse` has no defined bundle yet; its ceiling is deny-by-default for
 *   authoring, prescribing, message content and the AI assistant, and no
 *   platform administration. Anything inside the ceiling still has to be
 *   granted explicitly.
 * - `patient` holds no capability at all; patient routes authorize by
 *   self-scope (ADR-030), not capabilities.
 */
const CEILING: Readonly<Record<RoleCategory, ReadonlySet<Permission>>> = {
  admin: without(ADMIN_DENIED_PHI),
  doctor: without(ADMIN_ONLY),
  reception: without(ADMIN_ONLY, ['records.edit', 'prescriptions.create']),
  laboratory: without(ADMIN_ONLY, [
    'records.edit',
    'prescriptions.create',
    'communications.viewContent',
  ]),
  pharmacy: without(ADMIN_ONLY, [
    'records.edit',
    'prescriptions.create',
    'communications.viewContent',
  ]),
  nurse: without(ADMIN_ONLY, [
    'records.edit',
    'prescriptions.create',
    'communications.viewContent',
    'ai.use',
    'patients.revealIdentity',
  ]),
  patient: new Set<Permission>(),
};

/**
 * The category a role code answers to: the code itself for a system role, the
 * base role's code for a custom role. A custom role may never derive from
 * `admin` (§2.8: no role can grant Platform Admin privileges), so such a role
 * — or any role whose category is unknown — has no category and holds nothing.
 */
export function categoryOf(roleCode: string, baseRoleCode: string | null): RoleCategory | null {
  if (isRoleCategory(roleCode)) return roleCode;
  if (baseRoleCode === null || baseRoleCode === 'admin') return null;
  return isRoleCategory(baseRoleCode) ? baseRoleCode : null;
}

export function ceilingFor(category: RoleCategory | null): ReadonlySet<Permission> {
  return category === null ? new Set<Permission>() : CEILING[category];
}

/**
 * Caps `held` by the category ceiling. Order-preserving and pure; the result
 * is a subset of `held`.
 */
export function applyServerPolicy(
  roleCode: string,
  baseRoleCode: string | null,
  held: Iterable<Permission>,
): Permission[] {
  const ceiling = ceilingFor(categoryOf(roleCode, baseRoleCode));
  return [...new Set(held)].filter((capability) => ceiling.has(capability));
}

/**
 * Which standing a category is gated on (§2.4–§2.6). `admin` scope is
 * resolved separately (`AdminScopeService`); `patient` holds nothing.
 */
export function standingKindOf(category: RoleCategory | null): 'doctor' | 'staff' | null {
  if (category === 'doctor') return 'doctor';
  if (
    category === 'reception' ||
    category === 'laboratory' ||
    category === 'pharmacy' ||
    category === 'nurse'
  ) {
    return 'staff';
  }
  return null;
}
