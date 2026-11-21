import { beforeEach, describe, expect, it } from 'vitest';

import { __resetMockCustomRoles, mockAccessService } from './mock-access-service';

/**
 * The demo access adapter (FE-10.10) over the seeded settings store: the
 * same filters and refusals the live API applies, so the demo build tells
 * the same story.
 */

beforeEach(() => {
  window.localStorage.clear();
});

describe('mockAccessService', () => {
  it('filters by name or email and by role', async () => {
    const all = await mockAccessService.listUsers({ search: '', role: 'all' });
    expect(all.length).toBeGreaterThan(1);

    const admins = await mockAccessService.listUsers({ search: '', role: 'admin' });
    expect(admins.every((user) => user.role === 'admin')).toBe(true);

    const marcus = await mockAccessService.listUsers({ search: 'MARCUS', role: 'all' });
    expect(marcus.map((user) => user.email)).toEqual(['admin@medora.health']);
  });

  it('answers a change with the stored row, and refuses a role it does not know', async () => {
    const [first] = await mockAccessService.listUsers({ search: 'lena', role: 'all' });
    if (first === undefined) throw new Error('seeded user missing');
    const updated = await mockAccessService.updateUser(first.id, { active: false });
    expect(updated).toMatchObject({ id: first.id, active: false });
    await expect(mockAccessService.updateUser(first.id, { role: 'wizard' })).rejects.toThrow(
      'That role does not exist.',
    );
  });

  it('counts active holders per matrix role', async () => {
    const counts = await mockAccessService.roleCounts();
    expect(Object.keys(counts)).toEqual(['admin', 'doctor', 'reception', 'laboratory', 'pharmacy']);
    expect(counts.admin).toBeGreaterThan(0);
  });

  it('checks an invitation’s address and refuses one already on the platform', async () => {
    await expect(mockAccessService.invite({ email: 'nope', role: 'reception' })).rejects.toThrow(
      'Enter a valid email address.',
    );
    await expect(
      mockAccessService.invite({ email: 'ADMIN@medora.health', role: 'admin' }),
    ).rejects.toThrow('An account with this email already exists.');
    const sent = await mockAccessService.invite({ email: 'new@medora.health', role: 'pharmacy' });
    expect(sent).toMatchObject({ email: 'new@medora.health', role: 'pharmacy' });
    expect(Date.parse(sent.expiresAt)).toBeGreaterThan(Date.now());
  });
});

describe('mockAccessService roles (API §15.1, §15.4)', () => {
  beforeEach(() => __resetMockCustomRoles());

  it('lists the five platform roles with their member counts', async () => {
    const roles = await mockAccessService.listRoles();
    expect(roles.map((role) => role.code)).toEqual([
      'admin',
      'doctor',
      'reception',
      'laboratory',
      'pharmacy',
    ]);
    for (const role of roles) {
      expect(role).toMatchObject({ system: true, baseRole: null, inMatrix: true });
      expect(role.activeMembers).toBeLessThanOrEqual(role.members);
    }
  });

  it('creates a custom role that copies a base, has no matrix column and no members', async () => {
    const created = await mockAccessService.createRole({
      code: 'Ward-Clerk',
      label: ' Ward clerk ',
      baseRole: 'reception',
    });
    expect(created).toEqual({
      code: 'ward-clerk',
      label: 'Ward clerk',
      baseRole: 'reception',
      system: false,
      members: 0,
      activeMembers: 0,
      inMatrix: false,
    });
    expect((await mockAccessService.listRoles()).at(-1)).toEqual(created);
  });

  it('refuses what the server refuses, and adds nothing', async () => {
    await expect(
      mockAccessService.createRole({ code: 'doctor', label: 'Doctor 2', baseRole: 'doctor' }),
    ).rejects.toThrow('A role with the code "doctor" already exists');
    await expect(
      mockAccessService.createRole({ code: '1x', label: 'X', baseRole: 'doctor' }),
    ).rejects.toThrow('Letters, digits, underscore and hyphen; start with a letter');
    expect(await mockAccessService.listRoles()).toHaveLength(5);
  });
});
