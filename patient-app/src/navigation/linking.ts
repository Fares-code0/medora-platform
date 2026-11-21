import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';

import { isSafeLinkPath } from './link-guard';
import type { RootStackParamList } from './routes';

/**
 * Deep links.
 *
 * The scheme is `medora://` (app.json). These paths are the ones a
 * notification payload will carry when push exists (audit §13, checklist
 * O-04), written now so the navigation tree is shaped to receive them
 * rather than retrofitted later.
 *
 * **No PHI in a link.** A deep link ends up in the OS's notification
 * history, in a lock-screen preview, and sometimes in a log. An id is
 * fine; a name, a diagnosis or a result value is not (checklist O-05).
 *
 * `medora://emergency` is listed first because it is the one link that
 * must resolve whether or not a session exists.
 *
 * ── `getStateFromPath` is overridden, and why ────────────────────────
 *
 * It is the function that parses the query string, through
 * `query-string` and `decode-uri-component` — the one dependency
 * advisory that reaches a patient's phone rather than the build machine
 * (`docs/DEPENDENCIES.md` §4.1, moderate, no fix at any version). A path
 * that fails `isSafeLinkPath` is never handed to it. `link-guard.ts`
 * carries the reasoning.
 */
export const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['medora://'],
  getStateFromPath: (path, options) =>
    isSafeLinkPath(path) ? getStateFromPath(path, options) : undefined,
  config: {
    screens: {
      Emergency: 'emergency',
      Booking: 'book',
      Tabs: {
        screens: {
          HomeTab: { screens: { HomeRoot: 'home' } },
          DiscoverTab: {
            screens: {
              DiscoverRoot: 'doctors',
              DoctorProfile: 'doctors/:doctorId',
              Clinic: 'clinic',
            },
          },
          AppointmentsTab: {
            screens: {
              AppointmentsRoot: 'appointments',
              AppointmentDetail: 'appointments/:appointmentId',
            },
          },
          MessagesTab: {
            screens: { MessagesRoot: 'messages', Thread: 'messages/:conversationId' },
          },
          ProfileTab: {
            screens: {
              ProfileRoot: 'profile',
              HealthRecords: 'records',
              LabResults: 'records/labs',
              Notifications: 'notifications',
            },
          },
        },
      },
    },
  },
};
