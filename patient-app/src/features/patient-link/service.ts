import { selectService } from '@/api/seam';

import { fixturePatientLinkService } from './fixtures/fixture-patient-link-service';
import { httpPatientLinkService } from './http-patient-link-service';
import type { PatientLinkService } from './model/types';

/**
 * Account linking (ADR-048). Both routes are live, so the HTTP adapter is
 * real; the fixture is the development stand-in behind the same seam.
 */
export const patientLinkService: PatientLinkService = selectService({
  fixture: fixturePatientLinkService,
  http: httpPatientLinkService,
});
