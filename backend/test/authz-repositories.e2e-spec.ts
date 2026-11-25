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
  ROLE_REPOSITORY,
  AuthzKernelModule,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  normalizeMatrix,
  type PatientAssignmentRepository,
  type RoleRepository,
} from '../src/shared/authz';
import { PrismaService } from '../src/shared/database';
import { createTestDoctor, destroyTestDoctor, type DoctorRecord } from './support/doctor-fixture';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';

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

  describe('PrismaPatientAssignmentRepository — DR-05', () => {
    const TAG = 'dr05r';
    let doctor: DoctorRecord;
    let patients: PatientRecord[];
    let hospitalA: string;
    let hospitalB: string;

    beforeAll(async () => {
      doctor = await createTestDoctor(prisma, TAG);
      patients = await createPatientRecords(prisma, TAG, 3);
      const make = async (name: string) =>
        (
          await prisma.hospital.create({
            data: { publicId: `hsp_${TAG}_${name}_${Date.now()}`, name: `DR05 ${name} ${Date.now()}` },
            select: { id: true },
          })
        ).id;
      hospitalA = await make('a');
      hospitalB = await make('b');
      await prisma.doctor.update({
        where: { id: doctor.id },
        data: { verificationStatus: 'VERIFIED', practiceStatus: 'ACTIVE' },
      });
      await prisma.doctorEmployment.create({ data: { doctorId: doctor.id, hospitalId: hospitalA } });
      const [atA, atB] = patients;
      if (atA === undefined || atB === undefined) throw new Error('fixture');
      await prisma.hospitalMedicalRecord.create({ data: { patientId: atA.id, hospitalId: hospitalA } });
      await prisma.hospitalMedicalRecord.create({ data: { patientId: atB.id, hospitalId: hospitalB } });
    });

    afterAll(async () => {
      await prisma.patientDoctorAssignment.deleteMany({ where: { doctorId: doctor.id } });
      await destroyPatientRecords(prisma, TAG);
      await destroyTestDoctor(prisma, TAG);
      await prisma.hospital.deleteMany({ where: { id: { in: [hospitalA, hospitalB] } } });
    });

    const at = (index: number): PatientRecord => {
      const patient = patients[index];
      if (patient === undefined) throw new Error('fixture');
      return patient;
    };

    it('reaches a patient with a record at the doctor’s hospital, with no assignment', async () => {
      expect(await assignments.reachesPatient(doctor.userId, at(0).publicId)).toBe(true);
      expect(await assignments.reachesPatient(doctor.userId, at(0).id)).toBe(true);
    });

    it('refuses a patient whose only record is at another hospital — even when assigned', async () => {
      await prisma.patientDoctorAssignment.create({
        data: { patientId: at(1).id, doctorId: doctor.id, role: 'primary' },
      });
      expect(await assignments.reachesPatient(doctor.userId, at(1).publicId)).toBe(false);
    });

    it('refuses a patient with no Hospital Medical Record anywhere', async () => {
      expect(await assignments.reachesPatient(doctor.userId, at(2).publicId)).toBe(false);
    });

    it.each([
      ['unverified', { verificationStatus: 'PENDING' }],
      ['suspended', { practiceStatus: 'SUSPENDED' }],
    ] as const)('refuses a %s doctor', async (_label, data) => {
      try {
        await prisma.doctor.update({ where: { id: doctor.id }, data });
        expect(await assignments.reachesPatient(doctor.userId, at(0).publicId)).toBe(false);
      } finally {
        await prisma.doctor.update({
          where: { id: doctor.id },
          data: { verificationStatus: 'VERIFIED', practiceStatus: 'ACTIVE' },
        });
      }
    });

    it('refuses once the employment has ended, and when the hospital is inactive', async () => {
      const employment = await prisma.doctorEmployment.findFirstOrThrow({
        where: { doctorId: doctor.id, endedAt: null },
      });
      try {
        await prisma.doctorEmployment.update({ where: { id: employment.id }, data: { endedAt: new Date() } });
        expect(await assignments.reachesPatient(doctor.userId, at(0).publicId)).toBe(false);
      } finally {
        await prisma.doctorEmployment.update({ where: { id: employment.id }, data: { endedAt: null } });
      }
      try {
        await prisma.hospital.update({ where: { id: hospitalA }, data: { status: 'SUSPENDED' } });
        expect(await assignments.reachesPatient(doctor.userId, at(0).publicId)).toBe(false);
      } finally {
        await prisma.hospital.update({ where: { id: hospitalA }, data: { status: 'ACTIVE' } });
      }
    });

    it('answers no rather than throwing for ids that match nothing', async () => {
      const nobody = '00000000-0000-4000-8000-000000000099';
      expect(await assignments.reachesPatient(nobody, 'PT-DOES-NOT-EXIST')).toBe(false);
      expect(await assignments.reachesPatient(nobody, nobody)).toBe(false);
    });
  });
});
