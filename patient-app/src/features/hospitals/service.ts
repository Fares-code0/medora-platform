import { selectService } from '@/api/seam';

import { fixtureHospitalService } from './fixtures/hospital-fixtures';
import { httpHospitalService } from './http-hospital-service';
import type { HospitalService } from './model/types';

/**
 * Hospital discovery — `GET /patient/hospitals` and `/{id}`
 * (patient-app end-to-end contract §2). It replaces the single-clinic
 * `clinic` feature as the Discover tab's entry point to "where".
 */
export const hospitalService: HospitalService = selectService({
  fixture: fixtureHospitalService,
  http: httpHospitalService,
});
