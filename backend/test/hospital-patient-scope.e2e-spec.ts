/**
 * S3 — the hospital-aware patient scope is **authoritative**, on PostgreSQL.
 *
 * Phase 22 ran this rule in shadow mode beside the legacy care-assignment
 * rule; this suite used to prove the two were compared without the shadow
 * changing a decision. Since S3 there is one rule and it decides, so every
 * scenario now asserts the **decision** `PatientScopeService` returns
 * against the real module wiring and real rows. Scenarios that asserted the
 * old cross-hospital-permissive legacy decision ("keeps legacy access to an
 * unowned assignment", "keeps legacy access once the hospital is
 * suspended") now assert the approved denial (#17, #18, OD-12).
 *
 * The rule (`src/shared/authz/hospital-patient-scope.ts`): a verified,
 * ACTIVE or VACATION, non-deleted doctor with exactly one active employment
 * at an ACTIVE, non-deleted hospital reaches a patient only through a live
 * assignment owned by that employment and the patient's medical record
 * there. Everything else is 404.
 */

import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { BloodType, Gender } from '../src/generated/prisma/enums';
import {
  AuthzKernelModule,
  PATIENT_ASSIGNMENT_REPOSITORY,
  PatientScopeService,
  type PatientAssignmentRepository,
  type Principal,
} from '../src/shared/authz';
import { runInRequestScope } from '../src/shared/authz/request-scope';
import { PrismaService } from '../src/shared/database';

describe('S3 hospital-aware patient scope, authoritative (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scope: PatientScopeService;
  let assignments: PatientAssignmentRepository;

  const created = {
    users: [] as string[],
    doctors: [] as string[],
    patients: [] as string[],
    hospitals: [] as string[],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthzKernelModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    scope = app.get(PatientScopeService);
    assignments = app.get<PatientAssignmentRepository>(PATIENT_ASSIGNMENT_REPOSITORY);
  });

  afterEach(async () => {
    const db = prisma;
    await db.patientDoctorAssignment.deleteMany({
      where: {
        OR: [{ doctorId: { in: created.doctors } }, { patientId: { in: created.patients } }],
      },
    });
    await db.hospitalRoleAssignment.deleteMany({ where: { userId: { in: created.users } } });
    await db.hospitalMedicalRecord.deleteMany({ where: { patientId: { in: created.patients } } });
    await db.doctorEmployment.deleteMany({ where: { doctorId: { in: created.doctors } } });
    await db.doctor.deleteMany({ where: { id: { in: created.doctors } } });
    await db.user.deleteMany({ where: { id: { in: created.users } } });
    await db.patient.deleteMany({ where: { id: { in: created.patients } } });
    await db.hospital.deleteMany({ where: { id: { in: created.hospitals } } });
    for (const list of Object.values(created)) list.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const suffix = (): string => randomUUID().replaceAll('-', '').slice(0, 12);

  async function hospital(name: string): Promise<string> {
    const row = await prisma.hospital.create({
      data: { publicId: 'hsp_' + randomUUID(), name },
      select: { id: true },
    });
    created.hospitals.push(row.id);
    return row.id;
  }

  async function user(roleCode: 'doctor' | 'admin'): Promise<string> {
    const s = suffix();
    const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
    const row = await prisma.user.create({
      data: {
        publicId: 'usr_s3s' + s,
        firstName: 'Scope',
        lastName: 'Rule',
        displayName: 'Scope Rule ' + roleCode,
        email: `s3s-${s}@patient-scope.fixture.test`,
        phone: '+1 555 010 2223',
        roleId: role.id,
        termsAcceptedAt: new Date(),
        privacyAcceptedAt: new Date(),
      },
      select: { id: true },
    });
    created.users.push(row.id);
    return row.id;
  }

  /** A verified, ACTIVE doctor — clinically usable once employed. */
  async function doctor(): Promise<{ principal: Principal; doctorId: string }> {
    const userId = await user('doctor');
    const s = suffix();
    const departmentId = (
      await prisma.department.findUniqueOrThrow({ where: { name: 'Cardiology' } })
    ).id;
    const row = await prisma.doctor.create({
      data: {
        userId,
        fullName: 'Dr. Scope Rule',
        specialty: 'Internal Medicine',
        licenseNumber: 'MED-S3S' + s,
        contactEmail: `s3s-${s}@doctor.fixture.test`,
        contactPhone: '+1 (555) 010-2223',
        departmentId,
        verificationStatus: 'VERIFIED',
        verifiedAt: new Date(),
      },
      select: { id: true },
    });
    created.doctors.push(row.id);
    return { principal: { userId, roleCode: 'doctor' }, doctorId: row.id };
  }

  async function patient(): Promise<{ id: string; publicId: string }> {
    const s = suffix();
    const row = await prisma.patient.create({
      data: {
        publicId: 'PT-' + s,
        mrn: 's3_' + s,
        fullName: 'S3 Scope Patient',
        dateOfBirth: new Date('1990-01-01'),
        gender: Gender.FEMALE,
        bloodType: BloodType.O_POSITIVE,
        phone: '5550100',
      },
      select: { id: true, publicId: true },
    });
    created.patients.push(row.id);
    return row;
  }

  async function employ(doctorId: string, hospitalId: string, ended = false): Promise<string> {
    const row = await prisma.doctorEmployment.create({
      data: {
        doctorId,
        hospitalId,
        // An explicit past start keeps `ended_at >= started_at` independent of clock skew.
        ...(ended ? { startedAt: new Date(Date.now() - 86_400_000), endedAt: new Date() } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  async function record(patientId: string, hospitalId: string): Promise<string> {
    const row = await prisma.hospitalMedicalRecord.upsert({
      where: { patientId_hospitalId: { patientId, hospitalId } },
      create: { patientId, hospitalId },
      update: {},
      select: { id: true },
    });
    return row.id;
  }

  async function assign(
    patientId: string,
    doctorId: string,
    scoped?: { hospitalId: string; employmentId: string; recordId: string },
  ): Promise<void> {
    await prisma.patientDoctorAssignment.create({
      data: {
        patientId,
        doctorId,
        ...(scoped
          ? {
              hospitalId: scoped.hospitalId,
              doctorEmploymentId: scoped.employmentId,
              hospitalMedicalRecordId: scoped.recordId,
            }
          : {}),
      },
    });
  }

  /** A doctor employed at a fresh hospital, with an owned assignment for a fresh patient. */
  async function owned(): Promise<{
    principal: Principal;
    doctorId: string;
    hospitalId: string;
    employmentId: string;
    recordId: string;
    patient: { id: string; publicId: string };
  }> {
    const { principal, doctorId } = await doctor();
    const hospitalId = await hospital('S3 Hospital A');
    const employmentId = await employ(doctorId, hospitalId);
    const p = await patient();
    const recordId = await record(p.id, hospitalId);
    await assign(p.id, doctorId, { hospitalId, employmentId, recordId });
    return { principal, doctorId, hospitalId, employmentId, recordId, patient: p };
  }

  async function expectRefused(principal: Principal, handle: string): Promise<void> {
    await expect(scope.canReach(principal, handle)).resolves.toBe(false);
    await expect(scope.assertCanReach(principal, handle)).rejects.toMatchObject({
      status: 404,
    });
  }

  it('allows an owned assignment at the active employment, by either handle, with its scope', async () => {
    const f = await owned();

    for (const handle of [f.patient.publicId, f.patient.id]) {
      await expect(scope.assertCanReach(f.principal, handle)).resolves.toEqual({
        doctorId: f.doctorId,
        doctorEmploymentId: f.employmentId,
        hospitalId: f.hospitalId,
        patientId: f.patient.id,
        hospitalMedicalRecordId: f.recordId,
      });
      await expect(assignments.isAssigned(f.principal.userId, handle)).resolves.toBe(true);
    }
  });

  it('denies a legacy assignment with no hospital (#17), and never assigns it one', async () => {
    const { principal, doctorId } = await doctor();
    await employ(doctorId, await hospital('S3 Hospital A'));
    const p = await patient();
    await assign(p.id, doctorId);

    await expectRefused(principal, p.publicId);
    await expect(assignments.isAssigned(principal.userId, p.publicId)).resolves.toBe(false);

    const row = await prisma.patientDoctorAssignment.findFirstOrThrow({
      where: { patientId: p.id, doctorId },
      select: { hospitalId: true, doctorEmploymentId: true, hospitalMedicalRecordId: true },
    });
    expect(row).toEqual({
      hospitalId: null,
      doctorEmploymentId: null,
      hospitalMedicalRecordId: null,
    });
  });

  it('isolates hospitals: an assignment owned by a former hospital is refused at the new one', async () => {
    const { principal, doctorId } = await doctor();
    const a = await hospital('S3 Hospital A');
    const b = await hospital('S3 Hospital B');
    const formerEmployment = await employ(doctorId, a, true);
    const p = await patient();
    await assign(p.id, doctorId, {
      hospitalId: a,
      employmentId: formerEmployment,
      recordId: await record(p.id, a),
    });
    await employ(doctorId, b);

    await expectRefused(principal, p.publicId);
  });

  it('drops access derived from an ended employment even after a rehire at the same hospital (OD-12)', async () => {
    const { principal, doctorId } = await doctor();
    const a = await hospital('S3 Hospital A');
    const ended = await employ(doctorId, a, true);
    const p = await patient();
    await assign(p.id, doctorId, {
      hospitalId: a,
      employmentId: ended,
      recordId: await record(p.id, a),
    });
    await employ(doctorId, a);

    await expectRefused(principal, p.publicId);
  });

  it('denies a doctor whose employment was terminated (no active employment)', async () => {
    const f = await owned();
    await prisma.doctorEmployment.update({
      where: { id: f.employmentId },
      data: { endedAt: new Date() },
    });

    await expectRefused(f.principal, f.patient.publicId);
    await expect(scope.clinicalEmployment(f.principal)).resolves.toBeNull();
  });

  it("denies another doctor's patient at the same hospital", async () => {
    const f = await owned();
    const other = await doctor();
    await employ(other.doctorId, f.hospitalId);

    await expectRefused(other.principal, f.patient.publicId);
  });

  describe('doctor lifecycle (#18)', () => {
    it('keeps clinical access on VACATION', async () => {
      const f = await owned();
      await prisma.doctor.update({
        where: { id: f.doctorId },
        data: { practiceStatus: 'VACATION' },
      });

      await expect(scope.canReach(f.principal, f.patient.publicId)).resolves.toBe(true);
    });

    it.each([
      ['unverified (PENDING)', { verificationStatus: 'PENDING' as const, verifiedAt: null }],
      ['verification rejected', { verificationStatus: 'REJECTED' as const }],
      ['documents requested', { verificationStatus: 'DOCS_REQUESTED' as const }],
      ['SUSPENDED', { practiceStatus: 'SUSPENDED' as const }],
      ['soft-deleted', { deletedAt: new Date() }],
    ])('denies a doctor who is %s', async (_label, change) => {
      const f = await owned();
      await expect(scope.canReach(f.principal, f.patient.publicId)).resolves.toBe(true);

      await prisma.doctor.update({ where: { id: f.doctorId }, data: change });

      await expectRefused(f.principal, f.patient.publicId);
      await expect(scope.clinicalEmployment(f.principal)).resolves.toBeNull();
    });
  });

  it('gives a Hospital Admin of the patient’s hospital no clinical access (OD-07)', async () => {
    const f = await owned();
    const adminUserId = await user('admin');
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    await prisma.hospitalRoleAssignment.create({
      data: { userId: adminUserId, hospitalId: f.hospitalId, roleId: adminRole.id },
    });

    await expectRefused({ userId: adminUserId, roleCode: 'admin' }, f.patient.publicId);
  });

  describe('hospital state: suspended, inactive or deleted hospitals fail closed', () => {
    it.each([
      ['suspended', { status: 'SUSPENDED' }],
      ['inactive', { status: 'INACTIVE' }],
      ['soft-deleted', { deletedAt: new Date() }],
    ] as const)('denies once the hospital is %s', async (_label, change) => {
      const f = await owned();
      await expect(scope.canReach(f.principal, f.patient.publicId)).resolves.toBe(true);

      await prisma.hospital.update({ where: { id: f.hospitalId }, data: change });

      await expectRefused(f.principal, f.patient.publicId);
    });
  });

  // Audit F6 / F7 (#25): inside one request store, a decision always reflects
  // the assignment rows as they are now, whichever handle names the patient.
  describe('assignment changes within one request (F6)', () => {
    it('sees a revocation made earlier in the same request', async () => {
      const f = await owned();

      const [before, after] = await runInRequestScope(async () => {
        const first = await scope.canReach(f.principal, f.patient.publicId);
        await prisma.patientDoctorAssignment.updateMany({
          where: { patientId: f.patient.id, doctorId: f.doctorId },
          data: { revokedAt: new Date() },
        });
        return [first, await scope.canReach(f.principal, f.patient.id)];
      });

      expect(before).toBe(true);
      expect(after).toBe(false);
    });

    it('sees an assignment created earlier in the same request', async () => {
      const { principal, doctorId } = await doctor();
      const hospitalId = await hospital('S3 F6 Hospital');
      const employmentId = await employ(doctorId, hospitalId);
      const p = await patient();
      const recordId = await record(p.id, hospitalId);

      const [before, after] = await runInRequestScope(async () => {
        const first = await scope.canReach(principal, p.publicId);
        await assign(p.id, doctorId, { hospitalId, employmentId, recordId });
        return [first, await scope.canReach(principal, p.publicId)];
      });

      expect(before).toBe(false);
      expect(after).toBe(true);
    });
  });
});
