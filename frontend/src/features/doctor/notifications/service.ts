import { selectService } from '@/api/seam';

import { httpNotificationService } from './http/http-notification-service';
import { mockNotificationService } from './mock/mock-notification-service';
import type { NotificationService } from './model/notification-service';

/**
 * The notifications seam's selection point (FE-10.8) — the only module the
 * feature imports for its data (`docs/handoff/auth-seam.md` §1, rule 3), and
 * the only one that reads the mock flag for it, through `selectService`.
 *
 * **Keep importing this module dynamically from the query layer.** The shell's
 * bell, sidebar and bottom tab bar all read the badge query, so
 * `api/useNotificationsQuery` is in the entry chunk; a static import of this
 * file there would drag the seeded notification and conversation corpus in
 * with it. What the screens need synchronously — the capabilities — lives in
 * `model/capabilities.ts` for that reason.
 */
export const notificationService: NotificationService = selectService({
  mock: mockNotificationService,
  http: httpNotificationService,
});
