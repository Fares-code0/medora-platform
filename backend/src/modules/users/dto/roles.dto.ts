/**
 * Roles & permissions — API §15.
 *
 * The response shapes ADM-09's matrix editor
 * (`frontend/src/features/admin/sections/settings/PermissionMatrixPanel.tsx`)
 * reads. `PermissionMatrixState` on the client is `{ matrix, revision,
 * updatedAt, updatedBy }`, and `MatrixView` below is that, field for
 * field.
 *
 * ## `revision` is the concurrency token, not `updatedAt`
 *
 * API §15.3 writes the body as `{ grid, updatedAt, confirm }`. A
 * timestamp is the wrong token for a compare-and-set: `updated_at` has
 * millisecond resolution, two saves inside one millisecond compare equal,
 * and the second silently overwrites the first — which is the exact
 * failure the 409 exists to prevent. The frontend's own state already
 * carries a monotonic `revision` beside the timestamp, so this uses it
 * and returns `updatedAt` for display. The merge dialog needs a *reliable*
 * conflict, not a nicely-formatted one.
 */

import type { MatrixChange, PermissionMatrix } from '../../../shared/authz';

export interface RoleView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  /** Null for a seeded role; the template's code for a custom one. */
  readonly baseRole: string | null;
  /** False for a role an administrator created (API §15.4). */
  readonly system: boolean;
  /** Accounts holding it, active and inactive alike. */
  readonly members: number;
  /** Active accounts only — what a change to this role would actually reach. */
  readonly activeMembers: number;
  /** True when the role has a column in the permission matrix. */
  readonly inMatrix: boolean;
}

export interface CapabilityView {
  readonly id: string;
  readonly group: string;
  /** True when holding this capability reaches patient-identifying data. */
  readonly phi: boolean;
}

export interface CapabilityCatalogueView {
  readonly groups: readonly {
    readonly group: string;
    readonly capabilities: readonly CapabilityView[];
  }[];
  readonly total: number;
}

export interface MatrixView {
  readonly matrix: PermissionMatrix;
  readonly revision: number;
  readonly updatedAt: string;
  /** The `usr_…` handle of whoever last saved, or null for the baseline. */
  readonly updatedBy: string | null;
}

/**
 * `POST /roles/matrix/preview` — API §15.3's dry run.
 *
 * `affectedUsers` is the number the confirmation screen puts in front of
 * an administrator, so it counts **active** accounts only: a deactivated
 * account cannot exercise a capability, and an inflated number on a
 * confirmation screen is worse than no number.
 */
export interface AffectedRoleView {
  readonly role: string;
  readonly grants: number;
  readonly revokes: number;
  readonly activeUsers: number;
}

export interface MatrixPreviewView {
  readonly changes: readonly MatrixChange[];
  readonly roles: readonly AffectedRoleView[];
  /** Distinct active accounts across every changed role. */
  readonly affectedUsers: number;
  /** The subset of `changes` that grants a PHI-reaching capability. */
  readonly phiGrants: readonly MatrixChange[];
  /** Capabilities the proposal would leave with no role at all. */
  readonly orphaned: readonly string[];
}

/**
 * The 409 body for a concurrent edit — API §15.3's "both change sets".
 *
 * The merge dialog needs three things to be useful and this carries all
 * three: what the caller wanted to change (`yours`), what landed while
 * they were editing (`theirs`), and the grid as it now stands so the
 * editor can rebase on it without a second round trip.
 */
export interface MatrixConflict {
  readonly current: MatrixView;
  readonly yours: readonly MatrixChange[];
  readonly theirs: readonly MatrixChange[];
}

/** `GET /users/{id}/permissions` — API §15.5. */
export interface UserPermissionsView {
  readonly userId: string;
  readonly role: string;
  /** The role bundle before overrides. */
  readonly fromRole: readonly string[];
  readonly granted: readonly string[];
  readonly revoked: readonly string[];
  /** `bundle ∪ granted − revoked`, with locks re-applied — what the guard sees. */
  readonly effective: readonly string[];
}
