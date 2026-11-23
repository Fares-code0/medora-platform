import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryPermissionCache } from './in-memory-permission-cache';
import { PermissionResolver } from './permission-resolver.service';
import { ADMIN_DENIED_PHI, ADMIN_ONLY } from './authz-policy';
import { SEEDED_MATRIX } from './permission-catalogue';
import {
  NO_OVERRIDES,
  type PermissionCache,
  type PermissionOverrides,
  type PlatformRole,
  type Principal,
  type RoleRepository,
} from './authz.types';

function principal(roleCode: PlatformRole, userId = 'u-1', authzVersion = 0): Principal {
  return { userId, roleCode, authzVersion };
}

/** The seeded bundle as the server policy overlay leaves it (§2.1: no admin PHI). */
function effectiveSeed(role: PlatformRole): readonly string[] {
  return SEEDED_MATRIX[role].filter(
    (capability) => role !== 'admin' || !ADMIN_DENIED_PHI.includes(capability),
  );
}

/** A repository whose matrix and overrides the test controls. */
class StubRoleRepository implements RoleRepository {
  matrix: unknown = SEEDED_MATRIX;
  overrides = new Map<string, PermissionOverrides>();
  members = new Map<PlatformRole, readonly string[]>();
  overridesError: Error | undefined;

  currentMatrix(): Promise<unknown> {
    return Promise.resolve(this.matrix);
  }

  overridesFor(userId: string): Promise<PermissionOverrides> {
    if (this.overridesError !== undefined) return Promise.reject(this.overridesError);

    return Promise.resolve(this.overrides.get(userId) ?? NO_OVERRIDES);
  }

  userIdsWithRole(role: PlatformRole): Promise<readonly string[]> {
    return Promise.resolve(this.members.get(role) ?? []);
  }

  baseRoleCodeOf(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

describe('PermissionResolver — the role bundle', () => {
  let roles: StubRoleRepository;
  let cache: InMemoryPermissionCache;
  let resolver: PermissionResolver;

  beforeEach(() => {
    roles = new StubRoleRepository();
    cache = new InMemoryPermissionCache();
    resolver = new PermissionResolver(roles, cache);
  });

  it('gives each role its seeded bundle, capped by the server policy, when nothing overrides', async () => {
    for (const role of ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy'] as const) {
      expect(await resolver.permissionsFor(principal(role, `u-${role}`))).toEqual(
        effectiveSeed(role),
      );
    }
  });

  it('never gives admin a standing PHI capability, though the seed lists two (§2.1)', async () => {
    const held = await resolver.permissionsFor(principal('admin', 'u-admin'));

    expect(SEEDED_MATRIX.admin).toContain('patients.revealIdentity');
    for (const capability of ADMIN_DENIED_PHI) expect(held).not.toContain(capability);
  });

  it('answers can() from the bundle', async () => {
    expect(await resolver.can(principal('doctor'), 'prescriptions.create')).toBe(true);
    expect(await resolver.can(principal('doctor'), 'logs.view')).toBe(false);
    expect(await resolver.can(principal('admin', 'u-2'), 'roles.manage')).toBe(true);
    expect(await resolver.can(principal('admin', 'u-2'), 'ai.use')).toBe(false);
  });

  it('requires every capability in canAll', async () => {
    const doctor = principal('doctor');

    expect(await resolver.canAll(doctor, ['patients.view', 'records.view'])).toBe(true);
    expect(await resolver.canAll(doctor, ['patients.view', 'logs.view'])).toBe(false);
    expect(await resolver.canAll(doctor, [])).toBe(true);
  });

  it('repairs a junk matrix rather than failing open or closed', async () => {
    roles.matrix = { doctor: ['patients.view', 'nonsense', 17] };

    const held = await resolver.permissionsFor(principal('doctor'));

    expect(held).toContain('patients.view');
    expect(held).not.toContain('nonsense');
    // The omitted roles fall back to their seed rather than to nothing.
    expect(await resolver.permissionsFor(principal('admin', 'u-a'))).toEqual(effectiveSeed('admin'));
  });
});

describe('PermissionResolver — per-user overrides', () => {
  let roles: StubRoleRepository;
  let resolver: PermissionResolver;

  beforeEach(() => {
    roles = new StubRoleRepository();
    resolver = new PermissionResolver(roles, new InMemoryPermissionCache());
  });

  it('adds a granted capability the role does not carry, inside its ceiling', async () => {
    roles.overrides.set('u-1', { granted: ['appointments.reassign'], revoked: [] });

    expect(await resolver.can(principal('doctor'), 'appointments.reassign')).toBe(true);
  });

  it('never lets an override give a non-admin platform administration (§2.4, §2.8)', async () => {
    roles.overrides.set('u-1', { granted: [...ADMIN_ONLY], revoked: [] });

    for (const capability of ADMIN_ONLY) {
      expect(await resolver.can(principal('doctor'), capability), capability).toBe(false);
      expect(await resolver.can(principal('pharmacy'), capability), capability).toBe(false);
    }
  });

  it('never lets an override give admin standing PHI access (§2.1)', async () => {
    roles.overrides.set('u-9', { granted: [...ADMIN_DENIED_PHI], revoked: [] });

    for (const capability of ADMIN_DENIED_PHI) {
      expect(await resolver.can(principal('admin', 'u-9'), capability), capability).toBe(false);
    }
  });

  it('removes a revoked capability the role does carry', async () => {
    roles.overrides.set('u-1', { granted: [], revoked: ['prescriptions.create'] });

    expect(await resolver.can(principal('doctor'), 'prescriptions.create')).toBe(false);
  });

  it('applies revocation after grant when an override says both', async () => {
    roles.overrides.set('u-1', { granted: ['logs.view'], revoked: ['logs.view'] });

    expect(await resolver.can(principal('doctor'), 'logs.view')).toBe(false);
  });

  it('reports the bundle and the overrides alongside the result', async () => {
    roles.overrides.set('u-1', { granted: ['appointments.reassign'], revoked: ['ai.use'] });

    const resolved = await resolver.effectivePermissions(principal('doctor'));

    expect(resolved.fromRole).toEqual(SEEDED_MATRIX.doctor);
    expect(resolved.overrides.granted).toEqual(['appointments.reassign']);
    expect(resolved.permissions).toContain('appointments.reassign');
    expect(resolved.permissions).not.toContain('ai.use');
  });

  it('returns permissions in catalogue order', async () => {
    roles.overrides.set('u-1', {
      granted: ['communications.resolveFlags', 'appointments.reassign'],
      revoked: [],
    });

    const held = await resolver.permissionsFor(principal('doctor'));

    // Catalogue order: Scheduling before Communication.
    expect(held.indexOf('appointments.reassign')).toBeLessThan(
      held.indexOf('communications.resolveFlags'),
    );
  });
});

describe('PermissionResolver — an override cannot beat a lock', () => {
  // The most important behaviour in this file. Locks are enforced on
  // PUT /roles/matrix (§15.3); if a user_permissions row could move the
  // same cell, §15.5 would be a way around §15.3 and the lock would be
  // decorative.
  let roles: StubRoleRepository;
  let resolver: PermissionResolver;

  beforeEach(() => {
    roles = new StubRoleRepository();
    resolver = new PermissionResolver(roles, new InMemoryPermissionCache());
  });

  it('refuses to grant a locked-off capability', async () => {
    roles.overrides.set('u-1', { granted: ['roles.manage'], revoked: [] });

    expect(await resolver.can(principal('doctor'), 'roles.manage')).toBe(false);
  });

  it('refuses to revoke a locked-on capability', async () => {
    roles.overrides.set('u-1', { granted: [], revoked: ['roles.manage', 'logs.view'] });

    const admin = principal('admin');
    expect(await resolver.can(admin, 'roles.manage')).toBe(true);
    expect(await resolver.can(admin, 'logs.view')).toBe(true);
  });

  it('refuses every locked cell in the catalogue, in both directions', async () => {
    for (const role of ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy'] as const) {
      for (const capability of ['roles.manage', 'settings.manageSystem', 'logs.view'] as const) {
        const userId = `u-${role}-${capability}`;
        roles.overrides.set(userId, { granted: [capability], revoked: [capability] });

        const expected = role === 'admin';
        expect(
          await resolver.can({ userId, roleCode: role }, capability),
          `${role} × ${capability}`,
        ).toBe(expected);
      }
    }
  });

  it('still honours overrides on cells that are not locked', async () => {
    // The lock rule must not become "overrides never work".
    roles.overrides.set('u-1', { granted: ['labs.review'], revoked: [] });

    expect(await resolver.can(principal('pharmacy'), 'labs.review')).toBe(true);
  });
});

describe('PermissionResolver — caching', () => {
  let roles: StubRoleRepository;
  let cache: InMemoryPermissionCache;
  let resolver: PermissionResolver;

  beforeEach(() => {
    roles = new StubRoleRepository();
    cache = new InMemoryPermissionCache();
    resolver = new PermissionResolver(roles, cache);
  });

  it('reads the repository once and serves the rest from cache', async () => {
    const spy = vi.spyOn(roles, 'currentMatrix');

    await resolver.permissionsFor(principal('doctor'));
    await resolver.permissionsFor(principal('doctor'));
    await resolver.permissionsFor(principal('doctor'));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('caches per user, not per role', async () => {
    // Two doctors with different overrides must not share an entry.
    roles.overrides.set('u-2', { granted: [], revoked: ['prescriptions.create'] });

    expect(await resolver.can(principal('doctor', 'u-1'), 'prescriptions.create')).toBe(true);
    expect(await resolver.can(principal('doctor', 'u-2'), 'prescriptions.create')).toBe(false);
  });

  it('re-reads after forget()', async () => {
    await resolver.permissionsFor(principal('doctor'));
    roles.overrides.set('u-1', { granted: [], revoked: ['prescriptions.create'] });

    // Still cached.
    expect(await resolver.can(principal('doctor'), 'prescriptions.create')).toBe(true);

    await resolver.forget('u-1');

    expect(await resolver.can(principal('doctor'), 'prescriptions.create')).toBe(false);
  });

  it('forgetRole drops exactly the members of that role', async () => {
    roles.members.set('doctor', ['u-1', 'u-2']);
    await resolver.permissionsFor(principal('doctor', 'u-1'));
    await resolver.permissionsFor(principal('doctor', 'u-2'));
    await resolver.permissionsFor(principal('admin', 'u-3'));
    expect(cache.size).toBe(3);

    await resolver.forgetRole('doctor');

    expect(cache.size).toBe(1);
    expect(await cache.get('u-3|admin|v0')).toBeDefined();
  });

  it('never serves an entry cached under an older authz_version (A-3)', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1', 4));
    roles.overrides.set('u-1', { granted: [], revoked: ['prescriptions.create'] });

    // Same version: the cached set is still served (no change recorded).
    expect(await resolver.can(principal('doctor', 'u-1', 4), 'prescriptions.create')).toBe(true);
    // The change bumped the version: the old entry is unreachable, even
    // though nothing evicted it.
    expect(await resolver.can(principal('doctor', 'u-1', 5), 'prescriptions.create')).toBe(false);
  });

  it('never serves a set cached for another role of the same user (A-3)', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1', 0));

    // Same user and version, new role: computed afresh, never the doctor set.
    expect(await resolver.can(principal('pharmacy', 'u-1', 0), 'ai.use')).toBe(false);
    expect(await resolver.can(principal('pharmacy', 'u-1', 0), 'records.view')).toBe(false);
  });

  it('bypasses the cache for a principal without a version', async () => {
    const spy = vi.spyOn(roles, 'currentMatrix');
    const unversioned: Principal = { userId: 'u-1', roleCode: 'doctor' };

    await resolver.permissionsFor(unversioned);
    await resolver.permissionsFor(unversioned);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });

  it('forgetAll empties the cache', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1'));
    await resolver.permissionsFor(principal('admin', 'u-2'));

    await resolver.forgetAll();

    expect(cache.size).toBe(0);
  });
});

describe('PermissionResolver — failure modes', () => {
  // The asymmetry here is the design: an unavailable cache must not deny,
  // and an unavailable override read must not allow.
  const failingCache: PermissionCache = {
    get: () => Promise.reject(new Error('redis down')),
    set: () => Promise.reject(new Error('redis down')),
    forget: () => Promise.reject(new Error('redis down')),
    forgetMany: () => Promise.reject(new Error('redis down')),
    clear: () => Promise.reject(new Error('redis down')),
  };

  it('resolves from the repository when the cache is unavailable', async () => {
    const resolver = new PermissionResolver(new StubRoleRepository(), failingCache);

    expect(await resolver.permissionsFor(principal('doctor'))).toEqual(SEEDED_MATRIX.doctor);
  });

  it('does not throw when an invalidation fails', async () => {
    // The permission change already committed; failing the request would
    // invite a retry of a write that has happened.
    const resolver = new PermissionResolver(new StubRoleRepository(), failingCache);

    await expect(resolver.forget('u-1')).resolves.toBeUndefined();
    await expect(resolver.forgetRole('doctor')).resolves.toBeUndefined();
    await expect(resolver.forgetAll()).resolves.toBeUndefined();
  });

  it('fails closed when overrides cannot be read', async () => {
    // Not knowing what was revoked is not the same as nothing being
    // revoked. Falling back to the bundle would restore a capability
    // somebody deliberately removed.
    const roles = new StubRoleRepository();
    roles.overridesError = new Error('database down');
    const resolver = new PermissionResolver(roles, new InMemoryPermissionCache());

    await expect(resolver.permissionsFor(principal('doctor'))).rejects.toThrow('database down');
  });
});

describe('PermissionResolver — a role with no matrix column', () => {
  // `nurse` exists in the `roles` table and has no column in the matrix
  // (ADR-017 §6). It can authenticate, so authorization is asked about
  // it, and the honest answer is "nothing" — not a crash, and not a
  // rejection of a user the database considers valid.
  let roles: StubRoleRepository;
  let resolver: PermissionResolver;

  beforeEach(() => {
    roles = new StubRoleRepository();
    resolver = new PermissionResolver(roles, new InMemoryPermissionCache());
  });

  it('resolves to an empty bundle rather than throwing', async () => {
    const nurse: Principal = { userId: 'u-n', roleCode: 'nurse' };

    expect(await resolver.permissionsFor(nurse)).toEqual([]);
    expect(await resolver.can(nurse, 'patients.view')).toBe(false);
  });

  it('does not inherit any locked-on cell', async () => {
    // The failure this guards against: applying admin's locks to a role
    // the matrix does not describe would hand a nurse `roles.manage`.
    const nurse: Principal = { userId: 'u-n', roleCode: 'nurse' };

    expect(await resolver.can(nurse, 'roles.manage')).toBe(false);
    expect(await resolver.can(nurse, 'logs.view')).toBe(false);
  });

  it('still honours an explicit override granted to it', async () => {
    roles.overrides.set('u-n', { granted: ['patients.view'], revoked: [] });

    expect(await resolver.permissionsFor({ userId: 'u-n', roleCode: 'nurse' })).toEqual([
      'patients.view',
    ]);
  });
});
