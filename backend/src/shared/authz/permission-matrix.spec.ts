import { describe, expect, it } from 'vitest';

import {
  PERMISSION_CAPABILITIES,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  type PermissionMatrix,
} from './permission-catalogue';
import {
  applyLocks,
  hasCapability,
  lockOf,
  lockViolations,
  normalizeMatrix,
  orphanedCapabilities,
  setCapability,
} from './permission-matrix';

describe('normalizeMatrix', () => {
  it('leaves the seeded matrix untouched', () => {
    // A fixed point. If the platform's own baseline needed repair, every
    // read of an unedited matrix would look like a pending change.
    expect(normalizeMatrix(SEEDED_MATRIX)).toEqual(SEEDED_MATRIX);
  });

  it('is idempotent', () => {
    const once = normalizeMatrix({ doctor: ['patients.view', 'roles.manage'] });

    expect(normalizeMatrix(once)).toEqual(once);
  });

  it('drops ids that are not capabilities', () => {
    const repaired = normalizeMatrix({
      ...SEEDED_MATRIX,
      pharmacy: ['patients.view', 'billing.manage', 42, null, 'messages.send'],
    });

    expect(repaired.pharmacy).toEqual(['patients.view', 'messages.send']);
  });

  it('falls back to the seeded bundle for a role the input omits', () => {
    // Not to an empty bundle: a lost storage key would otherwise revoke
    // everything for that role while looking like a successful read.
    const repaired = normalizeMatrix({ admin: [...SEEDED_MATRIX.admin] });

    expect(repaired.doctor).toEqual(SEEDED_MATRIX.doctor);
  });

  it('repairs junk into a valid matrix', () => {
    for (const junk of [null, undefined, 'matrix', 7, [], { doctor: 'patients.view' }]) {
      const repaired = normalizeMatrix(junk);

      expect(Object.keys(repaired).sort()).toEqual([...PLATFORM_ROLES].sort());
      expect(lockViolations(repaired)).toEqual([]);
    }
  });

  it('restores catalogue order', () => {
    const repaired = normalizeMatrix({
      ...SEEDED_MATRIX,
      doctor: ['ai.use', 'patients.view', 'labs.review'],
    });
    const order = PERMISSION_CAPABILITIES.map((c) => c.id);
    const positions = repaired.doctor.map((id) => order.indexOf(id));

    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('locks', () => {
  it('forces every locked-on cell on', () => {
    // `roles.manage` off admin is the one that matters: an administrator
    // who could revoke it would lock the platform out of itself.
    const stripped = normalizeMatrix({ ...SEEDED_MATRIX, admin: ['patients.view'] });

    expect(hasCapability(stripped, 'admin', 'roles.manage')).toBe(true);
    expect(hasCapability(stripped, 'admin', 'settings.manageSystem')).toBe(true);
    expect(hasCapability(stripped, 'admin', 'logs.view')).toBe(true);
  });

  it('forces every locked-off cell off', () => {
    const overreaching = normalizeMatrix({
      ...SEEDED_MATRIX,
      pharmacy: ['roles.manage', 'records.edit', 'prescriptions.create', 'patients.view'],
    });

    expect(hasCapability(overreaching, 'pharmacy', 'roles.manage')).toBe(false);
    expect(hasCapability(overreaching, 'pharmacy', 'records.edit')).toBe(false);
    expect(hasCapability(overreaching, 'pharmacy', 'prescriptions.create')).toBe(false);
    expect(hasCapability(overreaching, 'pharmacy', 'patients.view')).toBe(true);
  });

  it('enforces every lock in the catalogue, not just the ones with a test above', () => {
    // Generated rather than transcribed: a lock added to the catalogue
    // later is covered the moment it is added.
    for (const capability of PERMISSION_CAPABILITIES) {
      for (const role of PLATFORM_ROLES) {
        const lock = lockOf(capability.id, role);
        if (lock === null) continue;

        const attempted = normalizeMatrix({
          ...SEEDED_MATRIX,
          // Try to set the cell to the opposite of what the lock fixes.
          [role]: lock.value
            ? SEEDED_MATRIX[role].filter((id) => id !== capability.id)
            : [...SEEDED_MATRIX[role], capability.id],
        });

        expect(hasCapability(attempted, role, capability.id), `${role} × ${capability.id}`).toBe(
          lock.value,
        );
      }
    }
  });

  it('reports a lock reason rather than a bare refusal', () => {
    const lock = lockOf('doctors.verify', 'doctor');

    expect(lock?.value).toBe(false);
    expect(lock?.reason).toBe('Doctors cannot sit on their own verification decisions.');
  });

  it('returns null for a cell an administrator may move', () => {
    expect(lockOf('patients.view', 'pharmacy')).toBeNull();
    expect(lockOf('labs.review', 'doctor')).toBeNull();
  });
});

describe('setCapability', () => {
  it('grants and revokes an unlocked cell', () => {
    const granted = setCapability(SEEDED_MATRIX, 'pharmacy', 'labs.review', true);
    expect(hasCapability(granted, 'pharmacy', 'labs.review')).toBe(true);

    const revoked = setCapability(granted, 'pharmacy', 'labs.review', false);
    expect(hasCapability(revoked, 'pharmacy', 'labs.review')).toBe(false);
  });

  it('refuses to move a locked cell in either direction', () => {
    expect(setCapability(SEEDED_MATRIX, 'admin', 'roles.manage', false)).toBe(SEEDED_MATRIX);
    expect(setCapability(SEEDED_MATRIX, 'doctor', 'roles.manage', true)).toBe(SEEDED_MATRIX);
    expect(setCapability(SEEDED_MATRIX, 'doctor', 'doctors.verify', true)).toBe(SEEDED_MATRIX);
  });

  it('returns the same matrix when nothing changes', () => {
    expect(setCapability(SEEDED_MATRIX, 'doctor', 'patients.view', true)).toBe(SEEDED_MATRIX);
  });

  it('keeps the result in catalogue order', () => {
    const granted = setCapability(SEEDED_MATRIX, 'pharmacy', 'labs.review', true);

    expect(granted.pharmacy).toEqual(['patients.view', 'labs.review', 'messages.send']);
  });

  it('does not mutate its input', () => {
    const before = [...SEEDED_MATRIX.pharmacy];
    setCapability(SEEDED_MATRIX, 'pharmacy', 'labs.review', true);

    expect(SEEDED_MATRIX.pharmacy).toEqual(before);
  });
});

describe('applyLocks', () => {
  it('adds locked-on and removes locked-off, whatever it is given', () => {
    const result = applyLocks('admin', ['patients.view', 'records.edit']);

    expect(result).toContain('roles.manage');
    expect(result).toContain('settings.manageSystem');
    expect(result).toContain('logs.view');
    // `records.edit` is not locked off for admin — merely not seeded —
    // so applying locks must leave the caller's grant alone.
    expect(result).toContain('records.edit');
  });

  it('strips locked-off capabilities from a role that was handed them', () => {
    const result = applyLocks('laboratory', [
      'patients.view',
      'communications.viewContent',
      'roles.manage',
    ]);

    expect(result).not.toContain('communications.viewContent');
    expect(result).not.toContain('roles.manage');
    expect(result).toContain('patients.view');
  });
});

describe('orphanedCapabilities', () => {
  it('finds nothing in the seeded matrix', () => {
    expect(orphanedCapabilities(SEEDED_MATRIX)).toEqual([]);
  });

  it('reports a capability no role holds', () => {
    const stripped: PermissionMatrix = {
      ...SEEDED_MATRIX,
      doctor: SEEDED_MATRIX.doctor.filter((id) => id !== 'ai.use'),
    };

    expect(orphanedCapabilities(stripped).map((c) => c.id)).toEqual(['ai.use']);
  });
});

describe('lockViolations', () => {
  it('is empty for the seeded matrix', () => {
    expect(lockViolations(SEEDED_MATRIX)).toEqual([]);
  });

  it('names each cell a proposal moves illegally, with its reason', () => {
    const proposed: PermissionMatrix = {
      ...SEEDED_MATRIX,
      admin: SEEDED_MATRIX.admin.filter((id) => id !== 'roles.manage'),
      doctor: [...SEEDED_MATRIX.doctor, 'doctors.verify'],
    };

    expect(lockViolations(proposed)).toEqual([
      {
        role: 'admin',
        capability: 'roles.manage',
        requested: false,
        reason: 'Only administrators may edit the permission matrix.',
      },
      {
        role: 'doctor',
        capability: 'doctors.verify',
        requested: true,
        reason: 'Doctors cannot sit on their own verification decisions.',
      },
    ]);
  });
});
