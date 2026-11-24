/**
 * The authorization repositories against a real database (RM M7.1, M7.2).
 *
 * These two adapters were placeholders until M5 landed — one served the
 * catalogue's constants, the other denied everything — so the questions
 * they answer had never been asked of Postgres. Everything here needs a
 * database by design: the behaviour under test is the query, including
 * the two joins `PrismaPatientAssignmentRepository` hides and the uuid
 * handling that a mock would happily get wrong.
 */

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import {
  PATIENT_ASSIGNMENT_REPOSITORY,
  PATIENT_SELF_REPOSITORY,
  ROLE_REPOSITORY,
  AuthzKernelModule,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  normalizeMatrix,
  type PatientAssignmentRepository,
  type PatientSelfRepository,
  type RoleRepository,
} from '../src/shared/authz';
import { PrismaService } from '../src/shared/database';

import { createTestDoctor, destroyTestDoctor } from './support/doctor-fixture';
import {
  createTestHospital,
  destroyTestHospitals,
  employDoctor,
  assignOwned,
} from './support/hospital-fixture';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

const FIXTURE_TAG = 'authzrepo';

const CLINICAL_ASSIGNMENT = {
  revokedAt: null,
  doctorEmployment: {
    is: { endedAt: null, hospital: { is: { status: 'ACTIVE', deletedAt: null } } },
  },
  doctor: {
    is: {
      deletedAt: null,
      verificationStatus: 'VERIFIED' as const,
      practiceStatus: { in: ['ACTIVE' as const, 'VACATION' as const] },
    },
  },
};

describe('the authorization repositories', () => {
  let app: INestApplication;
  let roles: RoleRepository;
  let assignments: PatientAssignmentRepository;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthzKernelModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    roles = app.get<RoleRepository>(ROLE_REPOSITORY);
    assignments = app.get<PatientAssignmentRepository>(PATIENT_ASSIGNMENT_REPOSITORY);
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PrismaRoleRepository', () => {
    it('reads back the matrix the seed wrote', async () => {
      // The end-to-end check on M5.1's seed, M7's catalogue and this
      // query all agreeing. `seed-parity.spec.ts` compares the two
      // *files*; this compares what the database actually holds.
      const stored = normalizeMatrix(await roles.currentMatrix());

      for (const role of PLATFORM_ROLES) {
        expect([...stored[role]].sort(), role).toEqual([...SEEDED_MATRIX[role]].sort());
      }
    });

    it('reports no overrides for a user that has none', async () => {
      const user = await prisma.db.user.findFirst({ select: { id: true } });
      expect(user, 'the seed produced no users').not.toBeNull();

      const overrides = await roles.overridesFor(user?.id ?? '');

      expect(overrides.granted).toEqual([]);
      expect(overrides.revoked).toEqual([]);
    });

    it('splits stored overrides by their allowed flag', async () => {
      // Written and rolled back: the seed deliberately ships none, and a
      // leftover override would change what every later suite resolves.
      const user = await prisma.db.user.findFirstOrThrow({ select: { id: true } });
      const [granted, revoked] = await Promise.all([
        prisma.db.permission.findFirstOrThrow({ where: { code: 'logs.view' } }),
        prisma.db.permission.findFirstOrThrow({ where: { code: 'patients.view' } }),
      ]);

      try {
        await prisma.db.userPermission.createMany({
          data: [
            { userId: user.id, permissionId: granted.id, allowed: true },
            { userId: user.id, permissionId: revoked.id, allowed: false },
          ],
        });

        const overrides = await roles.overridesFor(user.id);

        expect(overrides.granted).toContain('logs.view');
        expect(overrides.revoked).toContain('patients.view');
      } finally {
        await prisma.db.userPermission.deleteMany({ where: { userId: user.id } });
      }
    });

    it('lists the users holding a role, and none for a role nobody holds', async () => {
      const doctors = await roles.userIdsWithRole('doctor');
      expect(doctors.length).toBeGreaterThan(0);

      // Seeded, but with no users — the wider staff vocabulary of
      // ADR-017 §6.
      expect(await roles.userIdsWithRole('nurse')).toEqual([]);
      expect(await roles.userIdsWithRole('no-such-role')).toEqual([]);
    });
  });

  describe('PrismaPatientAssignmentRepository', () => {
    // Its own clinically usable doctor and owned assignment, rather than
    // whatever another suite left behind: the demo seed's assignments are
    // legacy (no hospital) and grant nothing under S3 / #17.
    let ownedPatientId = '';

    beforeAll(async () => {
      const hospital = await createTestHospital(prisma, FIXTURE_TAG);
      const doctor = await createTestDoctor(prisma, FIXTURE_TAG);
      await employDoctor(prisma, doctor.id, hospital.id);
      const [patient] = await createPatientRecords(prisma, FIXTURE_TAG, 1);
      ownedPatientId = patient!.id;
      await assignOwned(prisma, { doctorId: doctor.id, patientId: ownedPatientId });
    });

    afterAll(async () => {
      await destroyPatientRecords(prisma, FIXTURE_TAG);
      await destroyTestDoctor(prisma, FIXTURE_TAG);
      await destroyTestHospitals(prisma, FIXTURE_TAG);
    });

    it('finds a live assignment through both joins', async () => {
      // The seed gives each canonical patient a live assignment; this
      // asserts the doctor's *user* id reaches it, which is the join the
      // port hides.
      const assignment = await prisma.db.patientDoctorAssignment.findFirstOrThrow({
        // S3: only an assignment the hospital-aware rule grants — owned by
        // an active employment at an active hospital, held by a clinically
        // usable doctor. A legacy row with no hospital answers no (#17).
        where: { ...CLINICAL_ASSIGNMENT, patientId: ownedPatientId },
        select: {
          doctor: { select: { userId: true } },
          patient: { select: { id: true, publicId: true } },
        },
      });

      expect(
        await assignments.isAssigned(assignment.doctor.userId, assignment.patient.publicId),
      ).toBe(true);
    });

    it('accepts the raw uuid as well as the public handle', async () => {
      const assignment = await prisma.db.patientDoctorAssignment.findFirstOrThrow({
        // S3: only an assignment the hospital-aware rule grants — owned by
        // an active employment at an active hospital, held by a clinically
        // usable doctor. A legacy row with no hospital answers no (#17).
        where: { ...CLINICAL_ASSIGNMENT, patientId: ownedPatientId },
        select: {
          doctor: { select: { userId: true } },
          patient: { select: { id: true } },
        },
      });

      expect(await assignments.isAssigned(assignment.doctor.userId, assignment.patient.id)).toBe(
        true,
      );
    });

    it("refuses another doctor's patient", async () => {
      // PT-1005 is deliberately assigned elsewhere in the seed so this
      // case is testable at all (M5.10's verify note says so).
      const [first, second] = await prisma.db.patientDoctorAssignment.findMany({
        where: { revokedAt: null },
        distinct: ['doctorId'],
        take: 2,
        select: {
          doctor: { select: { userId: true } },
          patient: { select: { publicId: true } },
        },
      });

      expect(second, 'the seed needs two doctors with distinct patients').toBeDefined();
      if (first === undefined || second === undefined) return;

      expect(await assignments.isAssigned(first.doctor.userId, second.patient.publicId)).toBe(
        false,
      );
    });

    it('does not count a revoked assignment', async () => {
      // Revocation is what ends a care relationship; a revoked row that
      // still granted access would make removing a doctor meaningless.
      const live = await prisma.db.patientDoctorAssignment.findFirstOrThrow({
        // S3: only an assignment the hospital-aware rule grants — owned by
        // an active employment at an active hospital, held by a clinically
        // usable doctor. A legacy row with no hospital answers no (#17).
        where: { ...CLINICAL_ASSIGNMENT, patientId: ownedPatientId },
        select: {
          id: true,
          doctor: { select: { userId: true } },
          patient: { select: { publicId: true } },
        },
      });

      try {
        await prisma.db.patientDoctorAssignment.update({
          where: { id: live.id },
          data: { revokedAt: new Date() },
        });

        expect(await assignments.isAssigned(live.doctor.userId, live.patient.publicId)).toBe(false);
      } finally {
        await prisma.db.patientDoctorAssignment.update({
          where: { id: live.id },
          data: { revokedAt: null },
        });
      }
    });

    it('answers no for a legacy assignment with no hospital (#17)', async () => {
      const legacy = await prisma.db.patientDoctorAssignment.findFirst({
        where: { revokedAt: null, hospitalId: null },
        select: { doctor: { select: { userId: true } }, patient: { select: { publicId: true } } },
      });
      if (legacy === null) return;

      expect(await assignments.isAssigned(legacy.doctor.userId, legacy.patient.publicId)).toBe(
        false,
      );
    });

    it('answers no rather than throwing for ids that match nothing', async () => {
      const nobody = '00000000-0000-4000-8000-000000000099';

      // A non-uuid patient handle must not reach a uuid column: Postgres
      // answers a malformed literal with a type error, which would turn
      // "not assigned" into a 500.
      expect(await assignments.isAssigned(nobody, 'PT-DOES-NOT-EXIST')).toBe(false);
      expect(await assignments.isAssigned(nobody, nobody)).toBe(false);
    });
  });

  describe('PrismaPatientSelfRepository', () => {
    it('does not resolve a soft-deleted chart as the account’s own (#18 audit)', async () => {
      const self = app.get<PatientSelfRepository>(PATIENT_SELF_REPOSITORY);
      const suffix = String(Date.now() % 1_000_000);
      const role = await prisma.role.findUniqueOrThrow({ where: { code: 'patient' } });
      const user = await prisma.user.create({
        data: {
          publicId: `usr_selfdel${suffix}`,
          firstName: 'Self',
          lastName: 'Deleted',
          displayName: 'Self Deleted',
          email: `self-deleted-${suffix}@authz-repositories.fixture.test`,
          phone: '+1 555 010 0001',
          roleId: role.id,
          termsAcceptedAt: new Date(),
          privacyAcceptedAt: new Date(),
        },
        select: { id: true },
      });
      const patient = await prisma.patient.create({
        data: {
          publicId: `PT-TSD${suffix}`,
          mrn: `MRN-TSD${suffix}`,
          fullName: 'Self Deleted',
          dateOfBirth: new Date('1990-01-01'),
          gender: 'FEMALE',
          bloodType: 'O_POSITIVE',
          phone: '+1 555 010 0001',
          userId: user.id,
        },
        select: { id: true, publicId: true },
      });

      try {
        expect(await self.findPatientIdByUserId(user.id)).toBe(patient.publicId);

        await prisma.patient.update({ where: { id: patient.id }, data: { deletedAt: new Date() } });

        expect(await self.findPatientIdByUserId(user.id)).toBeNull();
      } finally {
        await prisma.patient.deleteMany({ where: { id: patient.id } });
        await prisma.user.deleteMany({ where: { id: user.id } });
      }
    });
  });
});
