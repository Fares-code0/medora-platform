import { randomUUID } from 'node:crypto';

import type { PrismaService } from '../../src/shared/database';

/**
 * S5 fixtures: administrative scope is explicit (OD-07, M-13). An account
 * that only holds the `admin` role has **no** administrative scope and is
 * refused on every administrative route, so a suite that administers needs
 * one of these, applied after the account holds the role.
 *
 * Grants and assignments go with the account: the harness's hard delete of
 * its users cascades `platform_admin_assignments`; hospital admin assignments
 * are removed by `removeHospitals` (or by the suite).
 */

/** Marks the account (already holding the `admin` role) as Platform Admin. */
export async function markPlatformAdmin(prisma: PrismaService, email: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const live = await prisma.platformAdminAssignment.findFirst({
    where: { userId: user.id, revokedAt: null },
    select: { id: true },
  });
  if (live !== null) return;
  await prisma.platformAdminAssignment.create({
    data: { userId: user.id, grantReason: 'e2e fixture: platform administrator' },
  });
}

export interface FixtureHospital {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
}

/** An active hospital with a unique public id and name. */
export async function createHospital(
  prisma: PrismaService,
  label: string,
): Promise<FixtureHospital> {
  const tag = randomUUID().replaceAll('-', '').slice(0, 12);
  return prisma.hospital.create({
    data: { publicId: `hsp_s5_${tag}`, name: `${label} ${tag}` },
    select: { id: true, publicId: true, name: true },
  });
}

/**
 * Makes the account (already holding the `admin` role) the Hospital Admin of
 * `hospitalId`: one live hospital `admin` role assignment.
 */
export async function makeHospitalAdmin(
  prisma: PrismaService,
  email: string,
  hospitalId: string,
): Promise<void> {
  const [user, role] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } }),
    prisma.role.findUniqueOrThrow({ where: { code: 'admin' }, select: { id: true } }),
  ]);
  await prisma.hospitalRoleAssignment.create({
    data: { userId: user.id, hospitalId, roleId: role.id },
  });
}

/**
 * Turns a Platform Admin fixture into the Hospital Admin of `hospitalId`:
 * revokes the live grant (history kept) and adds the hospital assignment.
 * Scope is resolved per request, so tokens already issued follow at once.
 */
export async function convertToHospitalAdmin(
  prisma: PrismaService,
  email: string,
  hospitalId: string,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  await prisma.platformAdminAssignment.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: 'e2e fixture: becomes a Hospital Admin' },
  });
  await makeHospitalAdmin(prisma, email, hospitalId);
}

/**
 * Removes fixture hospitals and every row this suite hung on them, children
 * first. Only rows whose hospital is one of `hospitalIds` are touched.
 */
export async function removeHospitals(
  prisma: PrismaService,
  hospitalIds: readonly string[],
): Promise<void> {
  if (hospitalIds.length === 0) return;
  const inFixture = { hospitalId: { in: [...hospitalIds] } };
  await prisma.hospitalRoleAssignment.deleteMany({ where: inFixture });
  await prisma.staffShiftAssignment.deleteMany({ where: inFixture });
  await prisma.queueEntry.deleteMany({ where: inFixture });
  await prisma.waitingRoomEntry.deleteMany({ where: inFixture });
  await prisma.room.deleteMany({ where: inFixture });
  await prisma.resource.deleteMany({ where: inFixture });
  await prisma.hospitalStaffAffiliation.deleteMany({ where: inFixture });
  await prisma.doctorEmployment.deleteMany({ where: inFixture });
  await prisma.hospital.deleteMany({ where: { id: { in: [...hospitalIds] } } });
}
