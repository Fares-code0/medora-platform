import { selectService } from '@/api/seam';

import { httpPrescriptionService } from './http/http-prescription-service';
import { mockPrescriptionService } from './mock/mock-prescription-service';
import type { PrescriptionService } from './model/prescription-service';

/**
 * The pharmacy seam's selection point (FE-10.6) — the only module the
 * feature imports for its data (auth-seam.md §1, rule 3), and the only one
 * that reads the mock flag, through `selectService`.
 */
export const prescriptionService: PrescriptionService = selectService({
  mock: mockPrescriptionService,
  http: httpPrescriptionService,
});
