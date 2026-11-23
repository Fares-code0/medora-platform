import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import type { HospitalContext } from '../../common/auth/hospital-context';

export const HOSPITAL_CONTEXT_REPOSITORY = Symbol('HOSPITAL_CONTEXT_REPOSITORY');

export interface HospitalContextHospital {
  readonly id: string;
  readonly name: string;
}

export interface HospitalContextRepository {
  activeDoctorEmploymentHospitals(userId: string): Promise<readonly HospitalContextHospital[]>;
  activeHospitalAdminHospitals(userId: string): Promise<readonly HospitalContextHospital[]>;
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
      const hospitals = await this.repository.activeDoctorEmploymentHospitals(user.id);
      if (hospitals.length === 0) {
        return { kind: 'unresolved', reason: 'no_active_employment' };
      }
      if (hospitals.length !== 1) {
        return { kind: 'unresolved', reason: 'ambiguous_active_employment' };
      }
      const hospital = hospitals.at(0);
      if (hospital === undefined) {
        return { kind: 'unresolved', reason: 'no_active_employment' };
      }
      return {
        kind: 'hospital',
        hospitalId: hospital.id,
        hospitalName: hospital.name,
        source: 'doctor_employment',
      };
    }

    if (user.role === 'admin') {
      const hospitals = [
        ...new Map(
          (await this.repository.activeHospitalAdminHospitals(user.id)).map((hospital) => [
            hospital.id,
            hospital,
          ]),
        ).values(),
      ];
      if (hospitals.length > 1) {
        return { kind: 'unresolved', reason: 'ambiguous_hospital_admin_scope' };
      }
      if (hospitals.length === 1) {
        const hospital = hospitals.at(0);
        if (hospital !== undefined) {
          return {
            kind: 'hospital',
            hospitalId: hospital.id,
            hospitalName: hospital.name,
            source: 'hospital_admin_assignment',
          };
        }
      }
      // Existing administrator accounts require deliberate mapping (OD-07).
      // Never infer platform scope from the absence of a hospital assignment.
      return { kind: 'unresolved', reason: 'admin_scope_not_mapped' };
    }

    if (user.role === 'patient') {
      return { kind: 'unresolved', reason: 'resource_required' };
    }

    return { kind: 'unresolved', reason: 'unsupported_role' };
  }
}
