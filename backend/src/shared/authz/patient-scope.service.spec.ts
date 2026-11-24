import { HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import {
  decidePatientReach,
  type ClinicalEmployment,
  type HospitalPatientScopeRepository,
  type LiveAssignmentScope,
} from './hospital-patient-scope';
import { PatientScopeService } from './patient-scope.service';
import { PLATFORM_ROLES } from './permission-catalogue';
import { runInRequestScope } from './request-scope';
import type { PlatformRole, Principal } from './authz.types';

const HOSPITAL_A = 'hospital-a';
const HOSPITAL_B = 'hospital-b';

function employmentOf(userId: string, hospitalId = HOSPITAL_A): ClinicalEmployment {
  return { doctorId: `doc-${userId}`, doctorEmploymentId: `emp-${userId}`, hospitalId };
}

function ownedBy(employment: ClinicalEmployment, patientId: string): LiveAssignmentScope {
  return {
    patientId: `uuid-${patientId}`,
    hospitalId: employment.hospitalId,
    hospitalMedicalRecordId: `hmr-${patientId}-${employment.hospitalId}`,
    doctorEmploymentId: employment.doctorEmploymentId,
  };
}

/**
 * Owned assignments the test controls, as `doctorUserId → patientIds`. Every
 * doctor named has one clinical employment at hospital A, and every listed
 * assignment is owned by it — the fully hospital-scoped happy path.
 */
class StubAssignments implements HospitalPatientScopeRepository {
  constructor(private readonly links: ReadonlyMap<string, readonly string[]>) {}

  activeClinicalEmployments(doctorUserId: string): Promise<readonly ClinicalEmployment[]> {
    return Promise.resolve(this.links.has(doctorUserId) ? [employmentOf(doctorUserId)] : []);
  }

  liveAssignmentScopes(
    doctorUserId: string,
    patientId: string,
  ): Promise<readonly LiveAssignmentScope[]> {
    const linked = (this.links.get(doctorUserId) ?? []).includes(patientId);
    return Promise.resolve(linked ? [ownedBy(employmentOf(doctorUserId), patientId)] : []);
  }
}

const DOCTOR_A: Principal = { userId: 'dr-a', roleCode: 'doctor' };
const DOCTOR_B: Principal = { userId: 'dr-b', roleCode: 'doctor' };

function serviceWith(links: Record<string, readonly string[]>): PatientScopeService {
  return new PatientScopeService(new StubAssignments(new Map(Object.entries(links))));
}

describe('PatientScopeService — the care relationship', () => {
  let scope: PatientScopeService;

  beforeEach(() => {
    scope = serviceWith({ 'dr-a': ['PT-1001', 'PT-1002'], 'dr-b': ['PT-2001'] });
  });

  it('lets an assigned doctor reach their patient', async () => {
    expect(await scope.canReach(DOCTOR_A, 'PT-1001')).toBe(true);
    await expect(scope.assertCanReach(DOCTOR_A, 'PT-1002')).resolves.toEqual({
      ...employmentOf('dr-a'),
      patientId: 'uuid-PT-1002',
      hospitalMedicalRecordId: `hmr-PT-1002-${HOSPITAL_A}`,
    });
  });

  it("refuses another doctor's patient", async () => {
    expect(await scope.canReach(DOCTOR_A, 'PT-2001')).toBe(false);
    expect(await scope.canReach(DOCTOR_B, 'PT-1001')).toBe(false);
  });

  it('refuses a patient nobody is assigned to', async () => {
    expect(await scope.canReach(DOCTOR_A, 'PT-9999')).toBe(false);
  });

  it('asks the repository with the principal, never with a name', async () => {
    // ADR-003 removed free-text doctor names so care scoping could not
    // be built on them; this asserts the anchor is the user id.
    const repository = new StubAssignments(new Map([['dr-a', ['PT-1001']]]));
    const spy = vi.spyOn(repository, 'liveAssignmentScopes');

    await new PatientScopeService(repository).canReach(DOCTOR_A, 'PT-1001');

    expect(spy).toHaveBeenCalledWith('dr-a', 'PT-1001');
  });
});

describe('PatientScopeService — out of scope is 404, not 403', () => {
  // A 403 confirms the patient exists, so walking PT-1000, PT-1001, …
  // against a 403/404 split would disclose the roster without opening a
  // chart. ADR-022's consequences require this test.
  let scope: PatientScopeService;

  beforeEach(() => {
    scope = serviceWith({ 'dr-a': ['PT-1001'] });
  });

  it('throws 404 for a patient assigned to someone else', async () => {
    try {
      await scope.assertCanReach(DOCTOR_B, 'PT-1001');
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect((error as AppException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect((error as AppException).code).toBe('not_found');
    }
  });

  it('throws the identical error for a patient that does not exist', async () => {
    // The whole point: the two cases must be indistinguishable.
    const mine = await scope.assertCanReach(DOCTOR_B, 'PT-1001').catch((e: unknown) => e);
    const absent = await scope.assertCanReach(DOCTOR_B, 'PT-9999').catch((e: unknown) => e);

    expect((mine as AppException).getStatus()).toBe((absent as AppException).getStatus());
    expect((mine as AppException).message).toBe((absent as AppException).message);
    expect((mine as AppException).code).toBe((absent as AppException).code);
  });

  it('leaks no patient identifier in the refusal', async () => {
    // MG §11.6 — no PHI in error messages.
    try {
      await scope.assertCanReach(DOCTOR_B, 'PT-1001');
      expect.unreachable('expected a refusal');
    } catch (error) {
      const serialized = JSON.stringify({
        message: (error as AppException).message,
        code: (error as AppException).code,
        detail: (error as AppException).detail,
      });

      expect(serialized).not.toContain('PT-1001');
      expect(serialized).not.toContain('dr-b');
    }
  });
});

describe('PatientScopeService — a capability is not a care relationship', () => {
  // Reconciliation §5 rule 5: authorization never asks "is this the
  // admin". patients.view gets an administrator the masked directory,
  // not a chart.
  it('gives no scope to any non-doctor role, however privileged', async () => {
    const scope = serviceWith({ 'u-1': ['PT-1001'] });

    for (const role of PLATFORM_ROLES) {
      const principal: Principal = { userId: 'u-1', roleCode: role };
      const expected = role === 'doctor';

      expect(await scope.canReach(principal, 'PT-1001'), role).toBe(expected);
    }
  });

  it('refuses an administrator even when the assignment row would match', async () => {
    const scope = serviceWith({ 'admin-1': ['PT-1001'] });
    const admin: Principal = { userId: 'admin-1', roleCode: 'admin' };

    await expect(scope.assertCanReach(admin, 'PT-1001')).rejects.toBeInstanceOf(AppException);
  });

  it('never consults a permission set — it takes none', () => {
    // Structural rather than behavioural: `canReach` has no parameter
    // through which a capability could be passed, so no future edit can
    // special-case one without changing the signature.
    expect(PatientScopeService.prototype.canReach.length).toBe(2);
  });
});

describe('PatientScopeService — repository failure', () => {
  it('propagates rather than allowing', async () => {
    // Failing closed: an unreachable assignments table must not become
    // "no restriction applies".
    const failing: HospitalPatientScopeRepository = {
      activeClinicalEmployments: () => Promise.resolve([employmentOf('dr-a')]),
      liveAssignmentScopes: () => Promise.reject(new Error('database down')),
    };
    const scope = new PatientScopeService(failing);

    await expect(scope.canReach(DOCTOR_A, 'PT-1001')).rejects.toThrow('database down');
  });

  it('does not even ask when the role cannot hold a relationship', async () => {
    const failing: HospitalPatientScopeRepository = {
      activeClinicalEmployments: () => Promise.reject(new Error('should not be called')),
      liveAssignmentScopes: () => Promise.reject(new Error('should not be called')),
    };
    const scope = new PatientScopeService(failing);
    const role: PlatformRole = 'reception';

    expect(await scope.canReach({ userId: 'u-1', roleCode: role }, 'PT-1001')).toBe(false);
  });
});

describe('PatientScopeService — repository failure (employment read)', () => {
  it('propagates a failed employment read rather than allowing', async () => {
    const failing: HospitalPatientScopeRepository = {
      activeClinicalEmployments: () => Promise.reject(new Error('database down')),
      liveAssignmentScopes: () => Promise.resolve([ownedBy(employmentOf('dr-a'), 'PT-1001')]),
    };

    await expect(new PatientScopeService(failing).canReach(DOCTOR_A, 'PT-1001')).rejects.toThrow(
      'database down',
    );
  });
});

describe('decidePatientReach — the authoritative hospital-aware rule (S3, #17, #18)', () => {
  const employment = employmentOf('dr-a', HOSPITAL_A);

  it('allows only an assignment owned by the active employment, returning its scope', () => {
    const decision = decidePatientReach(DOCTOR_A, [employment], [ownedBy(employment, 'PT-1')]);

    expect(decision).toEqual({
      allowed: true,
      scope: {
        ...employment,
        patientId: 'uuid-PT-1',
        hospitalMedicalRecordId: `hmr-PT-1-${HOSPITAL_A}`,
      },
    });
  });

  it('denies a legacy assignment with no hospital (#17: unknown ownership is isolated)', () => {
    const legacy: LiveAssignmentScope = {
      patientId: 'uuid-PT-1',
      hospitalId: null,
      hospitalMedicalRecordId: null,
      doctorEmploymentId: null,
    };

    expect(decidePatientReach(DOCTOR_A, [employment], [legacy])).toEqual({
      allowed: false,
      reason: 'assignment_hospital_unassigned',
    });
  });

  it('denies an assignment owned by another hospital (DR-07: never crosses hospitals)', () => {
    const atB = ownedBy(
      { ...employment, hospitalId: HOSPITAL_B, doctorEmploymentId: 'emp-old' },
      'PT-1',
    );

    expect(decidePatientReach(DOCTOR_A, [employment], [atB])).toEqual({
      allowed: false,
      reason: 'cross_hospital_assignment',
    });
  });

  it('denies an assignment at the same hospital under an earlier, ended employment (OD-12)', () => {
    const earlier = ownedBy({ ...employment, doctorEmploymentId: 'emp-ended' }, 'PT-1');

    expect(decidePatientReach(DOCTOR_A, [employment], [earlier])).toEqual({
      allowed: false,
      reason: 'assignment_employment_mismatch',
    });
  });

  it('denies without a clinical employment (terminated, unverified, suspended, deleted; #18)', () => {
    // The repository returns no employment for each of those states; the
    // e2e suite proves each state separately against PostgreSQL.
    expect(decidePatientReach(DOCTOR_A, [], [ownedBy(employment, 'PT-1')])).toEqual({
      allowed: false,
      reason: 'no_clinical_employment',
    });
  });

  it('fails closed on ambiguous employment context (DR-02)', () => {
    const second = employmentOf('dr-a', HOSPITAL_B);

    expect(
      decidePatientReach(DOCTOR_A, [employment, second], [ownedBy(employment, 'PT-1')]),
    ).toEqual({ allowed: false, reason: 'ambiguous_clinical_employment' });
  });

  it('denies when there is no assignment at all', () => {
    expect(decidePatientReach(DOCTOR_A, [employment], [])).toEqual({
      allowed: false,
      reason: 'no_care_assignment',
    });
  });

  it('gives every non-doctor role no clinical access, whatever rows exist (OD-07)', () => {
    for (const role of PLATFORM_ROLES.filter((r) => r !== 'doctor')) {
      expect(
        decidePatientReach(
          { userId: 'dr-a', roleCode: role },
          [employment],
          [ownedBy(employment, 'PT-1')],
        ),
        role,
      ).toEqual({ allowed: false, reason: 'role_has_no_care_relationship' });
    }
  });
});

describe('PatientScopeService — no stale assignment cache (audit F6)', () => {
  it('reads the assignment again on every decision within one request', async () => {
    const repository = new StubAssignments(new Map([['dr-a', ['PT-1001']]]));
    const assignments = vi.spyOn(repository, 'liveAssignmentScopes');
    const employments = vi.spyOn(repository, 'activeClinicalEmployments');
    const scope = new PatientScopeService(repository);

    await runInRequestScope(async () => {
      await scope.canReach(DOCTOR_A, 'PT-1001');
      await scope.canReach(DOCTOR_A, 'PT-1001');
      await scope.clinicalEmployment(DOCTOR_A);
    });

    expect(assignments).toHaveBeenCalledTimes(2);
    // The employment depends only on the caller: read once per request.
    expect(employments).toHaveBeenCalledTimes(1);
  });

  it('sees an assignment created earlier in the same request', async () => {
    const links = new Map<string, string[]>([['dr-a', []]]);
    const scope = new PatientScopeService(new StubAssignments(links));

    await runInRequestScope(async () => {
      expect(await scope.canReach(DOCTOR_A, 'PT-1001')).toBe(false);
      links.get('dr-a')?.push('PT-1001');
      expect(await scope.canReach(DOCTOR_A, 'PT-1001')).toBe(true);
    });
  });
});

describe('PatientScopeService.clinicalEmployment — the S4 list and write scope', () => {
  it('is the one clinical employment of a doctor', async () => {
    expect(await serviceWith({ 'dr-a': [] }).clinicalEmployment(DOCTOR_A)).toEqual(
      employmentOf('dr-a'),
    );
  });

  it('is null without one, when ambiguous, and for every non-doctor role', async () => {
    expect(await serviceWith({}).clinicalEmployment(DOCTOR_A)).toBeNull();

    const ambiguous: HospitalPatientScopeRepository = {
      activeClinicalEmployments: () =>
        Promise.resolve([employmentOf('dr-a'), employmentOf('dr-a', HOSPITAL_B)]),
      liveAssignmentScopes: () => Promise.resolve([]),
    };
    expect(await new PatientScopeService(ambiguous).clinicalEmployment(DOCTOR_A)).toBeNull();

    const scope = serviceWith({ 'u-1': [] });
    for (const role of PLATFORM_ROLES.filter((r) => r !== 'doctor')) {
      expect(await scope.clinicalEmployment({ userId: 'u-1', roleCode: role }), role).toBeNull();
    }
  });
});
