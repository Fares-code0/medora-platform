import { selectService } from '@/api/seam';

import { httpReportsService } from './http/http-reports-service';
import { mockReportsService } from './mock/mock-reports-service';
import type { ReportsService } from './model/reports-service';

/**
 * The reports seam's selection point — the only module the feature imports
 * (`docs/handoff/auth-seam.md` §1, rule 3), and the only one that reads the
 * mock flag (rule 5), through `selectService`.
 *
 * The demo answers from a seeded corpus through `model/selectors.ts`; a live
 * build answers from RM M21's `/reports/*` routes, which only an API built
 * from `backend` serves (`http/http-reports-service.ts`). What the server
 * does not do — rename, favourites, the department/status/medication/lab
 * filters, delivering a schedule — is in `reportsService.capabilities`, and
 * the screens offer only what it allows.
 */
export const reportsService: ReportsService = selectService({
  mock: mockReportsService,
  http: httpReportsService,
});
