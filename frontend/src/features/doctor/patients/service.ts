import { selectService } from '@/api/seam';

import { httpDocumentsService } from './http/http-documents-service';
import { httpProfileService } from './http/http-profile-service';
import { mockProfileService } from './mock/mock-profile-service';
import { unconfiguredDocumentsService } from './mock/unconfigured-documents-service';
import type { PatientDocumentsService } from './model/patient-documents-service';
import type { PatientProfileService } from './model/profile-service';

/**
 * The patients feature's selection point — the only module the feature
 * imports (`docs/handoff/auth-seam.md` §1, rule 3), and the only one that
 * reads the mock flag (rule 5), through `selectService`.
 *
 * ## The profile (FE-10.2)
 *
 * Mock or HTTP by the flag. The patients *list* is not here: it is the
 * shared patient directory (`shared-domain/patient-identity`), because the
 * authoring flows' patient pickers read it too.
 *
 * ## Documents: HTTP in live builds, never a mock
 *
 * Live builds talk to API §4.7 (`http/http-documents-service.ts`): a
 * document is opened through its chart and an upload is filed under it
 * (backend PR #158, on this branch since the 2026-10-31 integration). The
 * mock build keeps `unconfiguredDocumentsService`, because the alternative to
 * a real file is a forged one: no seam flag may turn on invented bytes
 * standing in for a patient's consent form, so demo builds say no document
 * service is connected.
 */
export const patientProfileService: PatientProfileService = selectService({
  mock: mockProfileService,
  http: httpProfileService,
});

export const patientDocumentsService: PatientDocumentsService = selectService({
  mock: unconfiguredDocumentsService,
  http: httpDocumentsService,
});
