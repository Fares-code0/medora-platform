import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

/**
 * G4 (ADR-047) — `users.authz_version` is bumped by the database for
 * every write that can change an account's effective permissions.
 *
 * Everything here runs on rows this suite owns: two private roles, one
 * private permission code and its own accounts. The seeded roles and
 * permissions are what every other suite authorizes against, and this
 * database is shared, so they are read but never written.
 */
describe('authoritative permission version (G4, ADR-047)', () => {
  let prisma: PrismaService;

  const DOMAIN = 'permission-version.test';
  const tag = randomUUID().slice(0, 8);

  let roleA: string;
  let roleB: string;
  let permissionId: string;
  let seededPermissionId: string;
  let counter = 0;

  async function newUser(roleId: string): Promise<string> {
    counter += 1;
    const n = `${tag}_${String(counter)}`;
    const user = await prisma.user.create({
      data: {
        publicId: `usr_pv_${n}`,
        firstName: 'Version',
        lastName: 'Spec',
        displayName: 'Version Spec',
        email: `pv-${n}@${DOMAIN}`,
        phone: '+1 555 000 0000',
        roleId,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
      select: { id: true },
    });
    return user.id;
  }

  async function versionOf(userId: string): Promise<number> {
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { authzVersion: true },
    });
    return row.authzVersion;
  }

  async function versions(...userIds: string[]): Promise<number[]> {
    return Promise.all(userIds.map(versionOf));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    seededPermissionId = (
      await prisma.permission.findUniqueOrThrow({ where: { code: 'patients.view' } })
    ).id;
  });

  beforeEach(async () => {
    roleA = (
      await prisma.role.create({
        data: { code: `pv_a_${tag}`, label: 'PV role A', isSystem: false },
      })
    ).id;
    roleB = (
      await prisma.role.create({
        data: { code: `pv_b_${tag}`, label: 'PV role B', isSystem: false },
      })
    ).id;
    permissionId = (
      await prisma.permission.create({
        data: { code: `pv.spec.${tag}`, domain: 'Administration' },
      })
    ).id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.permission.deleteMany({ where: { code: { startsWith: 'pv.spec.' } } });
    await prisma.role.deleteMany({ where: { code: { in: [`pv_a_${tag}`, `pv_b_${tag}`] } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('starts every account at version 0 (PR #61 default; #63 started at 1)', async () => {
    const user = await newUser(roleA);
    expect(await versionOf(user)).toBe(0);
  });

  describe('user_permissions (per-user overrides)', () => {
    it('an inserted override bumps that user and nobody else', async () => {
      const [target, bystander] = [await newUser(roleA), await newUser(roleA)];

      await prisma.userPermission.create({ data: { userId: target, permissionId } });

      expect(await versions(target, bystander)).toEqual([1, 0]);
    });

    it('several rows in one statement bump once (statement-level)', async () => {
      const user = await newUser(roleA);

      await prisma.userPermission.createMany({
        data: [
          { userId: user, permissionId },
          { userId: user, permissionId: seededPermissionId, allowed: false },
        ],
      });

      expect(await versionOf(user)).toBe(1);
    });

    it('flipping allowed bumps; touching only granted_by does not', async () => {
      const [user, granter] = [await newUser(roleA), await newUser(roleB)];
      await prisma.userPermission.create({ data: { userId: user, permissionId } });
      expect(await versionOf(user)).toBe(1);

      await prisma.userPermission.update({
        where: { userId_permissionId: { userId: user, permissionId } },
        data: { allowed: false },
      });
      expect(await versionOf(user)).toBe(2);

      await prisma.userPermission.update({
        where: { userId_permissionId: { userId: user, permissionId } },
        data: { grantedBy: granter },
      });
      expect(await versionOf(user)).toBe(2);
    });

    it('a deleted override bumps that user', async () => {
      const user = await newUser(roleA);
      await prisma.userPermission.create({ data: { userId: user, permissionId } });

      await prisma.userPermission.deleteMany({ where: { userId: user } });

      expect(await versionOf(user)).toBe(2);
    });

    it('the replace-overrides transaction (delete + insert) bumps the user', async () => {
      const user = await newUser(roleA);
      await prisma.userPermission.create({ data: { userId: user, permissionId } });
      const before = await versionOf(user);

      await prisma.$transaction(async (tx) => {
        await tx.userPermission.deleteMany({ where: { userId: user } });
        await tx.userPermission.createMany({
          data: [{ userId: user, permissionId, allowed: false }],
        });
      });

      expect(await versionOf(user)).toBeGreaterThan(before);
    });

    it('a rolled-back change leaves the version where it was', async () => {
      const user = await newUser(roleA);

      await expect(
        prisma.$transaction(async (tx) => {
          await tx.userPermission.create({ data: { userId: user, permissionId } });
          throw new Error('roll back');
        }),
      ).rejects.toThrow('roll back');

      expect(await versionOf(user)).toBe(0);
    });
  });

  describe('role_permissions (the matrix)', () => {
    it('a grant to a role bumps every member of that role and nobody else', async () => {
      const [a1, a2, b1] = [await newUser(roleA), await newUser(roleA), await newUser(roleB)];

      await prisma.rolePermission.create({ data: { roleId: roleA, permissionId } });

      expect(await versions(a1, a2, b1)).toEqual([1, 1, 0]);
    });

    it('a revocation from a role bumps every member', async () => {
      const [a1, b1] = [await newUser(roleA), await newUser(roleB)];
      await prisma.rolePermission.create({ data: { roleId: roleA, permissionId } });

      await prisma.rolePermission.deleteMany({ where: { roleId: roleA } });

      expect(await versions(a1, b1)).toEqual([2, 0]);
    });

    it('a matrix-style replace across two roles bumps both, once per statement', async () => {
      const [a1, b1] = [await newUser(roleA), await newUser(roleB)];

      await prisma.rolePermission.createMany({
        data: [
          { roleId: roleA, permissionId },
          { roleId: roleA, permissionId: seededPermissionId },
          { roleId: roleB, permissionId },
        ],
      });

      expect(await versions(a1, b1)).toEqual([1, 1]);
    });

    it('updating only granted_by bumps nobody', async () => {
      const [a1, granter] = [await newUser(roleA), await newUser(roleB)];
      await prisma.rolePermission.create({ data: { roleId: roleA, permissionId } });

      await prisma.rolePermission.updateMany({
        where: { roleId: roleA },
        data: { grantedBy: granter },
      });

      expect(await versionOf(a1)).toBe(1);
    });
  });

  describe('permissions (the catalogue)', () => {
    it('renaming a code bumps everyone holding it by role or override', async () => {
      const [viaRole, viaOverride, neither] = [
        await newUser(roleA),
        await newUser(roleB),
        await newUser(roleB),
      ];
      await prisma.rolePermission.create({ data: { roleId: roleA, permissionId } });
      await prisma.userPermission.create({ data: { userId: viaOverride, permissionId } });
      const before = await versions(viaRole, viaOverride, neither);

      await prisma.permission.update({
        where: { id: permissionId },
        data: { code: `pv.spec.${tag}.renamed` },
      });

      expect(await versions(viaRole, viaOverride, neither)).toEqual([
        before[0]! + 1,
        before[1]! + 1,
        before[2],
      ]);
    });

    it('editing only the description bumps nobody', async () => {
      const user = await newUser(roleA);
      await prisma.rolePermission.create({ data: { roleId: roleA, permissionId } });

      await prisma.permission.update({ where: { id: permissionId }, data: { description: 'x' } });

      expect(await versionOf(user)).toBe(1);
    });

    it('deleting a permission cascades and bumps its holders', async () => {
      const [viaRole, viaOverride] = [await newUser(roleA), await newUser(roleB)];
      await prisma.rolePermission.create({ data: { roleId: roleA, permissionId } });
      await prisma.userPermission.create({ data: { userId: viaOverride, permissionId } });

      await prisma.permission.delete({ where: { id: permissionId } });

      expect(await versions(viaRole, viaOverride)).toEqual([2, 2]);
    });
  });

  describe('users', () => {
    it('a role change bumps the account', async () => {
      const user = await newUser(roleA);

      await prisma.user.update({ where: { id: user }, data: { roleId: roleB } });

      expect(await versionOf(user)).toBe(1);
    });

    it('an unrelated update does not bump', async () => {
      const user = await newUser(roleA);

      await prisma.user.update({ where: { id: user }, data: { displayName: 'Renamed' } });

      expect(await versionOf(user)).toBe(0);
    });

    it('refuses to move the version backwards', async () => {
      const user = await newUser(roleA);
      await prisma.userPermission.create({ data: { userId: user, permissionId } });

      await expect(
        prisma.user.update({ where: { id: user }, data: { authzVersion: 0 } }),
      ).rejects.toThrow(/authz_version may not decrease/);
      expect(await versionOf(user)).toBe(1);
    });

    it('deleting an account with overrides cascades cleanly', async () => {
      const user = await newUser(roleA);
      await prisma.userPermission.create({ data: { userId: user, permissionId } });

      await prisma.user.delete({ where: { id: user } });

      expect(await prisma.user.count({ where: { id: user } })).toBe(0);
    });
  });
});
