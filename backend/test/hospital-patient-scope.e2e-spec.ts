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
import { Logger, type INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConfigModule, ConfigService } from '../src/config';
import { loadEnv } from '../src/config/env';
import { envSchema } from '../src/config/env.schema';
import { BloodType, Gender } from '../src/generated/prisma/enums';
import { AuthzKernelModule, PatientScopeService, type Principal } from '../src/shared/authz';
import {
  HOSPITAL_PATIENT_SCOPE_REPOSITORY,
  HospitalPatientScopeShadow,
  type HospitalPatientScopeRepository,
} from '../src/shared/authz/hospital-patient-scope.shadow';
import { runInRequestScope } from '../src/shared/authz/request-scope';
import { PrismaService } from '../src/shared/database';

describe('Phase 22 hospital-aware patient scope, shadow mode (PostgreSQL)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scope: PatientScopeService;
  let shadow: HospitalPatientScopeShadow;
  let repository: HospitalPatientScopeRepository;

  const created = {
    users: [] as string[],
    doctors: [] as string[],
    patients: [] as string[],
    hospitals: [] as string[],
  };

  beforeAll(async () => {
    // The shadow is opt-in (default off); this suite tests the enabled mode,
    // so it turns the switch on explicitly.
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthzKernelModule],
    })
      .overrideProvider(ConfigService)
      .useFactory({
        factory: () => {
          const real = new ConfigService(loadEnv());
          return new ConfigService({ ...real.env, HOSPITAL_SCOPE_SHADOW_COMPARISON: true });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    scope = app.get(PatientScopeService);
    shadow = app.get(HospitalPatientScopeShadow);
    repository = app.get<HospitalPatientScopeRepository>(HOSPITAL_PATIENT_SCOPE_REPOSITORY);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const db = prisma.db;
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

  // Audit F6 / F7 (#25): inside one request store, a decision always reflects
  // the assignment rows as they are now, whichever handle names the patient.
  describe('assignment changes within one request (F6)', () => {
    async function scopedAssignment(): Promise<{
      principal: Principal;
      doctorId: string;
      patient: { id: string; publicId: string };
      hospitalId: string;
      employmentId: string;
      recordId: string;
    }> {
      const { principal, doctorId } = await doctor();
      const hospitalId = await hospital('P22S F6 Hospital');
      const employmentId = await employ(doctorId, hospitalId);
      const p = await patient();
      const recordId = await record(p.id, hospitalId);
      return { principal, doctorId, patient: p, hospitalId, employmentId, recordId };
    }

    it('sees a revocation made earlier in the same request', async () => {
      const f = await scopedAssignment();
      await assign(f.patient.id, f.doctorId, {
        hospitalId: f.hospitalId,
        employmentId: f.employmentId,
        recordId: f.recordId,
      });

      const [before, after] = await runInRequestScope(async () => {
        const first = await shadow.evaluate(f.principal, f.patient.publicId);
        await prisma.db.patientDoctorAssignment.updateMany({
          where: { patientId: f.patient.id, doctorId: f.doctorId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return [first, await shadow.evaluate(f.principal, f.patient.publicId)];
      });

      expect(before).toEqual({ allowed: true, hospitalId: f.hospitalId });
      expect(after).toEqual({ allowed: false, reason: 'no_care_assignment' });
    });

    it('sees an assignment created earlier in the same request', async () => {
      const f = await scopedAssignment();

      const [before, after] = await runInRequestScope(async () => {
        const first = await shadow.evaluate(f.principal, f.patient.id);
        await assign(f.patient.id, f.doctorId, {
          hospitalId: f.hospitalId,
          employmentId: f.employmentId,
          recordId: f.recordId,
        });
        return [first, await shadow.evaluate(f.principal, f.patient.id)];
      });

      expect(before).toEqual({ allowed: false, reason: 'no_care_assignment' });
      expect(after).toEqual({ allowed: true, hospitalId: f.hospitalId });
    });

    it('answers the same for the public id and the uuid, before and after a revocation', async () => {
      const f = await scopedAssignment();
      await assign(f.patient.id, f.doctorId, {
        hospitalId: f.hospitalId,
        employmentId: f.employmentId,
        recordId: f.recordId,
      });

      await runInRequestScope(async () => {
        for (const handle of [f.patient.publicId, f.patient.id]) {
          await expect(shadow.evaluate(f.principal, handle)).resolves.toMatchObject({
            allowed: true,
          });
        }
        await prisma.db.patientDoctorAssignment.updateMany({
          where: { patientId: f.patient.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        for (const handle of [f.patient.id, f.patient.publicId]) {
          await expect(shadow.evaluate(f.principal, handle)).resolves.toMatchObject({
            allowed: false,
          });
        }
      });
    });

    it('keeps two concurrent requests for two doctors apart', async () => {
      const mine = await scopedAssignment();
      const theirs = await scopedAssignment();
      await assign(mine.patient.id, mine.doctorId, {
        hospitalId: mine.hospitalId,
        employmentId: mine.employmentId,
        recordId: mine.recordId,
      });

      const [a, b] = await Promise.all([
        runInRequestScope(() => shadow.evaluate(mine.principal, mine.patient.publicId)),
        runInRequestScope(() => shadow.evaluate(theirs.principal, mine.patient.publicId)),
      ]);

      expect(a).toMatchObject({ allowed: true });
      expect(b).toMatchObject({ allowed: false });
    });

    it('denies a suspended doctor through the context (F4), whatever the assignment says', async () => {
      const f = await scopedAssignment();
      await assign(f.patient.id, f.doctorId, {
        hospitalId: f.hospitalId,
        employmentId: f.employmentId,
        recordId: f.recordId,
      });
      await prisma.db.doctor.update({
        where: { id: f.doctorId },
        data: { practiceStatus: 'SUSPENDED' },
      });

      await expect(shadow.evaluate(f.principal, f.patient.publicId)).resolves.toEqual({
        allowed: false,
        reason: 'no_active_employment',
      });
    });
  });

  // C1 (#26): the shadow's assignment query runs under a transaction-local
  // statement_timeout (default 250 ms). A real lock held by another
  // transaction blocks it; PostgreSQL must cancel it, the legacy decision must
  // be unaffected, and the setting must not leak to pooled connections.
  //
  // The lock is on `public.hospitals` only — the table the Database timeout
  // suite already locks — and is held for well under a second: table locks
  // on the busier clinical tables deadlocked the RLS-proposal DDL suites that
  // run in parallel against the same database.
  describe('shadow query resource bounds against PostgreSQL (C1)', () => {
    async function scopedFixture(): Promise<{ principal: Principal; publicId: string }> {
      const { principal, doctorId } = await doctor();
      const h = await hospital('P22S C1 Hospital');
      const employmentId = await employ(doctorId, h);
      const p = await patient();
      await assign(p.id, doctorId, {
        hospitalId: h,
        employmentId,
        recordId: await record(p.id, h),
      });
      return { principal, publicId: p.publicId };
    }

    /** Holds ACCESS EXCLUSIVE on `public.hospitals` while `work` runs, then rolls back. */
    async function whileHospitalsLocked<T>(work: () => Promise<T>): Promise<T> {
      let result: { value: T } | undefined;
      await prisma
        .$transaction(
          async (tx) => {
            // Never queue indefinitely behind another suite's DDL.
            await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`);
            await tx.$executeRawUnsafe('LOCK TABLE public.hospitals IN ACCESS EXCLUSIVE MODE');
            result = { value: await work() };
            throw new Error('rollback');
          },
          { timeout: 10_000 },
        )
        .catch((error: unknown) => {
          if (!(error instanceof Error && error.message === 'rollback')) throw error;
        });
      if (result === undefined) throw new Error('work did not run');
      return result.value;
    }

    it('cancels a lock-blocked shadow query within the timeout and leaves no setting behind', async () => {
      const f = await scopedFixture();

      const outcome = await whileHospitalsLocked(async () => {
        const started = Date.now();
        const error = await repository.liveAssignmentScopes(f.principal.userId, f.publicId).then(
          () => null,
          (reason: unknown) => reason,
        );
        return { error, elapsed: Date.now() - started };
      });

      expect(outcome.error).not.toBeNull();
      expect(
        JSON.stringify(outcome.error, Object.getOwnPropertyNames(outcome.error ?? {})),
      ).toMatch(/57014|statement timeout/);
      // 250 ms timeout; generous headroom for a loaded CI runner.
      expect(outcome.elapsed).toBeLessThan(3_000);

      // Unblocked, the same query succeeds — and neither run leaves a
      // statement_timeout on the pooled connections.
      await expect(
        repository.liveAssignmentScopes(f.principal.userId, f.publicId),
      ).resolves.toHaveLength(1);
      for (let i = 0; i < 12; i += 1) {
        const rows = await prisma.$queryRaw<
          { statement_timeout: string }[]
        >`SHOW statement_timeout`;
        expect(rows[0]?.statement_timeout).toBe('0');
      }
    });

    it('answers canReach from the legacy rule while the shadow is blocked, then frees the slot', async () => {
      const f = await scopedFixture();
      const compare = vi.spyOn(shadow, 'compare');
      vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      // The legacy query does not read `hospitals`; the shadow does.
      await whileHospitalsLocked(async () => {
        const started = Date.now();
        await expect(scope.canReach(f.principal, f.publicId)).resolves.toBe(true);
        expect(Date.now() - started).toBeLessThan(1_000);
        expect(shadow.load().inFlight).toBe(1);
      });

      // Settled (timed out or completed once the lock went): the slot is back.
      await expect.poll(() => shadow.load().inFlight, { timeout: 3_000 }).toBe(0);
      expect(compare).toHaveBeenCalledTimes(1);
    });
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

  describe('hospital state: suspended, inactive or deleted hospitals fail closed', () => {
    async function scopedAssignment(): Promise<{
      principal: Principal;
      hospitalId: string;
      patient: { id: string; publicId: string };
    }> {
      const { principal, doctorId } = await doctor();
      const hospitalId = await hospital('P22S Hospital Later Unavailable');
      const employmentId = await employ(doctorId, hospitalId);
      const p = await patient();
      await assign(p.id, doctorId, {
        hospitalId,
        employmentId,
        recordId: await record(p.id, hospitalId),
      });
      return { principal, hospitalId, patient: p };
    }

    it.each([
      ['suspended', { status: 'SUSPENDED' }],
      ['inactive', { status: 'INACTIVE' }],
      ['soft-deleted', { deletedAt: new Date() }],
    ] as const)(
      'keeps legacy access but the shadow denies once the hospital is %s',
      async (_label, change) => {
        const { principal, hospitalId, patient: p } = await scopedAssignment();
        await expect(shadow.compare(principal, p.publicId, true)).resolves.toMatchObject({
          outcome: 'agree_allow',
        });

        await prisma.db.hospital.update({ where: { id: hospitalId }, data: change });

        await expect(scope.canReach(principal, p.publicId)).resolves.toBe(true);
        await expect(shadow.compare(principal, p.publicId, true)).resolves.toMatchObject({
          shadow: { allowed: false, reason: 'no_active_employment' },
          outcome: 'legacy_allow_shadow_deny',
        });
        // The assignment's own hospital flag fails closed too, so the rule
        // does not depend on the context check alone.
        await expect(
          repository.liveAssignmentScopes(principal.userId, p.publicId),
        ).resolves.toEqual([expect.objectContaining({ hospitalId, hospitalActive: false })]);
      },
    );

    it('reports an ACTIVE, non-deleted owning hospital as active', async () => {
      const { principal, hospitalId, patient: p } = await scopedAssignment();

      await expect(repository.liveAssignmentScopes(principal.userId, p.id)).resolves.toEqual([
        expect.objectContaining({ hospitalId, hospitalActive: true }),
      ]);
    });
  });
});

describe('Phase 22 shadow switch off (HOSPITAL_SCOPE_SHADOW_COMPARISON=false)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthzKernelModule],
    })
      .overrideProvider(ConfigService)
      .useFactory({
        factory: () => {
          const real = new ConfigService(loadEnv());
          return new ConfigService({ ...real.env, HOSPITAL_SCOPE_SHADOW_COMPARISON: false });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates no shadow, runs no shadow query, and keeps the legacy decision', async () => {
    expect(app.get(HospitalPatientScopeShadow, { strict: false })).toBeUndefined();
    const repository = app.get<HospitalPatientScopeRepository>(HOSPITAL_PATIENT_SCOPE_REPOSITORY);
    const scopeQuery = vi.spyOn(repository, 'liveAssignmentScopes');
    const scope = app.get(PatientScopeService);

    await expect(
      scope.canReach({ userId: randomUUID(), roleCode: 'doctor' }, 'PT-NOT-ASSIGNED'),
    ).resolves.toBe(false);
    await expect(
      scope.canReach({ userId: randomUUID(), roleCode: 'admin' }, 'PT-NOT-ASSIGNED'),
    ).resolves.toBe(false);
    expect(scopeQuery).not.toHaveBeenCalled();
  });
});

describe('Phase 22 shadow default (HOSPITAL_SCOPE_SHADOW_COMPARISON unset)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The value an unset variable parses to, taken from the schema itself,
    // so a developer's local .env cannot change what this test proves.
    const unsetDefault = envSchema.shape.HOSPITAL_SCOPE_SHADOW_COMPARISON.parse(undefined);
    expect(unsetDefault).toBe(false);
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, AuthzKernelModule],
    })
      .overrideProvider(ConfigService)
      .useFactory({
        factory: () => {
          const real = new ConfigService(loadEnv());
          return new ConfigService({ ...real.env, HOSPITAL_SCOPE_SHADOW_COMPARISON: unsetDefault });
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates no shadow provider and runs no shadow query by default', async () => {
    expect(app.get(HospitalPatientScopeShadow, { strict: false })).toBeUndefined();
    const repository = app.get<HospitalPatientScopeRepository>(HOSPITAL_PATIENT_SCOPE_REPOSITORY);
    const scopeQuery = vi.spyOn(repository, 'liveAssignmentScopes');
    const scope = app.get(PatientScopeService);

    await expect(
      scope.canReach({ userId: randomUUID(), roleCode: 'doctor' }, 'PT-NOT-ASSIGNED'),
    ).resolves.toBe(false);
    await expect(
      scope.assertCanReach({ userId: randomUUID(), roleCode: 'doctor' }, 'PT-NOT-ASSIGNED'),
    ).rejects.toMatchObject({ message: 'Patient not found' });
    await new Promise((done) => setImmediate(done));
    expect(scopeQuery).not.toHaveBeenCalled();
  });
});
