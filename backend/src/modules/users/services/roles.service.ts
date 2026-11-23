/**
 * Roles & permissions over HTTP (RM M7.4, API §15).
 *
 * The algebra this service enforces — locks, orphan detection, the diff
 * — is `shared/authz`'s and was built at M7 with no endpoint on top of
 * it. This is that endpoint. **Nothing here re-implements a rule**; the
 * kernel decides and this translates the decision into the status code
 * and body the contract fixes.
 *
 * ## Four ways a save is refused, and each is a different status
 *
 * | Refusal | Status | Why this one |
 * |---|---|---|
 * | Stale revision | **409** + both change sets | A merge is possible; the client has a dialog for it |
 * | Lock violation | **409** + the violated cells | Not a merge, but recoverable by un-toggling |
 * | Orphaned capability | **409** + the orphans | Same shape: a fixable grid, not a malformed one |
 * | Unknown role or code | **422** | The body is not a grid; the parser says so |
 *
 * A lock violation is deliberately **not** silently corrected. The
 * kernel's `setCapability` returns a locked cell unchanged, and
 * `normalizeMatrix` re-applies locks — so accepting the save and
 * repairing it would succeed while quietly doing something other than
 * what was asked. Reconciliation §5 rule 2 says the request "is
 * rejected, not merely hidden in the UI", and a repair-on-save is the
 * server-side version of hiding it.
 *
 * ## Every save invalidates the cache, and that is not optional
 *
 * The matrix is what `PermissionResolver` reads on a miss. A save that
 * did not invalidate would leave every already-cached user on the old
 * bundle until the TTL expired — a revocation that does not take, which
 * is exactly the property M7.1 flags as the reason the in-memory cache
 * could not ship. `forgetAll()` rather than `forgetRole`: a whole-grid
 * save can change any role, so the set to invalidate is "everyone".
 *
 * Invalidation goes through `PermissionResolver`, not the cache port
 * directly. The cache is Redis now, and a Redis call can fail; the save
 * has already committed by then, so a throw would answer 500 for a change
 * that happened and skip its audit write. The resolver logs the failure
 * and carries on (its `guardCache`), which is the behaviour its other
 * invalidations already had.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import {
  diffMatrix,
  isPermission,
  lockViolations,
  normalizeMatrix,
  orphanedCapabilities,
  PERMISSION_CAPABILITIES,
  PERMISSION_GROUPS,
  PERMISSIONS,
  PLATFORM_ROLES,
  PermissionResolver,
  isPlatformRole,
  type MatrixChange,
  type Permission,
  type PermissionMatrix,
  type PlatformRole,
} from '../../../shared/authz';
import { isUniqueViolation } from '../../../shared/database';
import type {
  AffectedRoleView,
  CapabilityCatalogueView,
  MatrixConflict,
  MatrixPreviewView,
  MatrixView,
  RoleView,
  UserPermissionsView,
} from '../dto/roles.dto';
import type {
  CreateRoleInput,
  MatrixPreviewInput,
  MatrixUpdateInput,
  UserPermissionsInput,
} from '../dto/roles.schema';
import {
  MatrixRevisionConflict,
  RolesRepository,
  type MatrixRevisionRow,
} from '../repositories/roles.repository';

@Injectable()
export class RolesService {
  constructor(
    private readonly roles: RolesRepository,
    private readonly permissions: PermissionResolver,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  /** API §15.1 — roles with member counts. */
  async list(): Promise<readonly RoleView[]> {
    const rows = await this.roles.roles();

    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      baseRole: row.baseRole?.code ?? null,
      system: row.isSystem,
      members: row.members,
      activeMembers: row.activeMembers,
      // `nurse` is the standing example: a role a user can hold with no
      // column in the matrix, so no source states what it may do and it
      // resolves to zero capabilities (ADR-017 §6). The flag is on the
      // wire so the editor can say so rather than render an empty column
      // that looks like a mistake.
      inMatrix: isPlatformRole(row.code),
    }));
  }

  /** API §15.1 — the 22-capability catalogue, grouped by domain. */
  catalogue(): CapabilityCatalogueView {
    return {
      groups: PERMISSION_GROUPS.map((group) => ({
        group,
        capabilities: PERMISSION_CAPABILITIES.filter(
          (capability) => capability.group === group,
        ).map((capability) => ({
          id: capability.id,
          group: capability.group,
          phi: capability.phi === true,
        })),
      })),
      total: PERMISSIONS.length,
    };
  }

  /** API §15.2 — the grid plus the revision a save must quote back. */
  async matrix(): Promise<MatrixView> {
    const [stored, revision] = await Promise.all([this.roles.matrix(), this.roles.revision()]);

    return toMatrixView(normalizeMatrix(stored), revision);
  }

  /**
   * API §15.3's dry run — what a grid would change, and who it reaches.
   *
   * Read-only and deliberately **not** revision-checked: a preview whose
   * base moved is still an accurate description of the diff against the
   * base as it now stands, and refusing to describe a change set because
   * someone else saved is unhelpful at the exact moment the
   * administrator needs to see what happened.
   */
  async preview(input: MatrixPreviewInput): Promise<MatrixPreviewView> {
    const [stored, activeByRole] = await Promise.all([
      this.roles.matrix(),
      this.roles.activeMembersByRole(),
    ]);

    const base = normalizeMatrix(stored);
    // Normalised, so the diff is against what would actually be saved
    // rather than against the raw body — otherwise a locked cell the
    // client left toggled would show as a change that never lands.
    const proposed = normalizeMatrix(input.grid);
    const changes = diffMatrix(base, proposed);

    const roles: AffectedRoleView[] = PLATFORM_ROLES.map((role) => {
      const forRole = changes.filter((change) => change.role === role);
      return {
        role,
        grants: forRole.filter((change) => change.next).length,
        revokes: forRole.filter((change) => !change.next).length,
        activeUsers: activeByRole[role] ?? 0,
      };
    }).filter((entry) => entry.grants + entry.revokes > 0);

    return {
      changes,
      roles,
      // Distinct active accounts across every changed role. Roles do not
      // overlap — one account holds one role — so the sum is the count.
      affectedUsers: roles.reduce((total, entry) => total + entry.activeUsers, 0),
      phiGrants: changes.filter((change) => change.next && change.phi),
      orphaned: orphanedCapabilities(proposed).map((capability) => capability.id),
    };
  }

  /** API §15.3 — the save. */
  async updateMatrix(actor: AuthenticatedUser, input: MatrixUpdateInput): Promise<MatrixView> {
    const proposedRaw = toMatrix(input.grid);

    // Checked **before** normalisation, against the body as sent: after
    // `normalizeMatrix` every lock is satisfied by construction, so a
    // check afterwards could never fail and the endpoint would silently
    // accept a grid that moved a locked cell.
    const violations = lockViolations(proposedRaw);
    if (violations.length > 0) {
      throw new AppException(409, {
        message: 'Some cells are fixed by platform policy',
        code: 'conflict',
        detail: violations
          .map((violation) => `${violation.role}/${violation.capability}: ${violation.reason}`)
          .join('; '),
      });
    }

    const orphans = orphanedCapabilities(proposedRaw);
    if (orphans.length > 0) {
      throw AppException.conflict(
        `No role would hold: ${orphans.map((capability) => capability.id).join(', ')}`,
        'conflict',
      );
    }

    const base = normalizeMatrix(await this.roles.matrix());
    const proposed = normalizeMatrix(proposedRaw);
    const changes = diffMatrix(base, proposed);

    let saved: MatrixRevisionRow;
    try {
      saved = await this.roles.replaceMatrix({
        grid: proposed,
        expectedRevision: input.revision,
        actorId: actor.id,
      });
    } catch (error) {
      if (error instanceof MatrixRevisionConflict) {
        throw await this.conflictFor(input, changes);
      }
      throw error;
    }

    // Before the audit write, not after: a caller whose next request is
    // authorized from a stale cache would see the change fail to take,
    // and the ledger is not what the resolver reads.
    await this.permissions.forgetAll();

    await this.audit.record({
      action: 'roles.matrix_update',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'permission_matrix',
      entityId: String(saved.revision),
      metadata: {
        revision: saved.revision,
        changes: changes.length,
        // The change set itself is a list and `AuditMetadata` holds
        // primitives; the cells are joined into one field rather than
        // dropped, because "the matrix changed" without saying how is an
        // audit row nobody can act on.
        cells: changes
          .map((change) => `${change.role}/${change.capability}=${String(change.next)}`)
          .join(' '),
        phiGrants: changes.filter((change) => change.next && change.phi).length,
      },
    });

    await this.activity.record({
      userId: actor.id,
      kind: 'security',
      summary: 'Updated the permission matrix',
      detail: `${String(changes.length)} cell(s) changed`,
    });

    return toMatrixView(proposed, saved);
  }

  /** API §15.4 — a custom role copying a template's bundle. */
  async createRole(actor: AuthenticatedUser, input: CreateRoleInput): Promise<RoleView> {
    const base = await this.roles.findRoleByCode(input.baseRole);
    if (base === null) {
      throw AppException.validation({ baseRole: ['Unknown base role'] }, 'Unknown base role');
    }

    let created;
    try {
      created = await this.roles.createFromTemplate({
        code: input.code,
        label: input.label,
        baseRoleId: base.id,
        actorId: actor.id,
      });
    } catch (error) {
      // `roles.code` is unique; the pre-check a caller would expect is
      // the constraint itself, so two creations racing on one code land
      // here rather than producing a duplicate.
      if (isUniqueViolation(error)) {
        throw AppException.conflict(`A role with the code "${input.code}" already exists`);
      }
      throw error;
    }

    await this.audit.record({
      action: 'roles.create',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'role',
      entityId: created.id,
      metadata: { code: created.code, baseRole: base.code },
    });

    return {
      id: created.id,
      code: created.code,
      label: created.label,
      baseRole: created.baseRole?.code ?? null,
      system: created.isSystem,
      members: created.members,
      activeMembers: created.activeMembers,
      // A custom role has no matrix column until someone adds one to the
      // catalogue, which is a frontend change first (see the catalogue's
      // header). Its bundle is the copied one and the resolver reads it
      // from `role_permissions` regardless — `inMatrix` says only whether
      // the editor has a column to draw.
      inMatrix: isPlatformRole(created.code),
    };
  }

  /** API §15.5 — read one account's overrides and the effective set. */
  async userPermissions(publicId: string): Promise<UserPermissionsView> {
    const row = await this.roles.overridesFor(publicId);
    if (row === null) throw AppException.notFound('User not found');

    const matrix = normalizeMatrix(await this.roles.matrix());
    const fromRole = isPlatformRole(row.role) ? matrix[row.role] : [];

    return {
      userId: publicId,
      role: row.role,
      fromRole: [...fromRole],
      granted: row.granted,
      revoked: row.revoked,
      effective: await this.effectiveFor(row.userId, row.role),
    };
  }

  /**
   * API §15.5 — replace one account's overrides.
   *
   * The effective set is recomputed and returned, **with locks
   * re-applied**, so an administrator sees what the guard will actually
   * see rather than what they typed. A `user_permissions` row cannot put
   * `roles.manage` on a doctor or take it off the last administrator —
   * `PermissionService.resolve` re-applies locks for exactly that reason,
   * and a response that showed the raw override would disagree with
   * every subsequent authorization decision.
   */
  async setUserPermissions(
    actor: AuthenticatedUser,
    publicId: string,
    input: UserPermissionsInput,
  ): Promise<UserPermissionsView> {
    const row = await this.roles.overridesFor(publicId);
    if (row === null) throw AppException.notFound('User not found');

    await this.roles.replaceOverrides({
      userId: row.userId,
      granted: input.granted,
      revoked: input.revoked,
      actorId: actor.id,
    });

    // One user changed, so one entry to invalidate — `forget`, not
    // `clear`: emptying the whole cache to revoke one override would
    // make every other user's next request read through to Postgres.
    await this.permissions.forget(row.userId);

    await this.audit.record({
      action: 'roles.user_overrides',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'user',
      entityId: publicId,
      metadata: {
        granted: input.granted.join(' '),
        revoked: input.revoked.join(' '),
        beforeGranted: row.granted.join(' '),
        beforeRevoked: row.revoked.join(' '),
      },
    });

    await this.activity.record({
      userId: row.userId,
      kind: 'security',
      summary: 'An administrator changed your permissions',
    });

    const matrix = normalizeMatrix(await this.roles.matrix());
    const fromRole = isPlatformRole(row.role) ? matrix[row.role] : [];

    return {
      userId: publicId,
      role: row.role,
      fromRole: [...fromRole],
      granted: input.granted,
      revoked: input.revoked,
      effective: await this.effectiveFor(row.userId, row.role),
    };
  }

  /**
   * The effective set exactly as the guard will see it: the resolver's own
   * answer (matrix, custom-role bundle, overrides, locks and the server
   * policy's category ceilings), computed from the database rather than a
   * second copy of the algebra that could drift from it.
   */
  private async effectiveFor(userId: string, roleCode: string): Promise<Permission[]> {
    return [...(await this.permissions.effectivePermissions({ userId, roleCode })).permissions];
  }

  /**
   * The 409 body for a concurrent edit — API §15.3's "both change sets".
   *
   * `theirs` is computed against the grid the *caller* opened on, which
   * is the only base that makes the two diffs comparable. Reconstructing
   * that base is not possible from the revision alone — the old grid is
   * gone — so `theirs` is measured against the caller's proposal
   * instead, which is what a merge dialog actually needs: "here is how
   * the saved grid differs from the one you are holding".
   */
  private async conflictFor(
    input: MatrixUpdateInput,
    yours: readonly MatrixChange[],
  ): Promise<AppException> {
    const current = await this.matrix();
    const proposed = normalizeMatrix(toMatrix(input.grid));

    const conflict: MatrixConflict = {
      current,
      yours,
      theirs: diffMatrix(proposed, current.matrix),
    };

    return new AppException(409, {
      message: 'The permission matrix changed since this editor was opened',
      code: 'conflict',
      detail: JSON.stringify(conflict),
    });
  }
}

/**
 * The validated body as a `PermissionMatrix`.
 *
 * Built key by key over `PLATFORM_ROLES` rather than spread from the
 * body, so the result has exactly the five columns the type promises
 * even though the schema has already guaranteed it — the alternative is
 * a cast through `unknown`, which would also silence a genuine mismatch
 * if the schema and the catalogue ever disagreed about the role list.
 */
function toMatrix(grid: Readonly<Record<string, readonly string[]>>): PermissionMatrix {
  const matrix = {} as Record<PlatformRole, readonly Permission[]>;

  for (const role of PLATFORM_ROLES) {
    matrix[role] = (grid[role] ?? []).filter(isPermission);
  }

  return matrix;
}

function toMatrixView(matrix: PermissionMatrix, revision: MatrixRevisionRow): MatrixView {
  return {
    matrix,
    revision: revision.revision,
    updatedAt: revision.updatedAt.toISOString(),
    updatedBy: revision.updatedBy,
  };
}
