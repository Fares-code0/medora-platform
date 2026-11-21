import { httpInvitationService } from '@/api/endpoints/invitations';
import { selectService } from '@/api/seam';
import type { InvitationService } from '@/types/auth';

import { mockInvitationService } from './mock/mock-invitation-service';

/**
 * The invitation seam's selection (ADR-035 §5), following `service.ts`.
 *
 * The only module `AcceptInvitationPage` imports. Both adapters are
 * imported unconditionally so both typecheck on every build and neither
 * can rot behind the flag.
 */
export const invitationService: InvitationService = selectService({
  mock: mockInvitationService,
  http: httpInvitationService,
});
