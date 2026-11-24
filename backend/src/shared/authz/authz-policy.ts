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

import { type Permission } from './permission-catalogue';

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


/**
 * The most a role of each category may ever hold — an explicit allow-list
 * per category (audit F-13), not the catalogue minus a few exclusions. A
 * capability added to the catalogue is therefore held by no category until
 * someone puts it in one, and no two clinical categories share a ceiling:
 *
 * - `admin`: patient directory (masked), appointment administration,
 *   messaging oversight metadata and flags, and platform administration —
 *   never standing PHI (`ADMIN_DENIED_PHI`).
 * - `doctor`: the clinical set — charts, records (view/edit), prescribing,
 *   lab review, own appointments, messaging, the assistant. No
 *   administration and no oversight.
 * - `nurse`: charts and records to read, own appointments and messaging.
 *   No authoring, prescribing, lab review or assistant.
 * - `reception`: the patient directory and the schedule (own, reassignment,
 *   administrative cancellation) and messaging. No clinical content.
 * - `laboratory`: charts and records to read, lab review, messaging.
 * - `pharmacy`: the patient directory and messaging.
 * - `patient`: nothing — patient routes authorize by self-scope (ADR-030).
 *
 * Anything inside a ceiling still has to be granted explicitly (seeded
 * matrix, custom-role grant or override).
 */
const only = (...allowed: Permission[]): ReadonlySet<Permission> => new Set<Permission>(allowed);

const CEILING: Readonly<Record<RoleCategory, ReadonlySet<Permission>>> = {
  admin: only(
    'patients.view',
    'appointments.reassign',
    'appointments.cancelAdministratively',
    'messages.send',
    'communications.viewMetadata',
    'communications.resolveFlags',
    ...ADMIN_ONLY,
  ),
  doctor: only(
    'patients.view',
    'patients.revealIdentity',
    'records.view',
    'records.edit',
    'prescriptions.create',
    'labs.review',
    'appointments.manageOwn',
    'messages.send',
    'communications.viewMetadata',
    'ai.use',
  ),
  nurse: only('patients.view', 'records.view', 'appointments.manageOwn', 'messages.send', 'communications.viewMetadata'),
  reception: only(
    'patients.view',
    'appointments.manageOwn',
    'appointments.reassign',
    'appointments.cancelAdministratively',
    'messages.send',
    'communications.viewMetadata',
  ),
  laboratory: only('patients.view', 'records.view', 'labs.review', 'messages.send', 'communications.viewMetadata'),
  pharmacy: only('patients.view', 'messages.send', 'communications.viewMetadata'),
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
