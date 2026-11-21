import { selectService } from '@/api/seam';

import { httpLabService } from './http/http-lab-service';
import { mockLabService } from './mock/mock-lab-service';
import type { LabService } from './model/lab-service';

/**
 * The laboratory seam's selection point (FE-10.7) — the only module the
 * feature imports for its data (`docs/handoff/auth-seam.md` §1, rule 3), and
 * the only one that reads the mock flag, through `selectService`.
 */
export const labService: LabService = selectService({
  mock: mockLabService,
  http: httpLabService,
});
