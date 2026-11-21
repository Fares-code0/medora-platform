import { HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import { PatientScopeService } from './patient-scope.service';
import { PLATFORM_ROLES } from './permission-catalogue';
import type { PatientAssignmentRepository, PlatformRole, Principal } from './authz.types';

/** Assignments the test controls, as `doctorUserId → patientIds`. */
class StubAssignments implements PatientAssignmentRepository {
  constructor(private readonly links: ReadonlyMap<string, readonly string[]>) {}

  isAssigned(doctorUserId: string, patientId: string): Promise<boolean> {
    return Promise.resolve((this.links.get(doctorUserId) ?? []).includes(patientId));
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
    await expect(scope.assertCanReach(DOCTOR_A, 'PT-1002')).resolves.toBeUndefined();
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
    const spy = vi.spyOn(repository, 'isAssigned');

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
    const failing: PatientAssignmentRepository = {
      isAssigned: () => Promise.reject(new Error('database down')),
    };
    const scope = new PatientScopeService(failing);

    await expect(scope.canReach(DOCTOR_A, 'PT-1001')).rejects.toThrow('database down');
  });

  it('does not even ask when the role cannot hold a relationship', async () => {
    const failing: PatientAssignmentRepository = {
      isAssigned: () => Promise.reject(new Error('should not be called')),
    };
    const scope = new PatientScopeService(failing);
    const role: PlatformRole = 'reception';

    expect(await scope.canReach({ userId: 'u-1', roleCode: role }, 'PT-1001')).toBe(false);
  });
});
