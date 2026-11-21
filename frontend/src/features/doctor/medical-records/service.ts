import { selectService } from '@/api/seam';

import { httpRecordService } from './http/http-record-service';
import { mockRecordService } from './mock/mock-record-service';
import type { RecordService } from './model/record-service';

/**
 * The medical-records seam's selection point (FE-10.5) — the only module the
 * feature imports for its data (`docs/handoff/auth-seam.md` §1, rule 3), and
 * the only one that reads the mock flag, through `selectService`.
 */
export const recordService: RecordService = selectService({
  mock: mockRecordService,
  http: httpRecordService,
});
