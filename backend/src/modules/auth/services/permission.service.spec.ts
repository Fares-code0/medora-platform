/**
 * The token's permission claim is the guard's own computation (RM M6.2 +
 * M7.1, multi-hospital §2.8).
 *
 * `PermissionService` used to resolve the claim with its own queries, and
 * for custom roles it disagreed with `PermissionResolver` (audit A-8). It now
 * delegates to the resolver, so every invariant below — locks survive
 * `user_permissions`, the server policy overlay caps every role — holds for
 * the claim exactly as it does for enforcement. The repository is stubbed:
 * the behaviour under test is the set algebra, not the two queries.
 */

import { describe, expect, it } from 'vitest';

import {
  ADMIN_DENIED_PHI,
  ADMIN_ONLY,
  NO_OVERRIDES,
  PermissionResolver,
  type PermissionCache,
  SEEDED_MATRIX,
  type Permission,
  type PermissionOverrides,
  type RoleRepository,
} from '../../../shared/authz';
import { PermissionService } from './permission.service';

function serviceWith(
  overrides: PermissionOverrides = NO_OVERRIDES,
  stored: Record<string, readonly string[]> = { ...SEEDED_MATRIX },
  baseRoles: Record<string, string> = {},
): PermissionService {
  const roles: RoleRepository = {
    currentMatrix: () => Promise.resolve(stored),
    overridesFor: () => Promise.resolve(overrides),
    userIdsWithRole: () => Promise.resolve([]),
    baseRoleCodeOf: (code) => Promise.resolve(baseRoles[code] ?? null),
    standingOf: () => Promise.resolve('clinical'),
  };
  // No caching: every call reads through, which is what the set algebra
  // under test needs.
  const cache: PermissionCache = {
    get: () => Promise.resolve(undefined),
    set: () => Promise.resolve(),
    forget: () => Promise.resolve(),
    forgetMany: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  };
  return new PermissionService(new PermissionResolver(roles, cache));
}

const grant = (...granted: Permission[]): PermissionOverrides => ({ granted, revoked: [] });
const revoke = (...revoked: Permission[]): PermissionOverrides => ({ granted: [], revoked });

describe('PermissionService — the claim is the enforced set', () => {
  it('returns the role bundle, sorted, when nothing overrides', async () => {
    expect(await serviceWith().resolve('u-1', 'role-doctor', 'doctor')).toEqual(
      [...SEEDED_MATRIX.doctor].sort(),
    );
  });

  it('adds an allowed override inside the ceiling', async () => {
    expect(
      await serviceWith(grant('appointments.cancelAdministratively')).resolve('u-1', 'r', 'reception'),
    ).toContain('appointments.cancelAdministratively');
  });

  it('removes a denied override the bundle carries', async () => {
    expect(
      await serviceWith(revoke('prescriptions.create')).resolve('u-1', 'r', 'doctor'),
    ).not.toContain('prescriptions.create');
  });

  it('refuses to put a locked-off or admin-only capability in a doctor token', async () => {
    const claim = await serviceWith(grant('roles.manage', 'logs.view')).resolve(
      'u-1',
      'r',
      'doctor',
    );
    expect(claim).not.toContain('roles.manage');
    expect(claim).not.toContain('logs.view');
  });

  it('refuses to take a locked-on capability out of an admin token', async () => {
    expect(await serviceWith(revoke('roles.manage')).resolve('u-1', 'r', 'admin')).toContain(
      'roles.manage',
    );
  });

  it('never puts a PHI capability in an admin token (§2.1)', async () => {
    const claim = await serviceWith(grant(...ADMIN_DENIED_PHI)).resolve('u-1', 'r', 'admin');
    for (const capability of ADMIN_DENIED_PHI) expect(claim).not.toContain(capability);
  });

  it('drops a stored code the 22-capability union does not contain', async () => {
    const claim = await serviceWith(NO_OVERRIDES, {
      ...SEEDED_MATRIX,
      doctor: [...SEEDED_MATRIX.doctor, 'made.up'],
    }).resolve('u-1', 'r', 'doctor');
    expect(claim).not.toContain('made.up');
  });

  it('caps nurse by its category ceiling, whatever it was granted', async () => {
    const claim = await serviceWith(grant('patients.view', 'roles.manage', 'records.edit'), {
      ...SEEDED_MATRIX,
      nurse: [],
    }).resolve('u-1', 'r', 'nurse');
    expect(claim).toEqual(['patients.view']);
  });

  it('resolves a nurse with no grants to nothing at all', async () => {
    expect(
      await serviceWith(NO_OVERRIDES, { ...SEEDED_MATRIX, nurse: [] }).resolve('u-1', 'r', 'nurse'),
    ).toEqual([]);
  });

  it('resolves a custom role from its own grants, capped by its base category (A-8)', async () => {
    const claim = await serviceWith(
      NO_OVERRIDES,
      {
        ...SEEDED_MATRIX,
        'ward-clerk': ['patients.view', 'appointments.reassign', 'roles.manage'],
      },
      { 'ward-clerk': 'reception' },
    ).resolve('u-1', 'r', 'ward-clerk');
    expect(claim).toEqual(['appointments.reassign', 'patients.view']);
  });

  it('gives a custom role derived from admin nothing (§2.8)', async () => {
    const claim = await serviceWith(
      grant(...ADMIN_ONLY),
      { ...SEEDED_MATRIX, 'shadow-admin': [...ADMIN_ONLY] },
      { 'shadow-admin': 'admin' },
    ).resolve('u-1', 'r', 'shadow-admin');
    expect(claim).toEqual([]);
  });
});
