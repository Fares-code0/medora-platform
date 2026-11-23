import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import type { HospitalContext } from '../../../common/auth/hospital-context';
import type { HospitalContextService } from '../../../shared/authz';
import { UserStatus } from '../../../generated/prisma/enums';
import type { IdentityRepository } from '../repositories/identity.repository';
import { SessionUserService } from './session-user.service';

const principal: AuthenticatedUser = {
  id: 'user-1',
  publicId: 'usr_1',
  role: 'doctor',
  permissions: ['patients.view'],
  sessionId: 'session-1',
};

const identityUser = {
  id: 'user-1',
  publicId: 'usr_1',
  displayName: 'Avery Example',
  email: 'avery@example.test',
  status: UserStatus.ACTIVE,
  role: { code: 'doctor' },
};

function service(context: HospitalContext, user: unknown = identityUser) {
  const identity = { findById: vi.fn().mockResolvedValue(user) };
  const forRequest = vi.fn().mockResolvedValue(context);
  const sessions = new SessionUserService(
    identity as unknown as IdentityRepository,
    { forRequest } as unknown as HospitalContextService,
  );
  return {
    current: (who: AuthenticatedUser) => sessions.current(who),
    forRequest,
  };
}

describe('SessionUserService hospital context', () => {
  it('returns doctor activeHospital from the server-derived employment context', async () => {
    const result = await service({
      kind: 'hospital',
      hospitalId: 'hospital-1',
      hospitalName: 'North Hospital',
      source: 'doctor_employment',
    }).current(principal);

    expect(result).toMatchObject({
      activeHospital: { id: 'hospital-1', name: 'North Hospital' },
      adminScope: null,
      role: 'doctor',
      permissions: ['patients.view'],
    });
  });

  it('returns hospital-admin scope without labelling it as a doctor activeHospital', async () => {
    const result = await service({
      kind: 'hospital',
      hospitalId: 'hospital-1',
      hospitalName: 'North Hospital',
      source: 'hospital_admin_assignment',
    }).current(principal);

    expect(result.activeHospital).toBeNull();
    expect(result.adminScope).toEqual({
      type: 'hospital',
      hospital: { id: 'hospital-1', name: 'North Hospital' },
    });
  });

  it('represents explicit platform scope without granting clinical access', async () => {
    const result = await service({
      kind: 'platform',
      clinicalDataAccess: false,
    }).current(principal);

    expect(result.activeHospital).toBeNull();
    expect(result.adminScope).toEqual({ type: 'platform' });
  });

  it('keeps unresolved contexts empty and does not infer a hospital', async () => {
    const result = await service({
      kind: 'unresolved',
      reason: 'admin_scope_not_mapped',
    }).current(principal);

    expect(result.activeHospital).toBeNull();
    expect(result.adminScope).toBeNull();
  });

  it('resolves the context for the authenticated user, with the role the payload reports', async () => {
    const { current, forRequest } = service({ kind: 'unresolved', reason: 'no_active_employment' });

    await current(principal);

    expect(forRequest).toHaveBeenCalledWith({ id: principal.id, role: 'doctor' });
  });

  describe('token role and database role disagree (F3, #23)', () => {
    it('resolves the context for the database role when a doctor token meets an admin row', async () => {
      const { current, forRequest } = service(
        { kind: 'unresolved', reason: 'admin_scope_not_mapped' },
        { ...identityUser, role: { code: 'admin' } },
      );

      const result = await current({ ...principal, role: 'doctor' });

      expect(forRequest).toHaveBeenCalledWith({ id: principal.id, role: 'admin' });
      expect(result.role).toBe('admin');
      // A doctor-employment hospital is never reported alongside role: admin.
      expect(result.activeHospital).toBeNull();
    });

    it('resolves the context for the database role when an admin token meets a doctor row', async () => {
      const { current, forRequest } = service(
        {
          kind: 'hospital',
          hospitalId: 'hospital-1',
          hospitalName: 'North Hospital',
          source: 'doctor_employment',
        },
        { ...identityUser, role: { code: 'doctor' } },
      );

      const result = await current({ ...principal, role: 'admin' });

      expect(forRequest).toHaveBeenCalledWith({ id: principal.id, role: 'doctor' });
      expect(result.role).toBe('doctor');
      expect(result.adminScope).toBeNull();
    });
  });

  it('refuses an inactive account before any hospital-context lookup', async () => {
    const { current, forRequest } = service(
      { kind: 'unresolved', reason: 'no_active_employment' },
      { ...identityUser, status: UserStatus.SUSPENDED },
    );

    await expect(current(principal)).rejects.toMatchObject({ status: 401 });
    expect(forRequest).not.toHaveBeenCalled();
  });
});
