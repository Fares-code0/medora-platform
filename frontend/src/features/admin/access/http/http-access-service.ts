import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  malformedResponse,
  notConnected,
  readArray,
  readBoolean,
  readData,
  readNumber,
  readOptionalString,
  readString,
} from '@/api/http';
import { isApiError } from '@/types/api';

import {
  findCapability,
  normalizePermissionMatrix,
  PermissionConflictError,
  PLATFORM_ROLES,
  type CapabilityMeta,
  type MatrixPreview,
  type PermissionChange,
  type PermissionMatrixState,
  type PlatformRole,
} from '../../permissions';
import type { AccessRole, AccessService, AccessUser, RoleCounts } from '../access-service';

/**
 * Users, roles and staff invitations over HTTP (FE-10.10).
 *
 * | Port method  | Endpoint                                              |
 * | ------------ | ----------------------------------------------------- |
 * | `listUsers`  | `GET /admin/users?q=&role=` (every page) — API §2.10  |
 * | `updateUser` | `PATCH /admin/users/{id}` — role and active only      |
 * | `getMatrix`  | `GET /roles/matrix` — API §15.2                       |
 * | `roleCounts` | `GET /roles` — `activeMembers` per role               |
 * | `previewMatrix` | `POST /roles/matrix/preview` `{ grid }` — the dry run |
 * | `saveMatrix` | `PUT /roles/matrix` `{ grid, revision, confirm }`     |
 * | `invite`     | `POST /auth/admin-invitations` — ADR-035 §5           |
 * | `listRoles`  | `GET /roles` — API §15.1                              |
 * | `createRole` | `POST /roles` `{ code, label, baseRole }` — API §15.4 |
 *
 * There is no route to reset the matrix to its seeded baseline, so
 * `resetMatrix` answers not connected and the panel does not offer it.
 *
 * ## The two kinds of 409 a matrix save can meet
 *
 * A stale revision is a 409 whose `detail` is the JSON conflict body —
 * `{ current, yours, theirs }` — because the error envelope carries a
 * string. That one becomes a `PermissionConflictError` holding the grid as
 * it now stands, and the panel's merge dialog takes over exactly as it does
 * in the demo. A lock violation or an orphaned capability is a 409 with a
 * sentence in `detail`, and is passed through for the panel to show.
 *
 * ## The dry run is the server's
 *
 * The review dialog shows `previewMatrix`'s answer rather than its own diff:
 * the server compares the proposal with the matrix as stored now, after its
 * locks are applied, and counts the active accounts each changed role holds.
 * A change or orphan naming a role or capability this client does not know is
 * a malformed answer, not one to show in part.
 *
 * ## `updatedBy` is a handle
 *
 * The matrix names its last editor by `usr_…` handle. The panel prints a
 * name, so the handle is looked up through `GET /admin/users/{id}` — the
 * same capability the matrix already required — and printed as-is if that
 * lookup fails rather than failing the panel.
 */

/** Shown for the seeded matrix, which no administrator saved. */
const BASELINE = 'Platform baseline';

export function toAccessUser(value: unknown): AccessUser {
  const what = 'platform user';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    email: readString(dto, 'email', what),
    role: readString(dto, 'role', what),
    active: readBoolean(dto, 'active', what),
    lastActiveAt: readOptionalString(dto, 'lastActiveAt', what),
  };
}

export function toAccessRole(value: unknown): AccessRole {
  const what = 'role';
  const dto = asRecord(value, what);
  return {
    code: readString(dto, 'code', what),
    label: readString(dto, 'label', what),
    baseRole: readOptionalString(dto, 'baseRole', what),
    system: readBoolean(dto, 'system', what),
    members: readNumber(dto, 'members', what),
    activeMembers: readNumber(dto, 'activeMembers', what),
    inMatrix: readBoolean(dto, 'inMatrix', what),
  };
}

function toMatrixState(value: unknown, updatedBy: string): PermissionMatrixState {
  const what = 'permission matrix';
  const dto = asRecord(value, what);
  asRecord(dto.matrix, `${what}.matrix`);
  return {
    matrix: normalizePermissionMatrix(dto.matrix),
    revision: readNumber(dto, 'revision', what),
    updatedAt: readString(dto, 'updatedAt', what),
    updatedBy,
  };
}

function readRole(dto: Record<string, unknown>, what: string): PlatformRole {
  const role = readString(dto, 'role', what);
  if (!(PLATFORM_ROLES as readonly string[]).includes(role))
    throw malformedResponse(`${what}.role`);
  return role as PlatformRole;
}

function readCapability(id: unknown, what: string): CapabilityMeta {
  const capability = typeof id === 'string' ? findCapability(id) : undefined;
  if (capability === undefined) throw malformedResponse(what);
  return capability;
}

function toMatrixChange(value: unknown): PermissionChange {
  const what = 'matrix change';
  const dto = asRecord(value, what);
  return {
    role: readRole(dto, what),
    capability: readCapability(dto.capability, `${what}.capability`),
    next: readBoolean(dto, 'next', what),
  };
}

export function toMatrixPreview(value: unknown): MatrixPreview {
  const what = 'matrix preview';
  const dto = asRecord(value, what);
  return {
    changes: readArray(dto, 'changes', what).map(toMatrixChange),
    roles: readArray(dto, 'roles', what).map((entry) => {
      const role = asRecord(entry, `${what}.roles`);
      return {
        role: readRole(role, `${what}.roles`),
        grants: readNumber(role, 'grants', `${what}.roles`),
        revokes: readNumber(role, 'revokes', `${what}.roles`),
        users: readNumber(role, 'activeUsers', `${what}.roles`),
      };
    }),
    users: readNumber(dto, 'affectedUsers', what),
    phiGrants: readArray(dto, 'phiGrants', what).map(toMatrixChange),
    orphaned: readArray(dto, 'orphaned', what).map((id) => readCapability(id, `${what}.orphaned`)),
  };
}

async function editorName(handle: string | null): Promise<string> {
  if (handle === null) return BASELINE;
  try {
    const user = toAccessUser(
      readData(await apiClient.get(`/admin/users/${encodeURIComponent(handle)}`), 'platform user'),
    );
    return user.name;
  } catch {
    return handle;
  }
}

async function readMatrix(value: unknown): Promise<PermissionMatrixState> {
  const dto = asRecord(value, 'permission matrix');
  return toMatrixState(
    dto,
    await editorName(readOptionalString(dto, 'updatedBy', 'permission matrix')),
  );
}

/** The conflict body of a stale-revision 409, or null for any other 409. */
function conflictCurrent(detail: string): unknown {
  try {
    const parsed: unknown = JSON.parse(detail);
    if (typeof parsed !== 'object' || parsed === null || !('current' in parsed)) return null;
    return parsed.current;
  } catch {
    return null;
  }
}

export const httpAccessService: AccessService = {
  capabilities: { resetMatrix: false },

  async listUsers({ search, role }) {
    const items = await fetchAllPages(
      (page, pageSize) =>
        apiClient.get('/admin/users', {
          q: search.trim(),
          role: role === 'all' ? undefined : role,
          page,
          pageSize,
        }),
      'platform users',
    );
    return items.map(toAccessUser);
  },

  async updateUser(id, changes) {
    return toAccessUser(
      readData(
        await apiClient.patch(`/admin/users/${encodeURIComponent(id)}`, changes),
        'platform user',
      ),
    );
  },

  async getMatrix() {
    return readMatrix(readData(await apiClient.get('/roles/matrix'), 'permission matrix'));
  },

  async listRoles() {
    const roles = readData(await apiClient.get('/roles'), 'roles');
    if (!Array.isArray(roles)) throw malformedResponse('roles');
    return (roles as readonly unknown[]).map(toAccessRole);
  },

  async createRole({ code, label, baseRole }) {
    return toAccessRole(
      readData(await apiClient.post('/roles', { code, label, baseRole }), 'role'),
    );
  },

  async roleCounts() {
    const roles = readData(await apiClient.get('/roles'), 'roles');
    if (!Array.isArray(roles)) throw malformedResponse('roles');
    const counts = Object.fromEntries(PLATFORM_ROLES.map((role) => [role, 0])) as Record<
      PlatformRole,
      number
    >;
    for (const entry of roles as readonly unknown[]) {
      const role = asRecord(entry, 'role');
      const code = readString(role, 'code', 'role');
      if ((PLATFORM_ROLES as readonly string[]).includes(code)) {
        counts[code as PlatformRole] = readNumber(role, 'activeMembers', 'role');
      }
    }
    return counts satisfies RoleCounts;
  },

  async previewMatrix(matrix) {
    return toMatrixPreview(
      readData(await apiClient.post('/roles/matrix/preview', { grid: matrix }), 'matrix preview'),
    );
  },

  async saveMatrix({ matrix, baseRevision }) {
    try {
      return await readMatrix(
        readData(
          await apiClient.put('/roles/matrix', {
            grid: matrix,
            revision: baseRevision,
            confirm: true,
          }),
          'permission matrix',
        ),
      );
    } catch (error) {
      if (isApiError(error) && error.kind === 'conflict') {
        const current = conflictCurrent(error.detail);
        if (current !== null) throw new PermissionConflictError(await readMatrix(current));
      }
      throw error;
    }
  },

  resetMatrix: () => Promise.reject(notConnected('Resetting the permission matrix')),

  async invite({ email, role }) {
    const dto = asRecord(
      readData(
        await apiClient.post('/auth/admin-invitations', { email: email.trim(), role }),
        'invitation',
      ),
      'invitation',
    );
    return {
      email: readString(dto, 'email', 'invitation'),
      role: readString(dto, 'role', 'invitation'),
      expiresAt: readString(dto, 'expiresAt', 'invitation'),
    };
  },
};
