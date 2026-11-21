/**
 * Locks survive the trip through `user_permissions` (RM M6.2 + M7.1).
 *
 * `PermissionService` resolves the bundle once per token issue and the
 * result is copied into the access token, so whatever it returns is what
 * every guard sees for the next fifteen minutes. Before the lock step
 * was added, a single `user_permissions` row could put `roles.manage`
 * into a doctor's token, or take it out of the last administrator's —
 * reaching through API §15.5 exactly the state §15.3 refuses to save.
 *
 * The Prisma client is stubbed rather than hit: the behaviour under test
 * is the set algebra after the two queries, and a database would only
 * make the same assertions slower.
 */

import { describe, expect, it } from 'vitest';

import { SEEDED_MATRIX } from '../../../shared/authz';
import { PermissionService } from './permission.service';

interface Override {
  readonly code: string;
  readonly allowed: boolean;
}

/** Stands in for `PrismaService` — the two `findMany` calls, nothing else. */
function serviceWith(bundle: readonly string[], overrides: readonly Override[]): PermissionService {
  const prisma = {
    db: {
      rolePermission: {
        findMany: () => Promise.resolve(bundle.map((code) => ({ permission: { code } }))),
      },
      userPermission: {
        findMany: () =>
          Promise.resolve(
            overrides.map((o) => ({ allowed: o.allowed, permission: { code: o.code } })),
          ),
      },
    },
  };

  return new PermissionService(prisma as never);
}

describe('PermissionService — bundle plus overrides', () => {
  it('returns the role bundle when nothing overrides', async () => {
    const service = serviceWith(SEEDED_MATRIX.doctor, []);

    expect(await service.resolve('u-1', 'role-doctor', 'doctor')).toEqual(
      [...SEEDED_MATRIX.doctor].sort(),
    );
  });

  it('adds an allowed override the bundle lacks', async () => {
    const service = serviceWith(SEEDED_MATRIX.doctor, [{ code: 'logs.view', allowed: true }]);

    expect(await service.resolve('u-1', 'role-doctor', 'doctor')).toContain('logs.view');
  });

  it('removes a denied override the bundle carries', async () => {
    const service = serviceWith(SEEDED_MATRIX.doctor, [
      { code: 'prescriptions.create', allowed: false },
    ]);

    expect(await service.resolve('u-1', 'role-doctor', 'doctor')).not.toContain(
      'prescriptions.create',
    );
  });
});

describe('PermissionService — an override cannot beat a lock', () => {
  it('refuses to put a locked-off capability in a doctor token', async () => {
    // The bypass this spec exists for. `roles.manage` is locked off for
    // every role but admin.
    const service = serviceWith(SEEDED_MATRIX.doctor, [{ code: 'roles.manage', allowed: true }]);

    expect(await service.resolve('u-1', 'role-doctor', 'doctor')).not.toContain('roles.manage');
  });

  it('refuses to take a locked-on capability out of an admin token', async () => {
    // The mirror image, and the more dangerous one: it is how the
    // platform loses its last administrator.
    const service = serviceWith(SEEDED_MATRIX.admin, [
      { code: 'roles.manage', allowed: false },
      { code: 'settings.manageSystem', allowed: false },
      { code: 'logs.view', allowed: false },
    ]);
    const resolved = await service.resolve('u-1', 'role-admin', 'admin');

    expect(resolved).toContain('roles.manage');
    expect(resolved).toContain('settings.manageSystem');
    expect(resolved).toContain('logs.view');
  });

  it('still honours an override on a cell that is not locked', async () => {
    // The fix must not become "overrides never work".
    const service = serviceWith(SEEDED_MATRIX.pharmacy, [{ code: 'labs.review', allowed: true }]);

    expect(await service.resolve('u-1', 'role-pharmacy', 'pharmacy')).toContain('labs.review');
  });
});

describe('PermissionService — codes outside the union', () => {
  it('drops a stored code the 22-capability union does not contain', async () => {
    // A hand-edited row. Copying it into the token would advertise a
    // capability no guard can ever check, which reads in the matrix
    // editor as a grant that silently does nothing.
    const service = serviceWith([...SEEDED_MATRIX.doctor, 'billing.manage'], []);

    expect(await service.resolve('u-1', 'role-doctor', 'doctor')).not.toContain('billing.manage');
  });
});

describe('PermissionService — a role with no matrix column', () => {
  it('resolves nurse to whatever it was granted, with no locks applied', async () => {
    // `nurse` is seeded with an empty bundle and has no column in the
    // matrix (ADR-017 §6). It must not be emptied by the lock step, and
    // it must not gain admin's locked-on cells either.
    const service = serviceWith([], [{ code: 'patients.view', allowed: true }]);
    const resolved = await service.resolve('u-1', 'role-nurse', 'nurse');

    expect(resolved).toEqual(['patients.view']);
    expect(resolved).not.toContain('roles.manage');
  });

  it('resolves a nurse with no overrides to nothing at all', async () => {
    const service = serviceWith([], []);

    expect(await service.resolve('u-1', 'role-nurse', 'nurse')).toEqual([]);
  });
});
