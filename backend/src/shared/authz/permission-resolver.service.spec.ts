import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryPermissionCache } from './in-memory-permission-cache';
import { PermissionResolver } from './permission-resolver.service';
import { SEEDED_MATRIX } from './permission-catalogue';
import {
  NO_OVERRIDES,
  type PermissionCache,
  type PermissionOverrides,
  type PlatformRole,
  type Principal,
  type RoleRepository,
} from './authz.types';

/** Version 1 by default, so the caching cases exercise the cache (G4). */
function principal(roleCode: PlatformRole, userId = 'u-1', permissionVersion = 1): Principal {
  return { userId, roleCode, permissionVersion };
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

  it('gives each role exactly its seeded bundle when nothing overrides', async () => {
    for (const role of ['admin', 'doctor', 'reception', 'laboratory', 'pharmacy'] as const) {
      expect(await resolver.permissionsFor(principal(role, `u-${role}`))).toEqual(
        SEEDED_MATRIX[role],
      );
    }
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
    expect(await resolver.permissionsFor(principal('admin', 'u-a'))).toEqual(SEEDED_MATRIX.admin);
  });
});

describe('PermissionResolver — per-user overrides', () => {
  let roles: StubRoleRepository;
  let resolver: PermissionResolver;

  beforeEach(() => {
    roles = new StubRoleRepository();
    resolver = new PermissionResolver(roles, new InMemoryPermissionCache());
  });

  it('adds a granted capability the role does not carry', async () => {
    roles.overrides.set('u-1', { granted: ['logs.view'], revoked: [] });

    expect(await resolver.can(principal('doctor'), 'logs.view')).toBe(true);
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
    roles.overrides.set('u-1', { granted: ['logs.view'], revoked: ['ai.use'] });

    const resolved = await resolver.effectivePermissions(principal('doctor'));

    expect(resolved.fromRole).toEqual(SEEDED_MATRIX.doctor);
    expect(resolved.overrides.granted).toEqual(['logs.view']);
    expect(resolved.permissions).toContain('logs.view');
    expect(resolved.permissions).not.toContain('ai.use');
  });

  it('returns permissions in catalogue order', async () => {
    roles.overrides.set('u-1', { granted: ['logs.view', 'doctors.manage'], revoked: [] });

    const held = await resolver.permissionsFor(principal('doctor'));

    expect(held.indexOf('doctors.manage')).toBeLessThan(held.indexOf('logs.view'));
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
    expect(await cache.get('u-3')).toBeDefined();
  });

  it('forgetAll empties the cache', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1'));
    await resolver.permissionsFor(principal('admin', 'u-2'));

    await resolver.forgetAll();

    expect(cache.size).toBe(0);
  });
});

describe('PermissionResolver — the permission version (G4, ADR-047)', () => {
  let roles: StubRoleRepository;
  let cache: InMemoryPermissionCache;
  let resolver: PermissionResolver;

  beforeEach(() => {
    roles = new StubRoleRepository();
    cache = new InMemoryPermissionCache();
    resolver = new PermissionResolver(roles, cache);
  });

  it('stamps a resolved set with the version the request read', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1', 7));

    expect((await cache.get('u-1'))?.version).toBe(7);
  });

  it('never uses an entry stamped with an older version, even without invalidation', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1', 1));
    // The change commits and bumps the version; no forget() reaches the cache.
    roles.overrides.set('u-1', { granted: [], revoked: ['prescriptions.create'] });

    expect(await resolver.can(principal('doctor', 'u-1', 1), 'prescriptions.create')).toBe(true);
    expect(await resolver.can(principal('doctor', 'u-1', 2), 'prescriptions.create')).toBe(false);
    expect((await cache.get('u-1'))?.version).toBe(2);
  });

  it('a grant applies at the next version without invalidation', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1', 1));
    roles.overrides.set('u-1', { granted: ['logs.view'], revoked: [] });

    expect(await resolver.can(principal('doctor', 'u-1', 2), 'logs.view')).toBe(true);
  });

  it('a planted entry under a different version grants nothing', async () => {
    await cache.set('u-1', { version: 4, permissions: ['roles.manage', 'logs.view'] });

    expect(await resolver.can(principal('doctor', 'u-1', 5), 'logs.view')).toBe(false);
  });

  it('a principal with no version never reads the cache', async () => {
    await cache.set('u-1', { version: 1, permissions: ['logs.view'] });
    const get = vi.spyOn(cache, 'get');

    const held = await resolver.permissionsFor({ userId: 'u-1', roleCode: 'doctor' });

    expect(held).toEqual(SEEDED_MATRIX.doctor);
    expect(get).not.toHaveBeenCalled();
  });

  it('a failed invalidation fails closed: the old entry is not used at the new version', async () => {
    const failingForget = new InMemoryPermissionCache();
    failingForget.forget = () => Promise.reject(new Error('redis down'));
    const guarded = new PermissionResolver(roles, failingForget);

    await guarded.permissionsFor(principal('doctor', 'u-1', 1));
    roles.overrides.set('u-1', { granted: [], revoked: ['patients.view'] });
    await expect(guarded.forget('u-1')).resolves.toBeUndefined();

    expect(await guarded.can(principal('doctor', 'u-1', 2), 'patients.view')).toBe(false);
  });

  it('a failed re-resolution on a version mismatch is refused, not served from cache', async () => {
    await resolver.permissionsFor(principal('doctor', 'u-1', 1));
    roles.overridesError = new Error('database down');

    await expect(resolver.can(principal('doctor', 'u-1', 2), 'patients.view')).rejects.toThrow(
      'database down',
    );
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
