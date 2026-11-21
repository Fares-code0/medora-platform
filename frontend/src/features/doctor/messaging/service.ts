import { selectService } from '@/api/seam';

import { httpMessagingService } from './http/http-messaging-service';
import { mockMessagingService } from './mock/mock-messaging-service';
import type { MessagingService } from './model/messaging-service';

/**
 * The messaging seam's selection point — the only module the feature imports
 * (`docs/handoff/auth-seam.md` §1, rule 3), and the only one that reads the
 * mock flag for it, through `selectService`.
 *
 * Live, messaging is **not connected** (FE-10.8 — outside FE-10's scope): the
 * HTTP adapter answers every thread operation as not connected and serves
 * only the unread count, which the notifications API already provides.
 *
 * **Keep importing this module dynamically from the query layer.** The shell's
 * unread badge pulls `api/useMessagingQueries` into the entry chunk, so a
 * static import of this file there would drag the seeded conversation corpus
 * in with it. The indirection moved; the code-splitting property did not.
 */
export const messagingService: MessagingService = selectService({
  mock: mockMessagingService,
  http: httpMessagingService,
});
