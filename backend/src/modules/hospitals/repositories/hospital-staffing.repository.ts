/**
 * Persistence for the hospital staffing lifecycle (multi-hospital §2.3–§2.6).
 *
 * Every write that changes what an account may do runs in one transaction
 * with the two consequences the approved decision requires:
 *
 * - `users.authz_version` is incremented, so every cached effective set is
 *   stale on the account's next request (ADR-046 rules 5–6);
 * - when access is *removed or moved* (termination, transfer, an
 *   administrative scope granted or withdrawn), every live session and
 *   refresh token is revoked in the same transaction, so no token minted
 *   under the old standing survives the change (§2.6, §2.10).
 *
 * Nothing is deleted: an employment, affiliation or assignment ends with a
 * timestamp and history is preserved.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

type Tx = Prisma.TransactionClient;

export interface DoctorRow {
  readonly id: string;
  readonly userId: string;
  readonly deletedAt: Date | null;
  readonly roleCode: string;
}

export interface EmploymentRow {
  readonly id: string;
  readonly doctorId: string;
  readonly hospitalId: string;
  readonly endedAt: Date | null;
  readonly userId: string;
}

/** One employment in a doctor's history (OD-12, ported from PR #63). */
export interface EmploymentHistoryRow {
  readonly id: string;
  readonly doctorId: string;
  readonly hospitalId: string;
  readonly hospitalName: string;
  readonly hospitalDepartmentId: string | null;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export interface AffiliationRow {
  readonly id: string;
  readonly staffId: string;
  readonly hospitalId: string;
  readonly endedAt: Date | null;
  readonly userId: string | null;
}

export interface AdminUserRow {
  readonly id: string;
  readonly publicId: string;
  readonly roleCode: string;
  readonly status: string;
}

@Injectable()
export class HospitalStaffingRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The hospital, only when ACTIVE and not deleted. */
  async activeHospital(hospitalId: string): Promise<{ id: string; name: string } | null> {
    return this.prisma.db.hospital.findFirst({
      where: { id: hospitalId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, name: true },
    });
  }

  async departmentBelongs(departmentId: string, hospitalId: string): Promise<boolean> {
    const row = await this.prisma.db.hospitalDepartment.findFirst({
      where: { id: departmentId, hospitalId, deletedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async doctor(doctorId: string): Promise<DoctorRow | null> {
    const row = await this.prisma.db.doctor.findUnique({
      where: { id: doctorId },
      select: {
        id: true,
        userId: true,
        deletedAt: true,
        user: { select: { role: { select: { code: true } } } },
      },
    });
    return row === null
      ? null
      : { id: row.id, userId: row.userId, deletedAt: row.deletedAt, roleCode: row.user.role.code };
  }

  /**
   * A doctor's employments, active and ended, newest first; `hospitalId`
   * confines them to one hospital (a Hospital Admin's own), `null` lists all.
   */
  async employmentsOf(
    doctorId: string,
    hospitalId: string | null,
  ): Promise<EmploymentHistoryRow[]> {
    const rows = await this.prisma.db.doctorEmployment.findMany({
      where: { doctorId, ...(hospitalId === null ? {} : { hospitalId }) },
      select: {
        id: true,
        doctorId: true,
        hospitalId: true,
        hospitalDepartmentId: true,
        startedAt: true,
        endedAt: true,
        hospital: { select: { name: true } },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(({ hospital, ...row }) => ({ ...row, hospitalName: hospital.name }));
  }

  async activeEmploymentOf(doctorId: string): Promise<EmploymentRow | null> {
    const row = await this.prisma.db.doctorEmployment.findFirst({
      where: { doctorId, endedAt: null },
      select: {
        id: true,
        doctorId: true,
        hospitalId: true,
        endedAt: true,
        doctor: { select: { userId: true } },
      },
    });
    return row === null ? null : { ...withoutDoctor(row), userId: row.doctor.userId };
  }

  async employment(employmentId: string): Promise<EmploymentRow | null> {
    const row = await this.prisma.db.doctorEmployment.findUnique({
      where: { id: employmentId },
      select: {
        id: true,
        doctorId: true,
        hospitalId: true,
        endedAt: true,
        doctor: { select: { userId: true } },
      },
    });
    return row === null ? null : { ...withoutDoctor(row), userId: row.doctor.userId };
  }

  async startEmployment(input: {
    doctorId: string;
    userId: string;
    hospitalId: string;
    departmentId: string | undefined;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.doctorEmployment.create({
        data: {
          doctorId: input.doctorId,
          hospitalId: input.hospitalId,
          hospitalDepartmentId: input.departmentId ?? null,
        },
        select: { id: true },
      });
      // Gaining a clinical context changes the effective set; nothing to revoke.
      await bump(tx, input.userId);
      return created.id;
    });
  }

  /** Ends the employment, its role assignments, and every session. */
  async endEmployment(employment: EmploymentRow): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.doctorEmployment.update({ where: { id: employment.id }, data: { endedAt: now } });
      await tx.hospitalRoleAssignment.updateMany({
        where: { sourceDoctorEmploymentId: employment.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await endCareAt(tx, employment, now);
      await bump(tx, employment.userId);
      return revokeSessions(tx, employment.userId, now);
    });
  }

  /** Ends the current employment and starts the new one, atomically. */
  async transfer(input: {
    from: EmploymentRow;
    toHospitalId: string;
    departmentId: string | undefined;
  }): Promise<{ employmentId: string; sessionsRevoked: number }> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.doctorEmployment.update({ where: { id: input.from.id }, data: { endedAt: now } });
      await tx.hospitalRoleAssignment.updateMany({
        where: { sourceDoctorEmploymentId: input.from.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await endCareAt(tx, input.from, now);
      const created = await tx.doctorEmployment.create({
        data: {
          doctorId: input.from.doctorId,
          hospitalId: input.toHospitalId,
          hospitalDepartmentId: input.departmentId ?? null,
        },
        select: { id: true },
      });
      await bump(tx, input.from.userId);
      const sessionsRevoked = await revokeSessions(tx, input.from.userId, now);
      return { employmentId: created.id, sessionsRevoked };
    });
  }

  async staff(staffId: string): Promise<{ id: string; userId: string | null } | null> {
    return this.prisma.db.staffMember.findFirst({
      where: { id: staffId, deletedAt: null },
      select: { id: true, userId: true },
    });
  }

  async affiliation(affiliationId: string): Promise<AffiliationRow | null> {
    const row = await this.prisma.db.hospitalStaffAffiliation.findUnique({
      where: { id: affiliationId },
      select: {
        id: true,
        staffId: true,
        hospitalId: true,
        endedAt: true,
        staff: { select: { userId: true } },
      },
    });
    return row === null
      ? null
      : {
          id: row.id,
          staffId: row.staffId,
          hospitalId: row.hospitalId,
          endedAt: row.endedAt,
          userId: row.staff.userId,
        };
  }

  async hasActiveAffiliation(staffId: string): Promise<boolean> {
    const row = await this.prisma.db.hospitalStaffAffiliation.findFirst({
      where: { staffId, endedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async startAffiliation(input: {
    staffId: string;
    userId: string | null;
    hospitalId: string;
    departmentId: string | undefined;
  }): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.hospitalStaffAffiliation.create({
        data: {
          staffId: input.staffId,
          hospitalId: input.hospitalId,
          hospitalDepartmentId: input.departmentId ?? null,
        },
        select: { id: true },
      });
      if (input.userId !== null) await bump(tx, input.userId);
      return created.id;
    });
  }

  async endAffiliation(affiliation: AffiliationRow): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.hospitalStaffAffiliation.update({
        where: { id: affiliation.id },
        data: { endedAt: now },
      });
      await tx.hospitalRoleAssignment.updateMany({
        where: { sourceStaffAffiliationId: affiliation.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (affiliation.userId === null) return 0;
      await bump(tx, affiliation.userId);
      return revokeSessions(tx, affiliation.userId, now);
    });
  }

  async userByPublicId(publicId: string): Promise<AdminUserRow | null> {
    const row = await this.prisma.db.user.findFirst({
      where: { publicId, deletedAt: null },
      select: { id: true, publicId: true, status: true, role: { select: { code: true } } },
    });
    return row === null
      ? null
      : { id: row.id, publicId: row.publicId, status: row.status, roleCode: row.role.code };
  }

  async hasActivePlatformGrant(userId: string): Promise<boolean> {
    const row = await this.prisma.db.platformAdminGrant.findFirst({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async activeHospitalAdminAssignment(
    userId: string,
  ): Promise<{ id: string; hospitalId: string } | null> {
    return this.prisma.db.hospitalRoleAssignment.findFirst({
      where: { userId, revokedAt: null, role: { is: { code: 'admin' } } },
      select: { id: true, hospitalId: true },
    });
  }

  async hasAnyActiveRoleAssignment(userId: string): Promise<boolean> {
    const row = await this.prisma.db.hospitalRoleAssignment.findFirst({
      where: { userId, revokedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async countActivePlatformAdmins(): Promise<number> {
    return this.prisma.db.platformAdminGrant.count({
      where: { revokedAt: null, user: { is: { status: 'ACTIVE', deletedAt: null } } },
    });
  }

  async assignHospitalAdmin(input: {
    userId: string;
    hospitalId: string;
    actorId: string;
  }): Promise<{ id: string; sessionsRevoked: number }> {
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.findUniqueOrThrow({
        where: { code: 'admin' },
        select: { id: true },
      });
      const created = await tx.hospitalRoleAssignment.create({
        data: {
          userId: input.userId,
          hospitalId: input.hospitalId,
          roleId: role.id,
          grantedBy: input.actorId,
        },
        select: { id: true },
      });
      const now = new Date();
      await bump(tx, input.userId);
      return { id: created.id, sessionsRevoked: await revokeSessions(tx, input.userId, now) };
    });
  }

  async revokeHospitalAdmin(assignmentId: string, userId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.hospitalRoleAssignment.update({
        where: { id: assignmentId },
        data: { revokedAt: now },
      });
      await bump(tx, userId);
      return revokeSessions(tx, userId, now);
    });
  }

  async grantPlatformAdmin(input: {
    userId: string;
    actorId: string;
    reason: string;
  }): Promise<{ id: string; sessionsRevoked: number }> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.platformAdminGrant.create({
        data: { userId: input.userId, grantedBy: input.actorId, reason: input.reason },
        select: { id: true },
      });
      const now = new Date();
      await bump(tx, input.userId);
      return { id: created.id, sessionsRevoked: await revokeSessions(tx, input.userId, now) };
    });
  }

  async revokePlatformAdmin(userId: string, actorId: string): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.platformAdminGrant.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now, revokedBy: actorId },
      });
      await bump(tx, userId);
      return revokeSessions(tx, userId, now);
    });
  }
}

function withoutDoctor<T extends { doctor: unknown }>(row: T): Omit<T, 'doctor'> {
  const { doctor: _doctor, ...rest } = row;
  return rest;
}

/**
 * Ends the doctor's care assignments at the hospital they are leaving (audit
 * F-01): those made under the ending employment, and any other live one at
 * that hospital. An assignment is a care relationship *at a hospital*; it
 * must not outlive the doctor's employment there and keep the former
 * hospital's patients on their list. Access itself never depended on it
 * (DR-05 keys on the employment), so this closes the list, not a gate.
 */
async function endCareAt(
  tx: Tx,
  employment: { readonly id: string; readonly doctorId: string; readonly hospitalId: string },
  now: Date,
): Promise<void> {
  await tx.patientDoctorAssignment.updateMany({
    where: {
      doctorId: employment.doctorId,
      revokedAt: null,
      OR: [{ doctorEmploymentId: employment.id }, { hospitalId: employment.hospitalId }],
    },
    data: { revokedAt: now },
  });
}

async function bump(tx: Tx, userId: string): Promise<void> {
  await tx.user.update({ where: { id: userId }, data: { authzVersion: { increment: 1 } } });
}

async function revokeSessions(tx: Tx, userId: string, now: Date): Promise<number> {
  const result = await tx.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: now },
  });
  return result.count;
}
