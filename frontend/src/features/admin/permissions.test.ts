import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PERMISSION_MATRIX,
  diffMatrix,
  localMatrixPreview,
  lockOf,
  normalizePermissionMatrix,
  normalizePermissionState,
  orphanedCapabilities,
  PERMISSION_CAPABILITIES,
  PLATFORM_ROLES,
  previewAffected,
  setCapability,
  type PermissionMatrix,
  type RoleHolder,
} from './permissions';

/**
 * The permission matrix's rules (ADM-09).
 *
 * The editor is a thin shell over these functions, so the safety guarantees
 * are pinned here rather than through the DOM: a locked cell cannot move by
 * any route, a repaired matrix is always valid, and the affected-user preview
 * counts what an administrator is about to change — not more.
 */

const holders: readonly RoleHolder[] = [
  { id: 'a1', role: 'admin', active: true },
  { id: 'd1', role: 'doctor', active: true },
  { id: 'd2', role: 'doctor', active: true },
  { id: 'd3', role: 'doctor', active: false },
  { id: 'r1', role: 'reception', active: true },
];

describe('capability catalog', () => {
  it('has no duplicate capability ids', () => {
    const ids = PERMISSION_CAPABILITIES.map((capability) => capability.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('seeds a baseline in which every capability is held by someone', () => {
    expect(orphanedCapabilities(DEFAULT_PERMISSION_MATRIX)).toEqual([]);
  });

  it('never marks a cell both locked-on and locked-off', () => {
    for (const capability of PERMISSION_CAPABILITIES) {
      for (const role of PLATFORM_ROLES) {
        const bothWays =
          (capability.lockedOn?.includes(role) ?? false) &&
          (capability.lockedOff?.includes(role) ?? false);
        expect(bothWays).toBe(false);
      }
    }
  });
});

describe('setCapability', () => {
  it('grants and revokes an unlocked cell', () => {
    const granted = setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true);
    expect(granted.pharmacy).toContain('labs.review');

    const revoked = setCapability(granted, 'pharmacy', 'labs.review', false);
    expect(revoked.pharmacy).not.toContain('labs.review');
  });

  it('refuses to revoke a locked-on cell even when called directly', () => {
    const next = setCapability(DEFAULT_PERMISSION_MATRIX, 'admin', 'roles.manage', false);

    expect(next.admin).toContain('roles.manage');
    expect(next).toBe(DEFAULT_PERMISSION_MATRIX);
  });

  it('refuses to grant a locked-off cell even when called directly', () => {
    const next = setCapability(
      DEFAULT_PERMISSION_MATRIX,
      'reception',
      'prescriptions.create',
      true,
    );

    expect(next.reception).not.toContain('prescriptions.create');
  });

  it('leaves other roles untouched', () => {
    const next = setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true);

    expect(next.doctor).toEqual(DEFAULT_PERMISSION_MATRIX.doctor);
    expect(next.admin).toEqual(DEFAULT_PERMISSION_MATRIX.admin);
  });
});

describe('lockOf', () => {
  it('locks the matrix editor itself on for administrators', () => {
    const lock = lockOf('roles.manage', 'admin');

    expect(lock?.value).toBe(true);
    expect(lock?.reason).toContain('administrators');
  });

  it('locks it off for every other role', () => {
    expect(lockOf('roles.manage', 'doctor')?.value).toBe(false);
    expect(lockOf('roles.manage', 'pharmacy')?.value).toBe(false);
  });

  it('stops a doctor holding their own verification decision', () => {
    expect(lockOf('doctors.verify', 'doctor')?.value).toBe(false);
    expect(lockOf('doctors.verify', 'admin')).toBeNull();
  });

  it('returns null for a cell an administrator may move', () => {
    expect(lockOf('labs.review', 'pharmacy')).toBeNull();
  });
});

describe('orphanedCapabilities', () => {
  it('reports a capability no role would hold', () => {
    let matrix: PermissionMatrix = DEFAULT_PERMISSION_MATRIX;
    for (const role of PLATFORM_ROLES) {
      matrix = setCapability(matrix, role, 'labs.review', false);
    }

    expect(orphanedCapabilities(matrix).map((capability) => capability.id)).toEqual([
      'labs.review',
    ]);
  });
});

describe('normalizePermissionMatrix', () => {
  it('falls back to the baseline for junk', () => {
    expect(normalizePermissionMatrix(null)).toEqual(DEFAULT_PERMISSION_MATRIX);
    expect(normalizePermissionMatrix('nope')).toEqual(DEFAULT_PERMISSION_MATRIX);
  });

  it('drops capability ids that no longer exist', () => {
    const repaired = normalizePermissionMatrix({
      ...DEFAULT_PERMISSION_MATRIX,
      doctor: ['patients.view', 'records.retire'],
    });

    expect(repaired.doctor).toEqual(['patients.view']);
  });

  it('re-applies locks a stored document violates', () => {
    const repaired = normalizePermissionMatrix({
      ...DEFAULT_PERMISSION_MATRIX,
      admin: ['patients.view'],
      reception: ['prescriptions.create'],
    });

    // Locked on, so restored despite being absent from storage.
    expect(repaired.admin).toContain('roles.manage');
    expect(repaired.admin).toContain('settings.manageSystem');
    expect(repaired.admin).toContain('logs.view');
    // Locked off, so stripped despite being present in storage.
    expect(repaired.reception).not.toContain('prescriptions.create');
  });

  it('defaults a role missing from an older stored document', () => {
    const repaired = normalizePermissionMatrix({ doctor: ['patients.view'] });

    expect(repaired.pharmacy).toEqual(DEFAULT_PERMISSION_MATRIX.pharmacy);
  });
});

describe('normalizePermissionState', () => {
  it('keeps a valid revision and attribution', () => {
    const state = normalizePermissionState({
      matrix: DEFAULT_PERMISSION_MATRIX,
      revision: 7,
      updatedAt: '2026-08-01T10:00:00Z',
      updatedBy: 'Marcus Reed',
    });

    expect(state.revision).toBe(7);
    expect(state.updatedBy).toBe('Marcus Reed');
  });

  it('repairs a state whose revision is missing', () => {
    const state = normalizePermissionState({ matrix: DEFAULT_PERMISSION_MATRIX });

    expect(state.revision).toBe(1);
  });
});

describe('diffMatrix', () => {
  it('is empty for an unchanged draft', () => {
    expect(diffMatrix(DEFAULT_PERMISSION_MATRIX, DEFAULT_PERMISSION_MATRIX)).toEqual([]);
  });

  it('reports one entry per moved cell, with its direction', () => {
    const draft = setCapability(
      setCapability(DEFAULT_PERMISSION_MATRIX, 'pharmacy', 'labs.review', true),
      'doctor',
      'ai.use',
      false,
    );

    const changes = diffMatrix(DEFAULT_PERMISSION_MATRIX, draft);

    expect(changes).toHaveLength(2);
    expect(changes).toContainEqual(expect.objectContaining({ role: 'pharmacy', next: true }));
    expect(changes).toContainEqual(expect.objectContaining({ role: 'doctor', next: false }));
  });

  it('ignores the order capabilities are stored in', () => {
    const shuffled: PermissionMatrix = {
      ...DEFAULT_PERMISSION_MATRIX,
      doctor: [...DEFAULT_PERMISSION_MATRIX.doctor].reverse(),
    };

    expect(diffMatrix(DEFAULT_PERMISSION_MATRIX, shuffled)).toEqual([]);
  });
});

describe('previewAffected', () => {
  it('counts only active accounts in the changed roles', () => {
    const draft = setCapability(DEFAULT_PERMISSION_MATRIX, 'doctor', 'ai.use', false);
    const preview = previewAffected(diffMatrix(DEFAULT_PERMISSION_MATRIX, draft), holders);

    // Three doctor accounts exist, one is deactivated.
    expect(preview.users).toBe(2);
    expect(preview.roles).toEqual([{ role: 'doctor', grants: 0, revokes: 1, users: 2 }]);
  });

  it('counts an account once when its role has several changes', () => {
    let draft = setCapability(DEFAULT_PERMISSION_MATRIX, 'doctor', 'ai.use', false);
    draft = setCapability(draft, 'doctor', 'logs.export', true);
    const preview = previewAffected(diffMatrix(DEFAULT_PERMISSION_MATRIX, draft), holders);

    expect(preview.users).toBe(2);
    expect(preview.roles[0]).toMatchObject({ role: 'doctor', grants: 1, revokes: 1 });
  });

  it('surfaces PHI grants separately, and only grants', () => {
    let draft = setCapability(DEFAULT_PERMISSION_MATRIX, 'reception', 'records.view', true);
    draft = setCapability(draft, 'doctor', 'records.view', false);

    const preview = previewAffected(diffMatrix(DEFAULT_PERMISSION_MATRIX, draft), holders);

    expect(preview.phiGrants).toHaveLength(1);
    expect(preview.phiGrants[0]).toMatchObject({ role: 'reception', next: true });
  });

  it('reports nothing when there is nothing to change', () => {
    expect(previewAffected([], holders)).toEqual({ roles: [], users: 0, phiGrants: [] });
  });
});

describe('localMatrixPreview — the demo’s dry run', () => {
  const counts = { admin: 1, doctor: 5, reception: 3, laboratory: 2, pharmacy: 2 };

  it('drops a change to a locked cell, as the save would', () => {
    const proposed = {
      ...DEFAULT_PERMISSION_MATRIX,
      // Locked off for reception: the save would put it back.
      reception: [...DEFAULT_PERMISSION_MATRIX.reception, 'records.edit' as const],
    };
    expect(localMatrixPreview(DEFAULT_PERMISSION_MATRIX, proposed, counts)).toEqual({
      changes: [],
      roles: [],
      users: 0,
      phiGrants: [],
      orphaned: [],
    });
  });

  it('counts who a real change reaches and names what no role would hold', () => {
    const revoked = Object.fromEntries(
      PLATFORM_ROLES.map((role) => [
        role,
        DEFAULT_PERMISSION_MATRIX[role].filter((id) => id !== 'logs.export'),
      ]),
    ) as unknown as PermissionMatrix;
    const preview = localMatrixPreview(DEFAULT_PERMISSION_MATRIX, revoked, counts);

    const holders = PLATFORM_ROLES.filter((role) =>
      DEFAULT_PERMISSION_MATRIX[role].includes('logs.export'),
    );
    expect(preview.changes.map((change) => [change.role, change.next])).toEqual(
      holders.map((role) => [role, false]),
    );
    expect(preview.users).toBe(holders.reduce((total, role) => total + counts[role], 0));
    expect(preview.orphaned.map((capability) => capability.id)).toEqual(['logs.export']);
  });
});
