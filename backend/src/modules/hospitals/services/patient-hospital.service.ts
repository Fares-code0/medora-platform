import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import type { PatientHospitalDetail, PatientHospitalPage } from '../dto/patient-hospital.dto';
import type { PatientHospitalQuery } from '../dto/patient-hospital.schema';
import { PatientHospitalRepository } from '../repositories/patient-hospital.repository';

/** The patient-facing hospital directory (contract §2). Patients only. */
@Injectable()
export class PatientHospitalService {
  constructor(private readonly hospitals: PatientHospitalRepository) {}

  async search(user: AuthenticatedUser, query: PatientHospitalQuery): Promise<PatientHospitalPage> {
    assertPatient(user);
    const { items, totalItems } = await this.hospitals.search(query);
    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async byId(user: AuthenticatedUser, hospitalId: string): Promise<PatientHospitalDetail> {
    assertPatient(user);
    const hospital = await this.hospitals.findById(hospitalId);
    if (hospital === null) throw AppException.notFound('Hospital not found');
    return hospital;
  }
}

function assertPatient(user: AuthenticatedUser): void {
  if (user.role !== 'patient') {
    throw AppException.forbidden('This route is available to patient accounts only', 'patient_only');
  }
}
