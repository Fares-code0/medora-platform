import { describe, expect, it } from 'vitest';

import { ROLES } from '@/types/auth';

import { isInWorkspace, WORKSPACES, workspaceFor } from './workspaces';

/**
 * The workspace table (DEC-006a). Every role has an entry, every entry's home
 * and settings lie inside its own root, and no two roots overlap — an overlap
 * would let one role's guard admit another role's paths.
 */

describe('WORKSPACES', () => {
  it('has a workspace for every role', () => {
    for (const role of ROLES) {
      expect(workspaceFor(role)).toBe(WORKSPACES[role]);
    }
  });

  it("keeps each role's home and settings inside its own root", () => {
    for (const role of ROLES) {
      const workspace = workspaceFor(role);
      expect(isInWorkspace(workspace.home, role)).toBe(true);
      expect(isInWorkspace(workspace.settings(), role)).toBe(true);
      expect(isInWorkspace(workspace.settings('security'), role)).toBe(true);
    }
  });

  it('gives no two roles overlapping roots', () => {
    for (const role of ROLES) {
      for (const other of ROLES) {
        if (other === role) continue;
        expect(isInWorkspace(workspaceFor(role).home, other)).toBe(false);
      }
    }
  });

  it('offers no practitioner profile or notifications page to the staff roles', () => {
    for (const role of ['reception', 'laboratory', 'pharmacy'] as const) {
      expect(workspaceFor(role).profile).toBeNull();
      expect(workspaceFor(role).notifications).toBeNull();
    }
  });
});

describe('isInWorkspace', () => {
  it('matches the root and paths nested under it, ignoring the query', () => {
    expect(isInWorkspace('/reception', 'reception')).toBe(true);
    expect(isInWorkspace('/reception/appointments?page=2', 'reception')).toBe(true);
  });

  it('does not match a path that merely shares a prefix', () => {
    expect(isInWorkspace('/receptionist', 'reception')).toBe(false);
    expect(isInWorkspace('/pharmacy-old', 'pharmacy')).toBe(false);
  });

  it("does not treat the doctor's pharmacy page as the pharmacy workspace", () => {
    expect(isInWorkspace('/doctor/pharmacy', 'pharmacy')).toBe(false);
    expect(isInWorkspace('/doctor/pharmacy', 'doctor')).toBe(true);
  });
});
