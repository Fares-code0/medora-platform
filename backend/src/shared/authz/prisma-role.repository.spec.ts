import { describe, expect, it } from 'vitest';

import { PrismaRoleRepository } from './prisma-role.repository';

/**
 * `currentMatrix` under a concurrent role delete.
 *
 * The relations of `role_permissions` load in a second query, so a custom
 * role deleted between the two — its grants cascading away — comes back
 * as a row whose `role` is null despite the foreign key. Found in a full
 * parallel run once the permission cache moved to Redis: a matrix save in
 * one process now invalidates every process, so another process read the
 * matrix through at exactly that moment and answered 500 on
 * `GET /patients/:id`. The race is reproduced here deterministically by
 * handing the repository such a row.
 */
function repositoryReturning(rows: unknown[]): PrismaRoleRepository {
  const prisma = { db: { rolePermission: { findMany: () => Promise.resolve(rows) } } };
  return new PrismaRoleRepository(prisma as never);
}

describe('PrismaRoleRepository.currentMatrix', () => {
  it('builds the matrix from role and permission codes', async () => {
    const matrix = await repositoryReturning([
      { role: { code: 'doctor' }, permission: { code: 'patients.view' } },
      { role: { code: 'doctor' }, permission: { code: 'messages.send' } },
      { role: { code: 'admin' }, permission: { code: 'roles.manage' } },
    ]).currentMatrix();

    expect(matrix).toEqual({
      doctor: ['patients.view', 'messages.send'],
      admin: ['roles.manage'],
    });
  });

  it('skips a grant whose role was deleted mid-read instead of throwing', async () => {
    const matrix = await repositoryReturning([
      { role: { code: 'doctor' }, permission: { code: 'patients.view' } },
      { role: null, permission: { code: 'patients.view' } },
    ]).currentMatrix();

    expect(matrix).toEqual({ doctor: ['patients.view'] });
  });

  it('skips a grant whose permission was deleted mid-read', async () => {
    const matrix = await repositoryReturning([
      { role: { code: 'doctor' }, permission: null },
      { role: { code: 'doctor' }, permission: { code: 'patients.view' } },
    ]).currentMatrix();

    expect(matrix).toEqual({ doctor: ['patients.view'] });
  });
});
