import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import type { Prisma } from '../src/generated/prisma/client';
import { DatabaseModule, PrismaService } from '../src/shared/database';
import { ROLES } from '../prisma/seed/permissions';
import { seedReferenceData } from '../prisma/seed/reference-data';

/**
 * Re-running the seed never undoes an authorization decision (M38.4's
 * prerequisite: a seed that is safe to run against a live database).
 *
 * The matrix editor revokes a capability by **deleting** the
 * `role_permissions` row. The seed used to upsert every bundle grant, so
 * the next `db:seed` silently re-created whatever an administrator had
 * removed. The first case fails on that version of the seed; the other
 * two pin that the fix still seeds the baseline it owes a new capability
 * and touches nothing else.
 *
 * Each case runs inside a transaction that is always rolled back, and
 * the seed runs on that transaction. Under READ COMMITTED no other suite
 * — several of which sign in as pharmacy accounts — ever sees the
 * revoked grant or the deleted permission.
 */
class Rollback extends Error {}

describe('seedReferenceData on an already-seeded database', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Runs `body` in a transaction and rolls it back, whatever happens. */
  async function inRolledBackTransaction(
    body: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    await expect(
      prisma.$transaction(
        async (tx) => {
          await body(tx);
          throw new Rollback();
        },
        { timeout: 30_000 },
      ),
    ).rejects.toBeInstanceOf(Rollback);
  }

  async function grantsOf(tx: Prisma.TransactionClient, role: string): Promise<string[]> {
    const rows = await tx.rolePermission.findMany({
      where: { role: { code: role } },
      select: { permission: { select: { code: true } } },
    });
    return rows.map((row) => row.permission.code).sort();
  }

  it('leaves a capability an administrator revoked revoked', async () => {
    await inRolledBackTransaction(async (tx) => {
      // What the matrix editor does to revoke `messages.send` from pharmacy.
      await tx.rolePermission.deleteMany({
        where: { role: { code: 'pharmacy' }, permission: { code: 'messages.send' } },
      });

      await seedReferenceData(tx);

      expect(await grantsOf(tx, 'pharmacy')).toEqual(['patients.view']);
    });
  });

  it('still grants a capability the database has never seen to every bundle naming it', async () => {
    const expected = ROLES.filter((role) => role.permissions.includes('logs.export'))
      .map((role) => role.code)
      .sort();
    expect(expected.length).toBeGreaterThan(0);

    await inRolledBackTransaction(async (tx) => {
      // A capability added to the catalogue after this database was
      // seeded: absent, so the seed owes it its baseline grants.
      await tx.permission.delete({ where: { code: 'logs.export' } });

      await seedReferenceData(tx);

      const holders = await tx.rolePermission.findMany({
        where: { permission: { code: 'logs.export' } },
        select: { role: { select: { code: true } } },
      });
      expect(holders.map((row) => row.role.code).sort()).toEqual(expected);
    });
  });

  it('changes no grant on a database that already matches the bundles', async () => {
    await inRolledBackTransaction(async (tx) => {
      const before = await tx.rolePermission.findMany({
        select: { roleId: true, permissionId: true, grantedAt: true },
        orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
      });

      await seedReferenceData(tx);

      const after = await tx.rolePermission.findMany({
        select: { roleId: true, permissionId: true, grantedAt: true },
        orderBy: [{ roleId: 'asc' }, { permissionId: 'asc' }],
      });
      expect(after).toEqual(before);
    });
  });
});
