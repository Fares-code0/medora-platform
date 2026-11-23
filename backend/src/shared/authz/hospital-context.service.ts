import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { HospitalContext } from '../../common/auth/hospital-context';

export const HOSPITAL_CONTEXT_REPOSITORY = Symbol('HOSPITAL_CONTEXT_REPOSITORY');

export interface HospitalContextRepository {
  activeDoctorEmploymentHospitalIds(userId: string): Promise<readonly string[]>;
  activeHospitalAdminHospitalIds(userId: string): Promise<readonly string[]>;
}

/** Resolves observations only; this service is not an authorization gate. */
@Injectable()
export class HospitalContextService {
  constructor(
    @Inject(HOSPITAL_CONTEXT_REPOSITORY)
    private readonly repository: HospitalContextRepository,
  ) {}

  async resolve(user: AuthenticatedUser): Promise<HospitalContext> {
    if (user.role === 'doctor') {
      const hospitalIds = await this.repository.activeDoctorEmploymentHospitalIds(user.id);
      if (hospitalIds.length === 0) {
        return { kind: 'unresolved', reason: 'no_active_employment' };
      }
      if (hospitalIds.length !== 1) {
        return { kind: 'unresolved', reason: 'ambiguous_active_employment' };
      }
      const hospitalId = hospitalIds.at(0);
      if (hospitalId === undefined) {
        return { kind: 'unresolved', reason: 'no_active_employment' };
      }
      return { kind: 'hospital', hospitalId, source: 'doctor_employment' };
    }

    if (user.role === 'admin') {
      const hospitalIds = [
        ...new Set(await this.repository.activeHospitalAdminHospitalIds(user.id)),
      ];
      if (hospitalIds.length > 1) {
        return { kind: 'unresolved', reason: 'ambiguous_hospital_admin_scope' };
      }
      if (hospitalIds.length === 1) {
        const hospitalId = hospitalIds.at(0);
        if (hospitalId !== undefined) {
          return { kind: 'hospital', hospitalId, source: 'hospital_admin_assignment' };
        }
      }
      // The existing `admin` role is the platform administrator role.
      // A hospital assignment overrides this observation only for its
      // explicitly assigned hospital; this does not grant clinical access.
      return { kind: 'platform', clinicalDataAccess: false };
    }

    if (user.role === 'patient') {
      return { kind: 'unresolved', reason: 'resource_required' };
    }

    return { kind: 'unresolved', reason: 'unsupported_role' };
  }
}
