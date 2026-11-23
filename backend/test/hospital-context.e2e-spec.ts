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

  async function hospital(
    name: string,
    state: { status?: string; deleted?: boolean } = {},
  ): Promise<{ id: string; name: string }> {
    const row = await prisma.db.hospital.create({
      data: {
        publicId: 'hsp_' + randomUUID(),
        name,
        ...(state.status === undefined ? {} : { status: state.status }),
        ...(state.deleted === true ? { deletedAt: new Date() } : {}),
      },
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

    // Audit F4 (#22): the doctor profile's own state, not only the employment
    // and the hospital, decides clinical context. Mirrors the Database
    // reference rule `app_rls.effective_doctor_hospital`.
    describe('doctor profile state (F4)', () => {
      async function employed(
        name: string,
      ): Promise<{ userId: string; doctorId: string; hospitalId: string }> {
        const { userId, doctorId } = await doctor();
        const h = await hospital(name);
        await prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: h.id } });
        return { userId, doctorId, hospitalId: h.id };
      }

      it('fails closed for a doctor whose practice is suspended', async () => {
        const { userId, doctorId } = await employed('P22 F4 Suspended');
        await prisma.db.doctor.update({
          where: { id: doctorId },
          data: { practiceStatus: 'SUSPENDED' },
        });

        await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
          kind: 'unresolved',
          reason: 'no_active_employment',
        });
      });

      it('fails closed for a soft-deleted doctor profile', async () => {
        const { userId, doctorId } = await employed('P22 F4 Deleted');
        await prisma.db.doctor.update({ where: { id: doctorId }, data: { deletedAt: new Date() } });

        await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
          kind: 'unresolved',
          reason: 'no_active_employment',
        });
      });

      it('drops the context on the next resolution once the practice is suspended, and restores it on reinstatement', async () => {
        const { userId, doctorId, hospitalId } = await employed('P22 F4 Reinstated');
        await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toMatchObject({
          kind: 'hospital',
          hospitalId,
        });

        await prisma.db.doctor.update({
          where: { id: doctorId },
          data: { practiceStatus: 'SUSPENDED' },
        });
        await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toMatchObject({
          kind: 'unresolved',
        });

        await prisma.db.doctor.update({
          where: { id: doctorId },
          data: { practiceStatus: 'ACTIVE' },
        });
        await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toMatchObject({
          kind: 'hospital',
          hospitalId,
        });
      });

      it('keeps the employment row (history) when the profile is suspended', async () => {
        const { userId, doctorId } = await employed('P22 F4 History');
        await prisma.db.doctor.update({
          where: { id: doctorId },
          data: { practiceStatus: 'SUSPENDED' },
        });

        await contexts.resolve(principal(userId, 'doctor'));

        await expect(
          prisma.db.doctorEmployment.count({ where: { doctorId, endedAt: null } }),
        ).resolves.toBe(1);
      });

      it('still resolves VACATION, as the reference rule does, pending owner decision #18', async () => {
        const { userId, doctorId, hospitalId } = await employed('P22 F4 Vacation');
        await prisma.db.doctor.update({
          where: { id: doctorId },
          data: { practiceStatus: 'VACATION' },
        });

        await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toMatchObject({
          kind: 'hospital',
          hospitalId,
        });
      });
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

  describe('hospital state: only ACTIVE, non-deleted hospitals yield context', () => {
    const UNAVAILABLE: readonly [string, { status?: string; deleted?: boolean }][] = [
      ['suspended', { status: 'SUSPENDED' }],
      ['inactive', { status: 'INACTIVE' }],
      ['soft-deleted while still ACTIVE', { deleted: true }],
    ];

    it.each(UNAVAILABLE)(
      'treats a %s employer as missing doctor context',
      async (_label, state) => {
        const { userId, doctorId } = await doctor();
        const h = await hospital('P22 Unavailable Employer', state);
        await prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: h.id } });

        await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
          kind: 'unresolved',
          reason: 'no_active_employment',
        });
      },
    );

    it.each(UNAVAILABLE)(
      'treats a %s hospital as missing hospital-admin context',
      async (_label, state) => {
        const userId = await user('admin');
        const h = await hospital('P22 Unavailable Admin Hospital', state);
        await assignRole(userId, h.id, 'admin');

        await expect(contexts.resolve(principal(userId, 'admin'))).resolves.toEqual({
          kind: 'unresolved',
          reason: 'admin_scope_not_mapped',
        });
      },
    );

    it('drops the hospital on the next resolution once it is suspended', async () => {
      const { userId, doctorId } = await doctor();
      const h = await hospital('P22 Suspended Later');
      await prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: h.id } });
      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toMatchObject({
        kind: 'hospital',
        hospitalId: h.id,
      });

      await prisma.db.hospital.update({ where: { id: h.id }, data: { status: 'SUSPENDED' } });

      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'no_active_employment',
      });
    });

    it('rejects an unknown status at the database, so the allow-list is the only path', async () => {
      // `hospitals_status_check` allows ACTIVE, SUSPENDED and INACTIVE only;
      // the resolver additionally accepts ACTIVE alone.
      await expect(
        prisma.db.$executeRaw`INSERT INTO public.hospitals (public_id, name, status, updated_at)
          VALUES (${'hsp_' + randomUUID()}, 'P22 Unknown Status', 'PENDING', CURRENT_TIMESTAMP)`,
      ).rejects.toThrow(/hospitals_status_check/);
    });

    it('resolves an administrator to the one ACTIVE hospital when the other is suspended', async () => {
      const userId = await user('admin');
      const active = await hospital('P22 Admin Active');
      const suspended = await hospital('P22 Admin Suspended', { status: 'SUSPENDED' });
      await assignRole(userId, active.id, 'admin');
      await assignRole(userId, suspended.id, 'admin');

      await expect(contexts.resolve(principal(userId, 'admin'))).resolves.toEqual({
        kind: 'hospital',
        hospitalId: active.id,
        hospitalName: active.name,
        source: 'hospital_admin_assignment',
      });
    });

    it('never falls back to an ended employment at an ACTIVE hospital when the current employer is suspended', async () => {
      // A doctor cannot hold two active employments (one-active-per-doctor
      // index), so "one active plus one suspended hospital" for a doctor is
      // an ended employment at an ACTIVE hospital and the current one at a
      // suspended hospital. Neither may yield context.
      const { userId, doctorId } = await doctor();
      const former = await hospital('P22 Former Active Employer');
      const current = await hospital('P22 Current Suspended Employer', { status: 'SUSPENDED' });
      await prisma.db.doctorEmployment.create({
        data: {
          doctorId,
          hospitalId: former.id,
          startedAt: new Date(Date.now() - 86_400_000),
          endedAt: new Date(),
        },
      });
      await prisma.db.doctorEmployment.create({ data: { doctorId, hospitalId: current.id } });

      await expect(contexts.resolve(principal(userId, 'doctor'))).resolves.toEqual({
        kind: 'unresolved',
        reason: 'no_active_employment',
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
