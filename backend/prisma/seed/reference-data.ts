import type { Prisma } from '../../src/generated/prisma/client';

import {
  assertBundlesReferenceKnownCodes,
  PERMISSIONS,
  ROLES,
} from './permissions';
import {
  CHRONIC_CONDITION_CODES,
  CHRONIC_CONDITIONS,
  DEPARTMENTS,
  ICD_CODES,
  SPECIALTIES,
  VISIT_TYPE_ATTRIBUTES,
  VISIT_TYPES,
} from './vocabularies';
import { refresh, type SeedMode } from './seed-mode';

/**
 * Seeds the M5.1 reference data.
 *
 * Every write is an upsert on the natural key — a code, a name — never on
 * a generated id, which changes between runs. That is seed rule 1: running
 * this twice must leave the database as the first run left it.
 */
export async function seedReferenceData(
  prisma: Prisma.TransactionClient,
  mode: SeedMode = 'refresh',
): Promise<Record<string, number>> {
  assertBundlesReferenceKnownCodes();

  // Which rows this run created, so the matrix below can tell a baseline
  // it owes from a decision it must leave alone.
  const newPermissions = new Set<string>();
  const newRoles = new Set<string>();

  for (const permission of PERMISSIONS) {
    const existing = await prisma.permission.findUnique({ where: { code: permission.code } });
    if (existing === null) {
      await prisma.permission.create({ data: permission });
      newPermissions.add(permission.code);
    } else if (mode === 'refresh') {
      await prisma.permission.update({
        where: { code: permission.code },
        data: { domain: permission.domain, description: permission.description },
      });
    }
  }

  for (const role of ROLES) {
    const existing = await prisma.role.findUnique({ where: { code: role.code } });
    if (existing === null) {
      await prisma.role.create({ data: { code: role.code, label: role.label, isSystem: true } });
      newRoles.add(role.code);
    } else if (mode === 'refresh') {
      // An administrator may rename a role; in production that label is
      // theirs, not the seed's (`seed-mode.ts`).
      await prisma.role.update({
        where: { code: role.code },
        data: { label: role.label, isSystem: true },
      });
    }
  }

  // The matrix. A grant is seeded only where this run created its role or
  // its permission — the baseline a new role or a new capability needs.
  //
  // Grants an administrator has *removed* are never restored. The matrix
  // editor deletes the row (`roles.repository.ts`), so an upsert of every
  // bundle grant — what this loop used to do — re-created each one on the
  // next seed: a capability an administrator had revoked came back with
  // no request, no audit row and no one told. That is the one thing a
  // seed must never do to a live database. It establishes a baseline; it
  // does not enforce one.
  //
  // The cost, accepted: a bundle edited in code to add a capability that
  // already exists reaches only databases seeded afterwards. On a live
  // database that grant is an authorization change, which is the
  // administrator's to make in the matrix, not a seed's to make silently.
  for (const role of ROLES) {
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { code: role.code } });
    for (const code of role.permissions) {
      if (!newRoles.has(role.code) && !newPermissions.has(code)) continue;

      const permissionRow = await prisma.permission.findUniqueOrThrow({ where: { code } });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: roleRow.id, permissionId: permissionRow.id },
        },
        create: { roleId: roleRow.id, permissionId: permissionRow.id },
        update: {},
      });
    }
  }

  for (const name of DEPARTMENTS) {
    await prisma.department.upsert({ where: { name }, create: { name }, update: {} });
  }

  for (const [position, name] of VISIT_TYPES.entries()) {
    const attributes = VISIT_TYPE_ATTRIBUTES[name] ?? {};
    await prisma.visitType.upsert({
      where: { name },
      create: { name, position, ...attributes },
      update: refresh(mode, { position, ...attributes }),
    });
  }

  for (const [position, name] of CHRONIC_CONDITIONS.entries()) {
    const code = CHRONIC_CONDITION_CODES[name];
    const attributes = code === undefined ? {} : { code };
    await prisma.chronicCondition.upsert({
      where: { name },
      create: { name, position, ...attributes },
      update: refresh(mode, { position, ...attributes }),
    });
  }

  for (const { code, label } of ICD_CODES) {
    await prisma.icdCode.upsert({
      where: { code },
      create: { code, label },
      update: refresh(mode, { label }),
    });
  }

  for (const name of SPECIALTIES) {
    await prisma.specialty.upsert({ where: { name }, create: { name }, update: {} });
  }

  await assertVocabularyIntact(prisma);

  return {
    permissions: PERMISSIONS.length,
    roles: ROLES.length,
    departments: DEPARTMENTS.length,
    visitTypes: VISIT_TYPES.length,
    chronicConditions: CHRONIC_CONDITIONS.length,
    icdCodes: ICD_CODES.length,
    specialties: SPECIALTIES.length,
  };
}

/**
 * The invariant `frontend/src/types/auth/index.ts` states in prose:
 * "a capability that is not listed here cannot be referenced anywhere."
 *
 * Checked after the writes rather than before, because the failure this
 * catches is a row that exists in the database and not in the union —
 * a permission left behind by an earlier vocabulary, which every
 * permission check would then silently ignore.
 */
async function assertVocabularyIntact(prisma: Prisma.TransactionClient): Promise<void> {
  const stored = await prisma.permission.findMany({ select: { code: true } });
  const expected = new Set(PERMISSIONS.map((permission) => permission.code));

  const unexpected = stored.map((row) => row.code).filter((code) => !expected.has(code));
  if (unexpected.length > 0) {
    throw new Error(
      `permissions holds ${String(unexpected.length)} code(s) outside the Permission union: ` +
        `${unexpected.join(', ')}. The union is the vocabulary — reconcile before seeding.`,
    );
  }

  if (stored.length !== PERMISSIONS.length) {
    throw new Error(
      `Expected ${String(PERMISSIONS.length)} permissions, found ${String(stored.length)}.`,
    );
  }
}
