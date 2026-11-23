/**
 * Phase 22 — server-derived hospital context against PostgreSQL.
 *
 * `hospital-context.service.spec.ts` proves the decision table with a
 * mocked repository. This suite proves the same decisions with the real
 * Prisma queries, which is where revocation (`ended_at`, `revoked_at`),
 * role separation (the role code joined through `roles`) and ambiguity
 * (distinct hospitals) are actually decided. The resolver is shadow-only:
 * every case that is not exactly one hospital must stay unresolved, and
 * nothing here may ever produce platform scope or clinical access.
 */

import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AuthenticatedUser } from '../src/common/auth/authenticated-user';
import { ConfigModule } from '../src/config';
import { AuthzKernelModule } from '../src/shared/authz';
import { HospitalContextService } from '../src/shared/authz/hospital-context.service';
import { PrismaService } from '../src/shared/database';

describe('Phase 22 hospital context resolution (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let contexts: HospitalContextService;

  const created = {
    users: [] as string[],
    doctors: [] as string[],
    hospitals: [] as string[],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthzKernelModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    contexts = app.get(HospitalContextService);
  });

  afterEach(async () => {
    const db = prisma.db;
    await db.hospitalRoleAssignment.deleteMany({
      where: { OR: [{ userId: { in: created.users } }, { hospitalId: { in: created.hospitals } }] },
    });
    await db.doctorEmployment.deleteMany({ where: { doctorId: { in: created.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: created.doctors } } });
    await db.user.deleteMany({ where: { id: { in: created.users } } });
    await db.hospital.deleteMany({ where: { id: { in: created.hospitals } } });
    created.users.length = 0;
    created.doctors.length = 0;
    created.hospitals.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  async function hospital(name: string): Promise<{ id: string; name: string }> {
    const row = await prisma.db.hospital.create({
      data: { publicId: 'hsp_' + randomUUID(), name },
      select: { id: true, name: true },
    });
    created.hospitals.push(row.id);
    return row;
  }

  async function user(roleCode: 'doctor' | 'admin' | 'patient'): Promise<string> {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const role = await prisma.db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const row = await prisma.db.user.create({
      data: {
        publicId: 'usr_p22' + suffix,
        firstName: 'Phase',
        lastName: 'TwentyTwo',
        displayName: 'Phase 22 ' + roleCode,
        email: `p22-${suffix}@hospital-context.fixture.test`,
        phone: '+1 555 010 2222',
        roleId: role.id,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
      select: { id: true },
    });
    created.users.push(row.id);
    return row.id;
  }

  async function doctor(): Promise<{ userId: string; doctorId: string }> {
    const userId = await user('doctor');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const departmentId = (
      await prisma.db.department.findUniqueOrThrow({ where: { name: 'Cardiology' } })
    ).id;
    const row = await prisma.db.doctor.create({
      data: {
        userId,
        fullName: 'Dr. Phase TwentyTwo',
        specialty: 'Internal Medicine',
        licenseNumber: 'MED-P22' + suffix,
        contactEmail: `p22-${suffix}@doctor.fixture.test`,
        contactPhone: '+1 (555) 010-2222',
        departmentId,
      },
      select: { id: true },
    });
    created.doctors.push(row.id);
    return { userId, doctorId: row.id };
  }

  async function assignRole(
    userId: string,
    hospitalId: string,
    roleCode: string,
    revokedAt: Date | null = null,
  ): Promise<void> {
    const role = await prisma.db.role.findUniqueOrThrow({ where: { code: roleCode } });
    await prisma.db.hospitalRoleAssignment.create({
      data: { userId, hospitalId, roleId: role.id, revokedAt },
    });
  }

  function principal(id: string, role: string): AuthenticatedUser {
    return { id, publicId: 'usr_p22', role, permissions: [], sessionId: randomUUID() };
  }

  describe('doctors', () => {
    it('derives the hospital of the one active employment', async () => {
      const { userId, doctorId } = await doctor();
      const h = await hospital('P22 Doctor Hospital');
      await prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: h.id } });

      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
        kind: 'hospital',
        hospitalId: h.id,
        hospitalName: h.name,
        source: 'doctor_employment',
      });
    });

    it('fails closed with no employment at all', async () => {
      const { userId } = await doctor();

      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'no_active_employment',
      });
    });

    it('drops the hospital immediately once the employment ends (no grace period)', async () => {
      const { userId, doctorId } = await doctor();
      const h = await hospital('P22 Ending Employment');
      const employment = await prisma.db.doctorEmployment.create({
        data: { doctorId, hospitalId: h.id },
      });
      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toMatchObject({
        kind: 'hospital',
        hospitalId: h.id,
      });

      await prisma.db.doctorEmployment.update({
        where: { id: employment.id },
        data: { endedAt: new Date() },
      });

      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'no_active_employment',
      });
    });

    it('follows a move to a new hospital and never reports the ended one', async () => {
      const { userId, doctorId } = await doctor();
      const first = await hospital('P22 First Employer');
      const second = await hospital('P22 Second Employer');
      const old = await prisma.db.doctorEmployment.create({
        data: { doctorId, hospitalId: first.id },
      });
      await prisma.db.doctorEmployment.update({
        where: { id: old.id },
        data: { endedAt: new Date() },
      });
      await prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: second.id } });

      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toMatchObject({
        kind: 'hospital',
        hospitalId: second.id,
      });
    });

    it('cannot become ambiguous: the database refuses a second active employment', async () => {
      const { doctorId } = await doctor();
      const first = await hospital('P22 Ambiguity A');
      const second = await hospital('P22 Ambiguity B');
      await prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: first.id } });

      await expect(
        prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: second.id } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('ignores hospital-admin assignments held by a doctor account', async () => {
      const { userId } = await doctor();
      const h = await hospital('P22 Doctor With Admin Row');
      await assignRole(userId, h.id, 'admin');

      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'no_active_employment',
      });
    });
  });

  describe('administrators', () => {
    it('derives the hospital of the one active hospital-admin assignment', async () => {
      const userId = await user('admin');
      const h = await hospital('P22 Admin Hospital');
      await assignRole(userId, h.id, 'admin');

      await expect(contexts.resolve(principal(userId, 'admin'))).resolves.toEqual({
        kind: 'hospital',
        hospitalId: h.id,
        hospitalName: h.name,
        source: 'hospital_admin_assignment',
      });
    });

    it('stays unmapped, never platform, for an administrator without an assignment', async () => {
      const userId = await user('admin');

      const context = await contexts.resolve(principal(userId, 'admin'));

      expect(context).toEqual({ kind: 'unresolved', reason: 'admin_scope_not_mapped' });
      expect(context.kind).not.toBe('platform');
    });

    it('drops the hospital immediately once the assignment is revoked', async () => {
      const userId = await user('admin');
      const h = await hospital('P22 Revoked Admin');
      await assignRole(userId, h.id, 'admin', new Date());

      await expect(contexts.resolve(principal(userId, 'admin'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'admin_scope_not_mapped',
      });
    });

    it('refuses to choose between two hospitals', async () => {
      const userId = await user('admin');
      const first = await hospital('P22 Admin A');
      const second = await hospital('P22 Admin B');
      await assignRole(userId, first.id, 'admin');
      await assignRole(userId, second.id, 'admin');

      await expect(contexts.resolve(principal(userId, 'admin'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'ambiguous_hospital_admin_scope',
      });
    });

    it('resolves the remaining hospital after one of two assignments is revoked', async () => {
      const userId = await user('admin');
      const kept = await hospital('P22 Admin Kept');
      const dropped = await hospital('P22 Admin Dropped');
      await assignRole(userId, kept.id, 'admin');
      await assignRole(userId, dropped.id, 'admin', new Date());

      await expect(contexts.resolve(principal(userId, 'admin'))).resolves.toMatchObject({
        kind: 'hospital',
        hospitalId: kept.id,
        source: 'hospital_admin_assignment',
      });
    });

    it('does not treat a non-admin hospital role as administrator scope', async () => {
      const userId = await user('admin');
      const h = await hospital('P22 Non-admin Role');
      await assignRole(userId, h.id, 'doctor');

      await expect(contexts.resolve(principal(userId, 'admin'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'admin_scope_not_mapped',
      });
    });
  });

  describe('patients', () => {
    it('stays unresolved until a patient resource is known, whatever rows exist', async () => {
      const userId = await user('patient');
      const h = await hospital('P22 Patient Hospital');
      await assignRole(userId, h.id, 'admin');

      await expect(contexts.resolve(principal(userId, 'patient'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'resource_required',
      });
    });
  });
});
