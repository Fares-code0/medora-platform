import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
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

function service() {
  const identity = { findById: vi.fn().mockResolvedValue(identityUser) };
  return new SessionUserService(identity as unknown as IdentityRepository);
}

describe('SessionUserService hospital context', () => {
  it('returns doctor activeHospital from the server-derived employment context', async () => {
    const result = await service().current(principal, {
      kind: 'hospital',
      hospitalId: 'hospital-1',
      hospitalName: 'North Hospital',
      source: 'doctor_employment',
    });

    expect(result).toMatchObject({
      activeHospital: { id: 'hospital-1', name: 'North Hospital' },
      adminScope: null,
      role: 'doctor',
      permissions: ['patients.view'],
    });
  });

  it('returns hospital-admin scope without labelling it as a doctor activeHospital', async () => {
    const result = await service().current(principal, {
      kind: 'hospital',
      hospitalId: 'hospital-1',
      hospitalName: 'North Hospital',
      source: 'hospital_admin_assignment',
    });

    expect(result.activeHospital).toBeNull();
    expect(result.adminScope).toEqual({
      type: 'hospital',
      hospital: { id: 'hospital-1', name: 'North Hospital' },
    });
  });

  it('represents explicit platform scope without granting clinical access', async () => {
    const result = await service().current(principal, {
      kind: 'platform',
      clinicalDataAccess: false,
    });

    expect(result.activeHospital).toBeNull();
    expect(result.adminScope).toEqual({ type: 'platform' });
  });

  it('keeps unresolved contexts empty and does not infer a hospital', async () => {
    const result = await service().current(principal, {
      kind: 'unresolved',
      reason: 'admin_scope_not_mapped',
    });

    expect(result.activeHospital).toBeNull();
    expect(result.adminScope).toBeNull();
  });
});
