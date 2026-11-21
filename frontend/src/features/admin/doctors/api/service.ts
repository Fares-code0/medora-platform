import { selectService } from '@/api/seam';

import { httpDoctorsService } from '../http/http-doctors-service';

import { mockDoctorsService } from './mock-doctors-service';

/** The doctors-management adapter for this build (FE-10.10). */
export const doctorsService = selectService({ mock: mockDoctorsService, http: httpDoctorsService });
