import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { apiClient } from '@/api/client';
import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { SessionProvider } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import type { ProfileStackParamList } from '@/navigation/routes';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import type { PatientProfile } from './model/types';
import { ProfileScreen } from './screens/ProfileScreen';
import { profileService } from './service';

/**
 * The profile tab — checklist P-01, P-02, P-08.
 *
 * This screen had no test. Its code was complete and the checklist said
 * so, which is the failure mode `docs/COVERAGE.md` §2 describes: a screen
 * whose behaviour is asserted by reading it.
 *
 * The assertion that earns the file is **P-08**. Sign out is one row in a
 * list of eight, sitting under Security and Help, on a screen a patient
 * scrolls with a thumb. If the row ever logs out directly, nothing else
 * in this suite notices — `logout()` is tested, `ConfirmSheet` is tested,
 * and the wiring between them is exactly the untested part. That is the
 * shape of a mis-tap on a bus, locked out of the appointment details you
 * opened the app to read.
 */

const PROFILE: PatientProfile = {
  displayName: 'Amina Yusuf',
  photoUrl: null,
  fields: [
    {
      id: 'fullName',
      label: 'Full name',
      value: 'Amina Yusuf',
      editable: false,
      ownedBy: 'clinic',
    },
  ],
  linkedToClinicalRecord: true,
};

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
  // Each test signs in, which installs an access token on the shared client.
  apiClient.setAccessToken(null);
  apiClient.setRefreshHandler(null);
  apiClient.setSessionLostHandler(null);
});

/**
 * Only the spies this file installs are restored — `jest.restoreAllMocks()`
 * would also undo the reduce-motion spy `src/test/setup.ts` holds
 * unresolved, and a skeleton would then animate past the end of a test.
 */
function stubProfile(profile: PatientProfile = PROFILE) {
  const spy = jest.spyOn(profileService, 'get').mockResolvedValue(profile);
  installed.push(spy);
  return spy;
}

/**
 * A real `SessionProvider` over a stub `AuthService`, so the logout
 * assertion runs through the session code the button actually calls
 * rather than a mocked context. `authService.logout` is the observable
 * end of it: `SessionProvider.logout()` calls it whenever the session
 * has an access token to name — which a signed-in Profile always does —
 * and sweeps local state whether or not it resolves.
 *
 * The session is signed in, as it is wherever Profile can be reached: a
 * stored refresh token that `refresh` exchanges on boot. This used to
 * render Profile signed out, which only passed while logout called the
 * server even with nothing to authenticate the call (audit M5).
 */
const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-2' },
  identity: {
    subjectId: 'subject-1',
    role: 'patient',
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
    refresh: jest.fn(() => Promise.resolve(SIGNED_IN)),
    logout: jest.fn(() => Promise.resolve()),
    register: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    beginTwoFactorEnrolment: jest.fn(),
    enableTwoFactor: jest.fn(),
    disableTwoFactor: jest.fn(),
  } as unknown as AuthService;
}

async function renderProfile(
  options: { profile?: PatientProfile; reject?: unknown; locale?: 'en' | 'ar' } = {},
) {
  if (options.reject === undefined) stubProfile(options.profile);
  else {
    const spy = jest.spyOn(profileService, 'get').mockRejectedValue(options.reject);
    installed.push(spy);
  }

  const authService = stubAuthService();
  const navigate = jest.fn();
  // The screen reads `navigation.navigate` and nothing else. A full
  // navigator here would test React Navigation rather than this screen.
  const props = {
    navigation: { navigate },
    route: { key: 'p', name: 'ProfileRoot' },
  } as unknown as NativeStackScreenProps<ProfileStackParamList, 'ProfileRoot'>;

  const tokenStorage = createTokenStorage(createInMemorySecureStore());
  await tokenStorage.writeRefreshToken('refresh-1');

  const view = renderWithProviders(
    <SessionProvider authService={authService} tokenStorage={tokenStorage}>
      <ProfileScreen {...props} />
    </SessionProvider>,
    { locale: options.locale ?? 'en' },
  );

  // `SessionProvider` boots by reading the keychain, and that read
  // resolves after the render returns. Left unflushed it lands as a
  // state update outside `act()` in every test in this file.
  await act(async () => undefined);

  return { ...view, authService, navigate };
}

describe('signing out (P-08, R-06)', () => {
  it('does not sign out on the tap — it opens the confirmation', async () => {
    const { getByTestId, authService } = await renderProfile();

    fireEvent.press(getByTestId('profile-logout'));

    expect(getByTestId('profile-logout-confirm')).toBeTruthy();
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('signs out when the confirmation is confirmed', async () => {
    const { getByTestId, authService } = await renderProfile();

    fireEvent.press(getByTestId('profile-logout'));
    fireEvent.press(getByTestId('profile-logout-confirm-confirm'));

    await waitFor(() => expect(authService.logout).toHaveBeenCalledTimes(1));
  });

  it('does not sign out when the confirmation is cancelled', async () => {
    const { getByTestId, queryByTestId, authService } = await renderProfile();

    fireEvent.press(getByTestId('profile-logout'));
    fireEvent.press(getByTestId('profile-logout-confirm-cancel'));

    await waitFor(() => expect(queryByTestId('profile-logout-confirm')).toBeNull());
    expect(authService.logout).not.toHaveBeenCalled();
  });

  it('offers Cancel as well as Sign out, so the sheet is not a one-way door', async () => {
    const { getByTestId } = await renderProfile();

    fireEvent.press(getByTestId('profile-logout'));

    expect(getByTestId('profile-logout-confirm-cancel').props.accessibilityLabel).toBe('Cancel');
    expect(getByTestId('profile-logout-confirm-confirm').props.accessibilityLabel).toBe('Sign out');
  });

  it('says Emergency stays reachable while signed out, because it does (N-01)', async () => {
    const { getByTestId, getByText } = await renderProfile();

    fireEvent.press(getByTestId('profile-logout'));

    // Emergency is a route in the AuthStack, not only behind the gate.
    // A patient deciding whether to sign out is entitled to know that
    // before they decide, not after.
    expect(getByText(/Emergency help stays available/i)).toBeTruthy();
    expect(getByText(/need your password to sign back in/i)).toBeTruthy();
  });
});

describe('the identity header (P-01)', () => {
  it('renders the name once the profile resolves', async () => {
    const { findByText } = await renderProfile();

    expect(await findByText('Amina Yusuf')).toBeTruthy();
  });

  it('says when the account is linked to a clinical record', async () => {
    const { findByText } = await renderProfile();

    expect(await findByText(/Linked to your clinical record/i)).toBeTruthy();
  });

  it('says when it is not, rather than leaving the question open', async () => {
    // An unlinked account is the normal state after registration —
    // ADR-030 §4 creates an account bound to no record, and RA-030.1 (the
    // claim flow) does not exist yet. The screen must not imply a link
    // that is not there.
    const { findByText } = await renderProfile({
      profile: { ...PROFILE, linkedToClinicalRecord: false },
    });

    expect(await findByText(/Not linked to a clinical record/i)).toBeTruthy();
  });

  it('shows no record number either way — the link is a boolean, not an identifier', async () => {
    const { findByText, queryByText } = await renderProfile();

    await findByText('Amina Yusuf');
    expect(queryByText(/PT-/)).toBeNull();
    expect(queryByText(/MRN/i)).toBeNull();
  });
});

describe('the section list (P-02)', () => {
  it('renders the sections and sign out, which sit outside the profile query', async () => {
    // Only the header is inside the AsyncBoundary. Sign out and the
    // section list must not wait on a network call — a patient who cannot
    // load their name must still be able to leave. The proof is the next
    // test; this one is the baseline it is compared against.
    const { getByTestId } = await renderProfile();

    expect(getByTestId('profile-screen')).toBeTruthy();
    expect(getByTestId('profile-logout')).toBeTruthy();
  });

  it('still offers sign out when the profile fails to load', async () => {
    const { getByTestId, authService } = await renderProfile({ reject: new Error('offline') });

    await waitFor(() => expect(getByTestId('profile-logout')).toBeTruthy());
    fireEvent.press(getByTestId('profile-logout'));
    fireEvent.press(getByTestId('profile-logout-confirm-confirm'));

    await waitFor(() => expect(authService.logout).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['profile-to-records', 'HealthRecords'],
    ['profile-to-labs', 'Tests'],
    ['profile-to-insurance', 'Insurance'],
    ['profile-to-edit', 'EditProfile'],
    ['profile-to-notifications', 'Notifications'],
    ['profile-to-preferences', 'Preferences'],
    ['profile-to-security', 'Security'],
    ['profile-to-support', 'Support'],
  ])('navigates from %s to %s', async (testID, destination) => {
    const { getByTestId, navigate } = await renderProfile();

    fireEvent.press(getByTestId(testID));

    expect(navigate).toHaveBeenCalledWith(destination);
  });

  it('puts health records under Profile rather than in a sixth tab (audit §13)', async () => {
    const { getByTestId } = await renderProfile();

    expect(getByTestId('profile-to-records')).toBeTruthy();
  });
});

describe('the sign-out confirmation in Arabic (W-10 translation approval, 2026-11-23)', () => {
  it('says Emergency stays reachable, in Arabic', async () => {
    const { getByTestId, getByText, queryByText } = await renderProfile({ locale: 'ar' });

    fireEvent.press(getByTestId('profile-logout'));

    expect(getByText(/وتبقى «مساعدة طارئة» متاحة أثناء تسجيل خروجك/)).toBeTruthy();
    expect(queryByText(/Emergency help stays available/i)).toBeNull();
  });
});
