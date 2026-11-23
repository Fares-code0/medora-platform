import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { HospitalContextService, type HospitalContextRepository } from './hospital-context.service';

const user = (role: string): AuthenticatedUser => ({
  id: 'user-1',
  publicId: 'usr_1',
  role,
  permissions: [],
  sessionId: 'session-1',
});

function serviceWith(overrides: Partial<HospitalContextRepository> = {}): HospitalContextService {
  const repository: HospitalContextRepository = {
    activeDoctorEmploymentHospitals: vi.fn().mockResolvedValue([]),
    activeHospitalAdminHospitals: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return new HospitalContextService(repository);
}

describe('HospitalContextService shadow resolution', () => {
  it('derives doctor context only from one active employment', async () => {
    const activeDoctorEmploymentHospitals = vi
      .fn()
      .mockResolvedValue([{ id: 'hospital-a', name: 'North Hospital' }]);
    const context = await serviceWith({ activeDoctorEmploymentHospitals }).resolve(user('doctor'));

    expect(context).toEqual({
      kind: 'hospital',
      hospitalId: 'hospital-a',
      hospitalName: 'North Hospital',
      source: 'doctor_employment',
    });
    expect(activeDoctorEmploymentHospitals).toHaveBeenCalledWith('user-1');
  });

  it('leaves doctors without active employment unresolved', async () => {
    await expect(serviceWith().resolve(user('doctor'))).resolves.toEqual({
      kind: 'unresolved',
      reason: 'no_active_employment',
    });
  });

  it('does not choose between conflicting active doctor employments', async () => {
    const context = await serviceWith({
      activeDoctorEmploymentHospitals: vi.fn().mockResolvedValue([
        { id: 'hospital-a', name: 'North Hospital' },
        { id: 'hospital-b', name: 'South Hospital' },
      ]),
    }).resolve(user('doctor'));

    expect(context).toEqual({ kind: 'unresolved', reason: 'ambiguous_active_employment' });
  });

  it('derives hospital-admin context from one active hospital assignment', async () => {
    const context = await serviceWith({
      activeHospitalAdminHospitals: vi
        .fn()
        .mockResolvedValue([{ id: 'hospital-a', name: 'North Hospital' }]),
    }).resolve(user('admin'));

    expect(context).toEqual({
      kind: 'hospital',
      hospitalId: 'hospital-a',
      hospitalName: 'North Hospital',
      source: 'hospital_admin_assignment',
    });
  });

  it('deduplicates same-hospital admin assignments and leaves multiple hospitals unresolved', async () => {
    const sameHospital = await serviceWith({
      activeHospitalAdminHospitals: vi.fn().mockResolvedValue([
        { id: 'hospital-a', name: 'North Hospital' },
        { id: 'hospital-a', name: 'North Hospital' },
      ]),
    }).resolve(user('admin'));
    const multipleHospitals = await serviceWith({
      activeHospitalAdminHospitals: vi.fn().mockResolvedValue([
        { id: 'hospital-a', name: 'North Hospital' },
        { id: 'hospital-a', name: 'North Hospital' },
        { id: 'hospital-a', name: 'North Hospital' },
        { id: 'hospital-b', name: 'South Hospital' },
      ]),
    }).resolve(user('admin'));

    expect(sameHospital).toMatchObject({
      kind: 'hospital',
      hospitalId: 'hospital-a',
      hospitalName: 'North Hospital',
    });
    expect(multipleHospitals).toEqual({
      kind: 'unresolved',
      reason: 'ambiguous_hospital_admin_scope',
    });
  });

  it('does not infer platform scope for an unmapped administrator', async () => {
    await expect(serviceWith().resolve(user('admin'))).resolves.toEqual({
      kind: 'unresolved',
      reason: 'admin_scope_not_mapped',
    });
  });

  it('keeps patient context unresolved until a resource is known', async () => {
    await expect(serviceWith().resolve(user('patient'))).resolves.toEqual({
      kind: 'unresolved',
      reason: 'resource_required',
    });
  });
});
