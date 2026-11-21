import { selectService } from '@/api/seam';

import { httpAccessService } from './http/http-access-service';
import { mockAccessService } from './mock-access-service';

/** The users/roles/invitations adapter for this build (FE-10.10). */
export const accessService = selectService({ mock: mockAccessService, http: httpAccessService });
