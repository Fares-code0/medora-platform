import type { ComponentType, ReactElement } from 'react';

import { AppointmentDetailScreen } from '@/features/appointments/screens/AppointmentDetailScreen';
import { AppointmentsScreen } from '@/features/appointments/screens/AppointmentsScreen';
import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { ConsentScreen } from '@/features/auth/screens/ConsentScreen';
import { SessionUnconfirmedScreen } from '@/features/auth/screens/SessionUnconfirmedScreen';
import { SessionProvider } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import { ClinicScreen } from '@/features/clinic/screens/ClinicScreen';
import { DepartmentScreen } from '@/features/clinic/screens/DepartmentScreen';
import { DiscoverScreen } from '@/features/doctors/screens/DiscoverScreen';
import { DoctorProfileScreen } from '@/features/doctors/screens/DoctorProfileScreen';
import { EmergencyScreen } from '@/features/emergency/screens/EmergencyScreen';
import { DocumentsScreen } from '@/features/health/screens/DocumentsScreen';
import { HealthRecordsScreen } from '@/features/health/screens/HealthRecordsScreen';
import { LabResultsScreen } from '@/features/health/screens/LabResultsScreen';
import { PrescriptionsScreen } from '@/features/health/screens/PrescriptionsScreen';
import { VisitDetailScreen } from '@/features/health/screens/VisitDetailScreen';
import { VisitsScreen } from '@/features/health/screens/VisitsScreen';
import { HomeScreen } from '@/features/home/screens/HomeScreen';
import { MessagesScreen } from '@/features/messages/screens/MessagesScreen';
import { ThreadScreen } from '@/features/messages/screens/ThreadScreen';
import { NotificationPrefsScreen } from '@/features/notifications/screens/NotificationPrefsScreen';
import { NotificationsScreen } from '@/features/notifications/screens/NotificationsScreen';
import { OnboardingScreen } from '@/features/onboarding/screens/OnboardingScreen';
import { EditProfileScreen } from '@/features/profile/screens/EditProfileScreen';
import { PreferencesScreen } from '@/features/profile/screens/PreferencesScreen';
import { PrivacyScreen } from '@/features/profile/screens/PrivacyScreen';
import { ProfileScreen } from '@/features/profile/screens/ProfileScreen';
import { SecurityScreen } from '@/features/profile/screens/SecurityScreen';
import { SupportScreen } from '@/features/support/screens/SupportScreen';
import { createInMemorySecureStore } from '@/storage/secure-store';

/**
 * Every screen that mounts without a navigator, in one list.
 *
 * ── Why a registry rather than a list per test ───────────────────────
 *
 * Two sweeps ask a question of *all* of them — "does a catalogue key or
 * a wire literal reach the screen?" (`i18n/raw-key-leak.test.tsx`) and
 * "is there a heading to land on before the data arrives?"
 * (`screen-headings.test.tsx`) — and a sweep is only as good as its
 * list. Two lists drift: a screen gets added to one and the other keeps
 * passing while covering less, which is the failure mode a sweep is
 * supposed to be immune to. So the list lives here and the sweeps
 * import it.
 *
 * A screen is added by adding a row below. The props are deliberately
 * dumb: these sweeps mount screens, they do not navigate, and spelling
 * out 26 navigator objects would say nothing true about any of them.
 *
 * **`mockNavigation` is exported for the `jest.mock` factory** that each
 * sweep declares for `@react-navigation/native` — seven of these screens
 * reach for `useNavigation` or `useFocusEffect` rather than taking a
 * prop. The name has to start with `mock` for Jest to allow the factory
 * to close over it. Hosting them in a real `NavigationContainer` instead
 * hangs the worker: a native stack drives entry animations on timers
 * that never settle under this renderer.
 */

export const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(() => jest.fn()),
  canGoBack: jest.fn(() => false),
  // A hosted screen is the one on screen. `SessionUnconfirmedScreen` reads
  // it to hold a retry's outcome while Emergency is open (audit M4).
  isFocused: jest.fn(() => true),
};

/* eslint-disable @typescript-eslint/no-explicit-any -- see the docblock:
   the stub props are not the navigator's real types on purpose. */

/**
 * Always three elements, `params` included — `it.each` reads the row
 * length against the callback's arity, and a two-element row makes Jest
 * hand the third parameter a `done` callback nobody calls.
 */
export type HostedScreen = readonly [name: string, screen: ComponentType<any>, params: object];

export const SCREENS: readonly HostedScreen[] = [
  ['Onboarding', OnboardingScreen, {}],
  ['Consent', ConsentScreen, {}],
  ['SessionUnconfirmed', SessionUnconfirmedScreen, {}],
  ['Home', HomeScreen, {}],
  ['Discover', DiscoverScreen, {}],
  ['DoctorProfile', DoctorProfileScreen, { doctorId: 'DR-1' }],
  ['Clinic', ClinicScreen, {}],
  ['Department', DepartmentScreen, { departmentId: 'DEP-1', departmentName: 'Cardiology' }],
  ['Appointments', AppointmentsScreen, {}],
  ['AppointmentDetail', AppointmentDetailScreen, { appointmentId: 'AP-1' }],
  ['HealthRecords', HealthRecordsScreen, {}],
  ['LabResults', LabResultsScreen, {}],
  ['Prescriptions', PrescriptionsScreen, {}],
  ['Documents', DocumentsScreen, {}],
  ['Visits', VisitsScreen, {}],
  ['VisitDetail', VisitDetailScreen, { visitId: 'VS-1' }],
  ['Messages', MessagesScreen, {}],
  ['Thread', ThreadScreen, { conversationId: 'CV-1' }],
  ['Notifications', NotificationsScreen, {}],
  ['NotificationPrefs', NotificationPrefsScreen, {}],
  ['EditProfile', EditProfileScreen, {}],
  ['Preferences', PreferencesScreen, {}],
  ['Security', SecurityScreen, {}],
  ['Privacy', PrivacyScreen, {}],
  ['Profile', ProfileScreen, {}],
  ['Support', SupportScreen, {}],
  ['Emergency', EmergencyScreen, {}],
];

/**
 * A signed-in session, because Home and Profile render the patient's own
 * name and two of the screens read the identity to decide what to show.
 * Boot restores from the seeded refresh token, so no login form is
 * driven here.
 */
const IDENTITY: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  identity: {
    subjectId: 'subject-1',
    displayName: 'Amina Yusuf',
    email: 'amina@example.com',
    emailVerified: true,
  },
};

function stubAuthService(): AuthService {
  return {
    login: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    refresh: jest.fn(() => Promise.resolve(IDENTITY)),
    logout: jest.fn(() => Promise.resolve()),
    register: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
  } as unknown as AuthService;
}

/** The element a sweep renders: the screen, inside a signed-in session. */
export async function hostedScreen([name, Screen, params]: HostedScreen): Promise<ReactElement> {
  const tokenStorage = createTokenStorage(createInMemorySecureStore());
  await tokenStorage.writeRefreshToken('refresh-1');

  return (
    <SessionProvider authService={stubAuthService()} tokenStorage={tokenStorage}>
      <Screen
        navigation={mockNavigation as any}
        route={{ key: `${name}-1`, name, params } as any}
      />
    </SessionProvider>
  );
}

/* eslint-enable @typescript-eslint/no-explicit-any */
