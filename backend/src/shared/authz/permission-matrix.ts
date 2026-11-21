/**
 * Matrix algebra — the pure half of RM M7.4.
 *
 * The client half of this lives in
 * `frontend/src/features/admin/permissions.ts` and drives ADM-09's
 * editor. This is the server's, and the difference in stakes is the
 * reason it exists: on the client a lock disables a switch, so an
 * administrator does not accidentally break the platform. Here a lock is
 * the rule a `PUT /roles/matrix` body is checked against, so an
 * administrator cannot *deliberately* break it — reconciliation §5 rule 2
 * says the request "is rejected, not merely hidden in the UI".
 *
 * Everything here is pure and total. `normalizeMatrix` in particular
 * accepts `unknown` and always returns a valid matrix: it is the boundary
 * between whatever is in storage and what the resolver is allowed to
 * assume.
 */

import {
  PERMISSION_CAPABILITIES,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  isPermission,
  isPlatformRole,
  orderCapabilities,
  type CapabilityMeta,
  type Permission,
  type PermissionMatrix,
  type PlatformRole,
} from './permission-catalogue';

export interface CellLock {
  /** The value the cell is fixed at. */
  readonly value: boolean;
  readonly reason: string;
}

const FALLBACK_LOCK_REASON = 'This cell is fixed by platform policy.';

/** The lock on one cell, or `null` when an administrator may move it. */
export function lockOf(capability: Permission, role: PlatformRole): CellLock | null {
  const meta = PERMISSION_CAPABILITIES.find((entry) => entry.id === capability);
  if (meta === undefined) return null;

  if (meta.lockedOn?.includes(role) === true) {
    return { value: true, reason: meta.lockReason ?? FALLBACK_LOCK_REASON };
  }
  if (meta.lockedOff?.includes(role) === true) {
    return { value: false, reason: meta.lockReason ?? FALLBACK_LOCK_REASON };
  }
  return null;
}

export function hasCapability(
  matrix: PermissionMatrix,
  role: PlatformRole,
  capability: Permission,
): boolean {
  return matrix[role].includes(capability);
}

/**
 * Returns the matrix with one cell set. **A locked cell is returned
 * unchanged** — the safety rules hold even when the caller ignores them,
 * which on the server means even when the caller is a hand-rolled HTTP
 * request rather than the editor UI.
 */
export function setCapability(
  matrix: PermissionMatrix,
  role: PlatformRole,
  capability: Permission,
  granted: boolean,
): PermissionMatrix {
  if (lockOf(capability, role) !== null) return matrix;

  const held = matrix[role];
  if (held.includes(capability) === granted) return matrix;

  return {
    ...matrix,
    [role]: granted
      ? orderCapabilities([...held, capability])
      : held.filter((id) => id !== capability),
  };
}

/**
 * Applies every lock to one role's set. Used by `normalizeMatrix` and,
 * more importantly, by the resolver *after* per-user overrides — an
 * override that could move a locked cell would be a way around §15.3's
 * validation, reached through a different endpoint.
 */
export function applyLocks(role: string, held: Iterable<Permission>): readonly Permission[] {
  const result = new Set<Permission>(held);

  // A role with no matrix column has no locks either — every `lockOf`
  // below returns null — so this degrades to "order the input", which is
  // the correct behaviour for `nurse`.
  if (!isPlatformRole(role)) return orderCapabilities(result);

  for (const capability of PERMISSION_CAPABILITIES) {
    const lock = lockOf(capability.id, role);
    if (lock === null) continue;
    if (lock.value) result.add(capability.id);
    else result.delete(capability.id);
  }

  return orderCapabilities(result);
}

/**
 * Repairs any input into a valid matrix: unknown ids dropped, missing
 * roles seeded, locks applied, catalogue order restored.
 *
 * A role that is absent from the input falls back to its seeded bundle
 * rather than to nothing. The alternative — an empty bundle — would turn
 * a storage read that lost a key into a silent, total revocation for
 * everyone holding that role, which looks exactly like a working system
 * until someone tries to do their job.
 */
export function normalizeMatrix(input: unknown): PermissionMatrix {
  const source: Readonly<Record<string, unknown>> =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  const entries = PLATFORM_ROLES.map((role) => {
    const raw = source[role];
    const stored: readonly Permission[] = Array.isArray(raw)
      ? raw.filter((id): id is Permission => typeof id === 'string' && isPermission(id))
      : SEEDED_MATRIX[role];

    return [role, applyLocks(role, stored)] as const;
  });

  return Object.fromEntries(entries) as PermissionMatrix;
}

/**
 * Capabilities no role would hold. Saving one of these leaves the
 * platform with a feature nobody can reach, so §15.3 blocks the save
 * rather than accepting it and letting someone discover it later.
 */
export function orphanedCapabilities(matrix: PermissionMatrix): readonly CapabilityMeta[] {
  return PERMISSION_CAPABILITIES.filter((capability) =>
    PLATFORM_ROLES.every((role) => !matrix[role].includes(capability.id)),
  );
}

/**
 * The cells a proposed matrix would move that it may not, in the shape
 * §15.3's 409 needs. Empty means the proposal respects every lock.
 */
export interface LockViolation {
  readonly role: PlatformRole;
  readonly capability: Permission;
  readonly requested: boolean;
  readonly reason: string;
}

export function lockViolations(proposed: PermissionMatrix): readonly LockViolation[] {
  const violations: LockViolation[] = [];

  for (const role of PLATFORM_ROLES) {
    for (const capability of PERMISSION_CAPABILITIES) {
      const lock = lockOf(capability.id, role);
      if (lock === null) continue;

      const requested = proposed[role].includes(capability.id);
      if (requested !== lock.value) {
        violations.push({ role, capability: capability.id, requested, reason: lock.reason });
      }
    }
  }

  return violations;
}

/**
 * One cell that a proposed grid would move (API §15.3).
 *
 * The server's counterpart to the frontend's `PermissionChange`. It
 * carries the capability **id** rather than the whole `CapabilityMeta`
 * the client version holds: the metadata is a transcription both sides
 * already have, and putting it in a response body would ship the labels
 * and lock reasons on every diff.
 */
export interface MatrixChange {
  readonly role: PlatformRole;
  readonly capability: Permission;
  /** The value the proposal would save. */
  readonly next: boolean;
  /** True when granting this reaches PHI — what the confirmation screen highlights. */
  readonly phi: boolean;
}

/**
 * Every cell that differs, in matrix reading order (capability → role).
 *
 * The order matters and is the same as the editor's, so the server's
 * change set and the client's read identically in a merge dialog — a
 * diff that listed the same changes in a different order would look like
 * a different diff to the person comparing them.
 */
export function diffMatrix(
  base: PermissionMatrix,
  proposed: PermissionMatrix,
): readonly MatrixChange[] {
  const changes: MatrixChange[] = [];

  for (const capability of PERMISSION_CAPABILITIES) {
    for (const role of PLATFORM_ROLES) {
      const before = base[role].includes(capability.id);
      const after = proposed[role].includes(capability.id);
      if (before === after) continue;

      changes.push({
        role,
        capability: capability.id,
        next: after,
        phi: capability.phi === true,
      });
    }
  }

  return changes;
}
