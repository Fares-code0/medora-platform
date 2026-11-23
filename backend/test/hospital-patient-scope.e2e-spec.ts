/**
 * Phase 22 — hospital-aware patient scope in **shadow mode**, on PostgreSQL.
 *
 * Every scenario asserts two things against the real module wiring:
 *
 * 1. the legacy `PatientScopeService` decision — the only one that grants
 *    or refuses access — is exactly what the care-assignment rule gave
 *    before Phase 22 (regression);
 * 2. the shadow hospital-aware decision fails closed on missing,
 *    ambiguous, conflicting or unmapped hospital context, and isolates
 *    hospitals, without being enforced anywhere.
 */

import { randomUUID } from 'node:crypto';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfigModule } from '../src/config';
import { BloodType, Gender } from '../src/generated/prisma/enums';
import { AuthzKernelModule, PatientScopeService, type Principal } from '../src/shared/authz';
import { HospitalPatientScopeShadow } from '../src/shared/authz/hospital-patient-scope.shadow';
import { PrismaService } from '../src/shared/database';

describe('Phase 22 hospital-aware patient scope, shadow mode (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scope: PatientScopeService;
  let shadow: HospitalPatientScopeShadow;

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
    shadow = app.get(HospitalPatientScopeShadow);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const db = prisma.db;
    await db.patientDoctorAssignment.deleteMany({
      where: { OR: [{ doctorId: { in: created.doctors } }, { patientId: { in: created.patients } }] },
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
    const row = await prisma.db.hospital.create({
      data: { publicId: 'hsp_' + randomUUID(), name },
      select: { id: true },
    });
    created.hospitals.push(row.id);
    return row.id;
  }

  async function user(roleCode: 'doctor' | 'admin'): Promise<string> {
    const s = suffix();
    const role = await prisma.db.role.findUniqueOrThrow({ where: { code: roleCode } });
    const row = await prisma.db.user.create({
      data: {
        publicId: 'usr_p22s' + s,
        firstName: 'Shadow',
        lastName: 'Scope',
        displayName: 'Shadow Scope ' + roleCode,
        email: `p22s-${s}@patient-scope.fixture.test`,
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

  async function doctor(): Promise<{ principal: Principal; doctorId: string }> {
    const userId = await user('doctor');
    const s = suffix();
    const departmentId = (
      await prisma.db.department.findUniqueOrThrow({ where: { name: 'Cardiology' } })
    ).id;
    const row = await prisma.db.doctor.create({
      data: {
        userId,
        fullName: 'Dr. Shadow Scope',
        specialty: 'Internal Medicine',
        licenseNumber: 'MED-P22S' + s,
        contactEmail: `p22s-${s}@doctor.fixture.test`,
        contactPhone: '+1 (555) 010-2223',
        departmentId,
      },
      select: { id: true },
    });
    created.doctors.push(row.id);
    return { principal: { userId, roleCode: 'doctor' }, doctorId: row.id };
  }

  async function patient(): Promise<{ id: string; publicId: string }> {
    const s = suffix();
    const row = await prisma.db.patient.create({
      data: {
        publicId: 'PT-' + s,
        mrn: 'p22_' + s,
        fullName: 'Phase 22 Shadow Patient',
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
    const row = await prisma.db.doctorEmployment.create({
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
    const row = await prisma.db.hospitalMedicalRecord.create({
      data: { patientId, hospitalId },
      select: { id: true },
    });
    return row.id;
  }

  async function assign(
    patientId: string,
    doctorId: string,
    scoped?: { hospitalId: string; employmentId: string; recordId: string },
  ): Promise<void> {
    await prisma.db.patientDoctorAssignment.create({
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

  it('is wired into PatientScopeService and observes every canReach call', async () => {
    const spy = vi.spyOn(shadow, 'compare');
    const { principal } = await doctor();
    const p = await patient();

    await expect(scope.canReach(principal, p.publicId)).resolves.toBe(false);

    expect(spy).toHaveBeenCalledWith(principal, p.publicId, false);
  });

  it('agrees to allow a fully hospital-scoped assignment at the active employment hospital', async () => {
    const { principal, doctorId } = await doctor();
    const a = await hospital('P22S Hospital A');
    const employmentId = await employ(doctorId, a);
    const p = await patient();
    await assign(p.id, doctorId, { hospitalId: a, employmentId, recordId: await record(p.id, a) });

    for (const handle of [p.publicId, p.id]) {
      await expect(scope.canReach(principal, handle)).resolves.toBe(true);
      await expect(shadow.compare(principal, handle, true)).resolves.toEqual({
        legacyAllowed: true,
        shadow: { allowed: true, hospitalId: a },
        outcome: 'agree_allow',
      });
    }
  });

  it('keeps legacy access to an unowned legacy assignment, and never guesses its hospital', async () => {
    const { principal, doctorId } = await doctor();
    const a = await hospital('P22S Legacy Hospital');
    await employ(doctorId, a);
    const p = await patient();
    // The patient even has a record at the doctor's hospital; ownership of
    // the legacy assignment is still not inferred from that.
    await record(p.id, a);
    await assign(p.id, doctorId);

    await expect(scope.canReach(principal, p.publicId)).resolves.toBe(true);
    await expect(shadow.compare(principal, p.publicId, true)).resolves.toMatchObject({
      shadow: { allowed: false, reason: 'assignment_hospital_unassigned' },
      outcome: 'legacy_allow_shadow_deny',
    });
  });

  it('isolates hospitals: an assignment from a former hospital is cross-hospital in the shadow', async () => {
    const { principal, doctorId } = await doctor();
    const a = await hospital('P22S Current Hospital');
    const b = await hospital('P22S Former Hospital');
    const former = await employ(doctorId, b, true);
    await employ(doctorId, a);
    const p = await patient();
    await assign(p.id, doctorId, {
      hospitalId: b,
      employmentId: former,
      recordId: await record(p.id, b),
    });

    await expect(scope.canReach(principal, p.publicId)).resolves.toBe(true);
    await expect(shadow.compare(principal, p.publicId, true)).resolves.toMatchObject({
      shadow: { allowed: false, reason: 'cross_hospital_assignment' },
      outcome: 'legacy_allow_shadow_deny',
    });
  });

  it('drops access derived from an ended employment even after a rehire at the same hospital', async () => {
    const { principal, doctorId } = await doctor();
    const a = await hospital('P22S Rehire Hospital');
    const ended = await employ(doctorId, a, true);
    await employ(doctorId, a);
    const p = await patient();
    await assign(p.id, doctorId, {
      hospitalId: a,
      employmentId: ended,
      recordId: await record(p.id, a),
    });

    await expect(scope.canReach(principal, p.publicId)).resolves.toBe(true);
    await expect(shadow.compare(principal, p.publicId, true)).resolves.toMatchObject({
      shadow: { allowed: false, reason: 'assignment_employment_ended' },
    });
  });

  it('fails closed for a doctor with no active employment', async () => {
    const { principal, doctorId } = await doctor();
    const a = await hospital('P22S Ended Hospital');
    const ended = await employ(doctorId, a, true);
    const p = await patient();
    await assign(p.id, doctorId, {
      hospitalId: a,
      employmentId: ended,
      recordId: await record(p.id, a),
    });

    await expect(scope.canReach(principal, p.publicId)).resolves.toBe(true);
    await expect(shadow.compare(principal, p.publicId, true)).resolves.toMatchObject({
      shadow: { allowed: false, reason: 'no_active_employment' },
    });
  });

  it("agrees to deny another doctor's patient at the same hospital", async () => {
    const owner = await doctor();
    const other = await doctor();
    const a = await hospital('P22S Shared Hospital');
    const employmentId = await employ(owner.doctorId, a);
    await employ(other.doctorId, a);
    const p = await patient();
    await assign(p.id, owner.doctorId, {
      hospitalId: a,
      employmentId,
      recordId: await record(p.id, a),
    });

    await expect(scope.canReach(other.principal, p.publicId)).resolves.toBe(false);
    await expect(shadow.compare(other.principal, p.publicId, false)).resolves.toMatchObject({
      shadow: { allowed: false, reason: 'no_care_assignment' },
      outcome: 'agree_deny',
    });
  });

  it('gives a Hospital Admin of the patient’s hospital no clinical access', async () => {
    const adminId = await user('admin');
    const a = await hospital('P22S Admin Hospital');
    const adminRole = await prisma.db.role.findUniqueOrThrow({ where: { code: 'admin' } });
    await prisma.db.hospitalRoleAssignment.create({
      data: { userId: adminId, hospitalId: a, roleId: adminRole.id },
    });
    const p = await patient();
    await record(p.id, a);
    const admin: Principal = { userId: adminId, roleCode: 'admin' };

    await expect(scope.canReach(admin, p.publicId)).resolves.toBe(false);
    await expect(scope.assertCanReach(admin, p.publicId)).rejects.toMatchObject({
      message: 'Patient not found',
    });
    await expect(shadow.compare(admin, p.publicId, false)).resolves.toMatchObject({
      shadow: { allowed: false, reason: 'role_has_no_care_relationship' },
      outcome: 'agree_deny',
    });
  });
});
