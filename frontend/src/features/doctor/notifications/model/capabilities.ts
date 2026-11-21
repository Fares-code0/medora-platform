import { selectService } from '@/api/seam';

import type { NotificationServiceCapabilities } from './notification-service';

/**
 * What each adapter supports, as data the screens can read synchronously.
 *
 * The service itself is imported lazily (`service.ts` keeps the seeded
 * corpus out of the entry chunk), so the capabilities live here, beside it:
 * each adapter declares the constant that is its own, and the shell and the
 * page read the selected one without loading either adapter.
 */
export const MOCK_NOTIFICATION_CAPABILITIES: NotificationServiceCapabilities = {
  organize: true,
  remove: true,
  clearRead: true,
  messaging: true,
  preferences: true,
};

/**
 * What the notifications API serves (API §10). Read state, badge counts,
 * archive / favourite / pin, clear-read and preferences — the last three
 * only on `backend` (RM M19.3, M19.4) until it reaches `main`; an API built
 * from `main` answers 404 and the client says the write failed. There is no
 * delete route on any branch, and messaging is not this feature's.
 */
export const HTTP_NOTIFICATION_CAPABILITIES: NotificationServiceCapabilities = {
  organize: true,
  remove: false,
  clearRead: true,
  messaging: false,
  preferences: true,
};

export const notificationCapabilities: NotificationServiceCapabilities = selectService({
  mock: MOCK_NOTIFICATION_CAPABILITIES,
  http: HTTP_NOTIFICATION_CAPABILITIES,
});
