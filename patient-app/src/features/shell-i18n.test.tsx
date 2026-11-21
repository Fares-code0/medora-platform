import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screen, waitFor } from '@testing-library/react-native';

import { ar, en } from '@/i18n/messages';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import { UpgradeRequiredScreen } from './app-version/UpgradeGate';
import { SessionProvider } from './auth/SessionProvider';
import { createTokenStorage } from './auth/storage';
import { LabResultsScreen } from './health/screens/LabResultsScreen';
import { healthService } from './health/service';
import { NotificationsScreen } from './notifications/screens/NotificationsScreen';
import { notificationService } from './notifications/service';
import { ProfileScreen } from './profile/screens/ProfileScreen';
import { SecurityScreen } from './profile/screens/SecurityScreen';
import { profileService } from './profile/service';
import { SupportScreen } from './support/screens/SupportScreen';

/**
 * The signed-in shell, in Arabic — checklist C-09, feeding S-08.
 *
 * ── One table, for the same reason `list-states.test.tsx` has one ────
 *
 * The question is identical on every screen — *is any English left?* —
 * and a file per screen would be one test copied N times with the
 * component swapped, plus a place for the N+1th screen to be forgotten.
 *
 * Each row asserts **both directions**. Finding the Arabic proves a key
 * is wired; not finding the English proves nothing was left behind, and
 * that second half is the one that catches a migration that missed a
 * line. A screen rendering both would pass a one-sided test.
 *
 * ── What is allowed to still be English ─────────────────────────────
 *
 * Two things, and `messages/en.ts` draws the line: emergency material,
 * and anything telling a patient what to do in a medical emergency.
 * `auth-i18n.test.tsx` pins the first; the support screen's urgent-help
 * card is the second and is pinned below, so that neither can be
 * "tidied up" by someone who reads it as an oversight.
 */

const Stack = createNativeStackNavigator();

/**
 * Screens that take navigation props need a navigator around them, and
 * `ProfileScreen`'s Sign out row needs a session to end.
 */
function renderInNavigator(Component: React.ComponentType<never>) {
  return renderWithProviders(
    <SessionProvider tokenStorage={createTokenStorage(createInMemorySecureStore())}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Subject" component={Component as never} />
        </Stack.Navigator>
      </NavigationContainer>
    </SessionProvider>,
    { locale: 'ar' },
  );
}

describe('Notifications (O-01)', () => {
  it('renders the catalogue and leaves no English behind', async () => {
    jest
      .spyOn(notificationService, 'list')
      .mockResolvedValue({ items: [], totalItems: 0, hasMore: false });

    // In a navigator since 2026-09-09: the screen resolves a
    // notification's deep link through `useNavigation()`.
    renderInNavigator(NotificationsScreen as React.ComponentType<never>);

    await waitFor(() => expect(screen.getByText(ar['notifications.empty.title'])).toBeTruthy());
    expect(screen.getByText(ar['notifications.title'])).toBeTruthy();
    expect(screen.getByText(ar['notifications.noPush'])).toBeTruthy();
    expect(screen.queryByText(en['notifications.empty.title'])).toBeNull();
    expect(screen.queryByText(en['notifications.noPush'])).toBeNull();
  });
});

describe('Profile (P-01)', () => {
  it('renders every row of both sections from the catalogue', async () => {
    jest.spyOn(profileService, 'get').mockResolvedValue({
      displayName: 'Amina Yusuf',
      photoUrl: null,
      fields: [],
      linkedToClinicalRecord: false,
    });

    renderInNavigator(ProfileScreen as React.ComponentType<never>);

    await waitFor(() => expect(screen.getByText(ar['profile.section.health'])).toBeTruthy());
    for (const key of [
      'profile.section.account',
      'profile.healthRecords',
      'profile.personalDetails',
      'profile.signOut',
      'profile.notLinked',
    ] as const) {
      expect(screen.getByText(ar[key])).toBeTruthy();
      expect(screen.queryByText(en[key])).toBeNull();
    }
  });
});

describe('Help and feedback (W-11)', () => {
  it('translates the app-support half of the screen', () => {
    renderWithProviders(<SupportScreen />, { locale: 'ar' });

    expect(screen.getByText(ar['support.title'])).toBeTruthy();
    expect(screen.getByText(ar['support.care.body'])).toBeTruthy();
    expect(screen.queryByText(en['support.care.body'])).toBeNull();
  });

  it('leaves the urgent-medical-help card in English, pending W-10', () => {
    // Deliberate. It tells a patient what to do in a medical emergency,
    // which is clinically reviewed material — the same line drawn around
    // the Emergency affordances in `auth-i18n.test.tsx`.
    renderWithProviders(<SupportScreen />, { locale: 'ar' });

    expect(screen.getByText('If you need urgent medical help')).toBeTruthy();
  });
});

/**
 * The three screens the C-09 sweep of 2026-09-13 migrated.
 *
 * Each was rendering English from a catalogue key that **already
 * existed** — `security.title`, `upgrade.body`,
 * `security.twoFactor.recoveryBody` and ten more were written, shipped in
 * both catalogues, and never read. The prop scan could not see it because
 * the copy was a JSX text child, and `UpgradeGate.tsx` was not scanned at
 * all because it lives directly in its feature directory rather than
 * under `screens/`.
 *
 * They are pinned here, in the file whose docblock warns about "a place
 * for the N+1th screen to be forgotten", because a source scan proves the
 * literal is gone and only a render proves the key is wired to the right
 * place.
 */
describe('Security, in Arabic (P-05, P-06, D-16)', () => {
  it('renders its own heading and all three notices from the catalogue', async () => {
    jest.spyOn(profileService, 'listSessions').mockResolvedValue([]);

    renderWithProviders(<SecurityScreen />, { locale: 'ar' });
    await waitFor(() => expect(screen.getByText(ar['security.title'])).toBeTruthy());

    for (const key of [
      'security.title',
      'security.password.notice',
      'security.twoFactor.blurb',
      'security.protection.body',
    ] as const) {
      expect(screen.getByText(ar[key])).toBeTruthy();
      // The half that catches a migration which missed a line.
      expect(screen.queryByText(en[key])).toBeNull();
    }
  });

  it('translates the password form and the two-factor opt-in it embeds', async () => {
    jest.spyOn(profileService, 'listSessions').mockResolvedValue([]);

    renderWithProviders(<SecurityScreen />, { locale: 'ar' });
    await waitFor(() => expect(screen.getByText(ar['security.title'])).toBeTruthy());

    // `ChangePasswordForm` and `TwoFactorSetup` are components rather than
    // screens, so they are reached through the screen that mounts them.
    expect(screen.getByText(ar['security.changePassword.notice'])).toBeTruthy();
    expect(screen.queryByText(en['security.changePassword.notice'])).toBeNull();
    expect(screen.getByText(ar['security.twoFactor.disableIntro'])).toBeTruthy();
    expect(screen.queryByText(en['security.twoFactor.disableIntro'])).toBeNull();
  });
});

describe('The forced-upgrade wall, in Arabic (W-06)', () => {
  it('translates the one screen a patient cannot navigate away from', () => {
    // It replaces the entire navigator, so an untranslated wall is not a
    // screen an Arabic-speaking patient can get past to find a language
    // switcher. It renders inside `LocaleProvider` — see `App.tsx` — so
    // there was never a reason it could not read the catalogue.
    renderWithProviders(<UpgradeRequiredScreen storeUrl="https://example.test/medora" />, {
      locale: 'ar',
    });

    for (const key of ['upgrade.title', 'upgrade.body', 'upgrade.action'] as const) {
      expect(screen.getByText(ar[key])).toBeTruthy();
      expect(screen.queryByText(en[key])).toBeNull();
    }
  });

  it('translates the no-store-link fallback too', () => {
    renderWithProviders(<UpgradeRequiredScreen storeUrl={null} />, { locale: 'ar' });

    expect(screen.getByText(ar['upgrade.noStoreLink'])).toBeTruthy();
    expect(screen.queryByText(en['upgrade.noStoreLink'])).toBeNull();
  });

  it('leaves the emergency line in English, pending W-10', () => {
    // The same deliberate exception the support screen carries, on the
    // same screen as four strings that are now translated — which is why
    // it is pinned rather than left to read as an oversight.
    renderWithProviders(<UpgradeRequiredScreen />, { locale: 'ar' });

    expect(screen.getByText(/If you need urgent help/)).toBeTruthy();
  });
});

describe('Lab results, in Arabic (J-06)', () => {
  it('translates the row a patient reads a number off', async () => {
    jest.spyOn(healthService, 'listLabOrders').mockResolvedValue([
      {
        id: 'LO-1',
        panelName: 'Lipid panel',
        orderedOn: '2026-02-03T09:00:00.000Z',
        status: 'completed',
        release: 'released',
        resultCount: 1,
      },
    ]);

    renderWithProviders(<LabResultsScreen />, { locale: 'ar' });

    // The collapsed card already read the catalogue; the expanded one
    // duplicated the same line in English. This is the shared key.
    await waitFor(() => expect(screen.getByText(/طُلب في/)).toBeTruthy());
    expect(screen.queryByText(/^Ordered /)).toBeNull();
  });
});
