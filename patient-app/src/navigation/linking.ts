import { getStateFromPath, type LinkingOptions } from '@react-navigation/native';

import { isSafeLinkPath } from './link-guard';
import type { AuthStackParamList, RootStackParamList } from './routes';

/**
 * The root table plus the one signed-out route a link may open.
 *
 * `ResetPassword` exists only in `AuthStack`, which is the root navigator
 * while signed out. Signed in (or `unconfirmed`), the navigator on screen
 * has no route of that name, so React Navigation drops the link and the
 * patient stays where they were: "only while signed out" is the route
 * table's own shape, not a check someone could forget.
 */
type LinkableParamList = RootStackParamList & Pick<AuthStackParamList, 'ResetPassword'>;

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
 *
 * ── `reset-password`, and why `verify-email` is not here ─────────────
 *
 * `medora://reset-password?token=…` opens `ResetPasswordScreen` with the
 * token in the field (query parameters become route params; there is no
 * `:token` path segment). Signed out only — see `LinkableParamList` —
 * and never submitted: the patient still chooses the password and
 * presses the button. The backend's emails link to the web app over
 * https, not to this scheme, and no universal link / App Link is
 * configured, so nothing produces this link yet (checklist D-17).
 *
 * `verify-email` is deliberately absent. The backend's link carries a
 * token for `POST /auth/verify-email`, but this app's `VerifyEmail`
 * route is the "check your inbox" screen and takes an address; no screen
 * here consumes a verification token, and mapping the link onto that
 * route would render it without the address it needs. A consuming
 * screen is new product work, not a link-table entry.
 */
const table: LinkingOptions<LinkableParamList> = {
  prefixes: ['medora://'],
  getStateFromPath: (path, options) =>
    isSafeLinkPath(path) ? getStateFromPath(path, options) : undefined,
  config: {
    screens: {
      Emergency: 'emergency',
      ResetPassword: 'reset-password',
      Booking: 'book',
      Tabs: {
        screens: {
          HomeTab: { screens: { HomeRoot: 'home' } },
          DiscoverTab: {
            screens: {
              DiscoverRoot: 'doctors',
              DoctorProfile: 'doctors/:doctorId',
              Clinic: 'clinic',
              Hospitals: 'hospitals',
              Hospital: 'hospitals/:hospitalId',
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
              Tests: 'records/labs',
              Insurance: 'records/insurance',
              Notifications: 'notifications',
            },
          },
        },
      },
    },
  },
};

/**
 * Typed for the container, whose param list is the signed-in root's
 * (`ReactNavigation.RootParamList`). The one widening is `ResetPassword`,
 * explained on `LinkableParamList`; the table above is checked against it.
 */
export const linking = table as unknown as LinkingOptions<RootStackParamList>;
