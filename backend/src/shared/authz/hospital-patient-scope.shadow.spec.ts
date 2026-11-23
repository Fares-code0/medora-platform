import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HospitalContext } from '../../common/auth/hospital-context';
import type { Principal } from './authz.types';
import type { HospitalContextService } from './hospital-context.service';
import {
  HospitalPatientScopeShadow,
  type HospitalPatientScopeRepository,
  type LiveAssignmentScope,
} from './hospital-patient-scope.shadow';

const DOCTOR: Principal = { userId: 'dr-1', roleCode: 'doctor' };
const HOSPITAL_A = 'hospital-a';
const HOSPITAL_B = 'hospital-b';

const DOCTOR_AT_A: HospitalContext = {
  kind: 'hospital',
  hospitalId: HOSPITAL_A,
  hospitalName: 'Hospital A',
  source: 'doctor_employment',
};

const SCOPED_AT_A: LiveAssignmentScope = {
  hospitalId: HOSPITAL_A,
  hospitalMedicalRecordId: 'hmr-a',
  doctorEmploymentId: 'emp-a',
  employmentEndedAt: null,
  hospitalActive: true,
};

function shadowWith(
  context: HospitalContext,
  assignments: readonly LiveAssignmentScope[],
): {
  shadow: HospitalPatientScopeShadow;
  forRequest: ReturnType<typeof vi.fn>;
  liveAssignmentScopes: ReturnType<typeof vi.fn>;
} {
  const forRequest = vi.fn().mockResolvedValue(context);
  const liveAssignmentScopes = vi.fn().mockResolvedValue(assignments);
  const repository: HospitalPatientScopeRepository = { liveAssignmentScopes };
  const shadow = new HospitalPatientScopeShadow(
    { forRequest } as unknown as HospitalContextService,
    repository,
  );
  return { shadow, forRequest, liveAssignmentScopes };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('HospitalPatientScopeShadow — the hospital-aware rule', () => {
  it('allows only a fully hospital-scoped assignment at the active employment hospital', async () => {
    const { shadow, forRequest, liveAssignmentScopes } = shadowWith(DOCTOR_AT_A, [SCOPED_AT_A]);

    await expect(shadow.evaluate(DOCTOR, 'PT-1')).resolves.toEqual({
      allowed: true,
      hospitalId: HOSPITAL_A,
    });
    expect(forRequest).toHaveBeenCalledWith({ id: 'dr-1', role: 'doctor' });
    expect(liveAssignmentScopes).toHaveBeenCalledWith('dr-1', 'PT-1');
  });

  it.each([
    ['no_active_employment'],
    ['ambiguous_active_employment'],
    ['resolution_unavailable'],
  ] as const)('fails closed when the doctor context is unresolved (%s)', async (reason) => {
    const { shadow, liveAssignmentScopes } = shadowWith({ kind: 'unresolved', reason }, [
      SCOPED_AT_A,
    ]);

    await expect(shadow.evaluate(DOCTOR, 'PT-1')).resolves.toEqual({ allowed: false, reason });
    expect(liveAssignmentScopes).not.toHaveBeenCalled();
  });

  it('fails closed for a doctor whose context is not a doctor employment', async () => {
    const adminSourced: HospitalContext = { ...DOCTOR_AT_A, source: 'hospital_admin_assignment' };
    const platform: HospitalContext = { kind: 'platform', clinicalDataAccess: false };

    for (const context of [adminSourced, platform]) {
      const { shadow } = shadowWith(context, [SCOPED_AT_A]);
      await expect(shadow.evaluate(DOCTOR, 'PT-1')).resolves.toEqual({
        allowed: false,
        reason: 'context_not_clinical',
      });
    }
  });

  it.each<[string, readonly LiveAssignmentScope[], string]>([
    ['no live assignment', [], 'no_care_assignment'],
    ['two live assignments', [SCOPED_AT_A, SCOPED_AT_A], 'ambiguous_care_assignment'],
    [
      'a legacy assignment with no hospital owner',
      [
        {
          hospitalId: null,
          hospitalMedicalRecordId: null,
          doctorEmploymentId: null,
          employmentEndedAt: null,
          hospitalActive: false,
        },
      ],
      'assignment_hospital_unassigned',
    ],
    [
      'an assignment owned by a suspended, inactive or deleted hospital',
      [{ ...SCOPED_AT_A, hospitalActive: false }],
      'assignment_hospital_inactive',
    ],
    [
      'an assignment owned by another hospital',
      [{ ...SCOPED_AT_A, hospitalId: HOSPITAL_B }],
      'cross_hospital_assignment',
    ],
    [
      'an assignment with no employment binding',
      [{ ...SCOPED_AT_A, doctorEmploymentId: null }],
      'assignment_employment_unassigned',
    ],
    [
      'an assignment bound to an ended employment',
      [{ ...SCOPED_AT_A, employmentEndedAt: new Date('2026-01-01T00:00:00Z') }],
      'assignment_employment_ended',
    ],
    [
      'an assignment with no hospital medical record',
      [{ ...SCOPED_AT_A, hospitalMedicalRecordId: null }],
      'hospital_medical_record_unassigned',
    ],
  ])('fails closed for %s', async (_label, assignments, reason) => {
    const { shadow } = shadowWith(DOCTOR_AT_A, assignments);

    await expect(shadow.evaluate(DOCTOR, 'PT-1')).resolves.toEqual({ allowed: false, reason });
  });

  it.each(['admin', 'patient', 'lab_technician', 'unknown-role'])(
    'gives %s no clinical access without consulting context or assignments',
    async (roleCode) => {
      const { shadow, forRequest, liveAssignmentScopes } = shadowWith(DOCTOR_AT_A, [SCOPED_AT_A]);

      await expect(shadow.evaluate({ userId: 'u-1', roleCode }, 'PT-1')).resolves.toEqual({
        allowed: false,
        reason: 'role_has_no_care_relationship',
      });
      expect(forRequest).not.toHaveBeenCalled();
      expect(liveAssignmentScopes).not.toHaveBeenCalled();
    },
  );
});

describe('HospitalPatientScopeShadow — comparison with the legacy decision', () => {
  it.each<[boolean, readonly LiveAssignmentScope[], string]>([
    [true, [SCOPED_AT_A], 'agree_allow'],
    [false, [], 'agree_deny'],
    [true, [{ ...SCOPED_AT_A, hospitalId: HOSPITAL_B }], 'legacy_allow_shadow_deny'],
    [false, [SCOPED_AT_A], 'legacy_deny_shadow_allow'],
  ])('legacy=%s classifies as the expected outcome', async (legacy, assignments, outcome) => {
    const { shadow } = shadowWith(DOCTOR_AT_A, assignments);

    await expect(shadow.compare(DOCTOR, 'PT-1', legacy)).resolves.toMatchObject({
      legacyAllowed: legacy,
      outcome,
    });
  });

  it('logs divergence with role, outcome and reason only — never the patient id', async () => {
    const debug = vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await shadowWith(DOCTOR_AT_A, [{ ...SCOPED_AT_A, hospitalId: HOSPITAL_B }]).shadow.compare(
      DOCTOR,
      'PT-SECRET-1',
      true,
    );
    await shadowWith(DOCTOR_AT_A, [SCOPED_AT_A]).shadow.compare(DOCTOR, 'PT-SECRET-2', false);

    expect(debug).toHaveBeenCalledWith(
      { outcome: 'legacy_allow_shadow_deny', role: 'doctor', reason: 'cross_hospital_assignment' },
      'Patient scope shadow divergence',
    );
    expect(warn).toHaveBeenCalledWith(
      { outcome: 'legacy_deny_shadow_allow', role: 'doctor' },
      'Patient scope shadow divergence',
    );
    const logged = JSON.stringify([...debug.mock.calls, ...warn.mock.calls]);
    expect(logged).not.toContain('PT-SECRET');
    expect(logged).not.toContain('Hospital A');
  });
});
