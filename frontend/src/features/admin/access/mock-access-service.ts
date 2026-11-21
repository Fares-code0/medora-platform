import { adminSettingsApi } from '../api/admin-settings.api';
import {
  localMatrixPreview,
  PLATFORM_ROLE_LABEL,
  PLATFORM_ROLES,
  type PlatformRole,
} from '../permissions';

import type { AccessRole, AccessService, RoleCounts } from './access-service';
import { normalizeRoleCode, validateRoleDraft } from './role-rules';

/** Invitations lapse after 72 hours (ADR-035 §5's TTL). */
const INVITATION_TTL_MS = 72 * 3_600_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlatformRole(value: string): value is PlatformRole {
  return (PLATFORM_ROLES as readonly string[]).includes(value);
}

/**
 * Custom roles created in the demo, for this tab only — like the other
 * clinic writes that hold nothing worth keeping across sessions. No demo
 * account holds one, so none has members.
 */
let customRoles: AccessRole[] = [];

/** Test-only reset so suites do not leak demo roles into each other. */
export function __resetMockCustomRoles(): void {
  customRoles = [];
}

/**
 * The demo adapter: users and the matrix live in the seeded settings
 * document, as they always have. An invitation is checked and confirmed
 * but goes nowhere — there is no inbox behind a demo.
 */
export const mockAccessService: AccessService = {
  capabilities: { resetMatrix: true },

  async listUsers({ search, role }) {
    const { users } = await adminSettingsApi.getSettings();
    const term = search.trim().toLowerCase();
    return users.filter(
      (user) =>
        (role === 'all' || user.role === role) &&
        (term.length === 0 || `${user.name} ${user.email}`.toLowerCase().includes(term)),
    );
  },

  async updateUser(id, changes) {
    if (changes.role !== undefined && !isPlatformRole(changes.role)) {
      throw new Error('That role does not exist.');
    }
    const document = await adminSettingsApi.updateUser(id, {
      ...(changes.role === undefined ? {} : { role: changes.role }),
      ...(changes.active === undefined ? {} : { active: changes.active }),
    });
    const updated = document.users.find((user) => user.id === id);
    if (updated === undefined) throw new Error('That account is no longer on the platform.');
    return updated;
  },

  getMatrix: async () => (await adminSettingsApi.getSettings()).permissions,

  async roleCounts() {
    const { users } = await adminSettingsApi.getSettings();
    return Object.fromEntries(
      PLATFORM_ROLES.map((role) => [
        role,
        users.filter((user) => user.role === role && user.active).length,
      ]),
    ) as RoleCounts;
  },

  async previewMatrix(matrix) {
    const [stored, counts] = await Promise.all([
      mockAccessService.getMatrix(),
      mockAccessService.roleCounts(),
    ]);
    return localMatrixPreview(stored.matrix, matrix, counts);
  },

  saveMatrix: async (input) => (await adminSettingsApi.savePermissions(input)).permissions,

  resetMatrix: async (actor) => (await adminSettingsApi.resetPermissions(actor)).permissions,

  async listRoles() {
    const { users } = await adminSettingsApi.getSettings();
    const platform: AccessRole[] = PLATFORM_ROLES.map((role) => ({
      code: role,
      label: PLATFORM_ROLE_LABEL[role],
      baseRole: null,
      system: true,
      members: users.filter((user) => user.role === role).length,
      activeMembers: users.filter((user) => user.role === role && user.active).length,
      inMatrix: true,
    }));
    return [...platform, ...customRoles];
  },

  createRole(input) {
    const existing = [...PLATFORM_ROLES, ...customRoles.map((role) => role.code)];
    const errors = validateRoleDraft(input, existing);
    const first = errors.code ?? errors.label ?? errors.baseRole;
    if (first !== undefined) return Promise.reject(new Error(first));
    const role: AccessRole = {
      code: normalizeRoleCode(input.code),
      label: input.label.trim(),
      baseRole: input.baseRole,
      system: false,
      members: 0,
      activeMembers: 0,
      inMatrix: false,
    };
    customRoles = [...customRoles, role];
    return Promise.resolve(role);
  },

  async invite({ email, role }) {
    const address = email.trim().toLowerCase();
    if (!EMAIL.test(address)) throw new Error('Enter a valid email address.');
    const { users } = await adminSettingsApi.getSettings();
    if (users.some((user) => user.email.toLowerCase() === address)) {
      throw new Error('An account with this email already exists.');
    }
    return {
      email: address,
      role,
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
    };
  },
};
