import { selectService } from '@/api/seam';

import { httpOversightService } from '../http/http-oversight-service';

import { mockOversightService } from './mock-oversight-service';

/** The appointment-oversight adapter for this build (FE-10.10). */
export const oversightService = selectService({
  mock: mockOversightService,
  http: httpOversightService,
});
