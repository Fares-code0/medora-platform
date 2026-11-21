import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { SessionProvider } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import { AppTabs } from './AppTabs';

/**
 * The five tabs, and what is on every one of them — checklist U-03,
 * N-01, and the audit's §13 note about which surfaces earn a tab.
 *
 * `navigation.test.tsx` proves the *gate*: signed out lands on Welcome,
 * signed in lands on the shell. It never leaves Home, so four of the five
 * stacks had never been mounted by anything — `AppTabs.tsx` sat at 73.5%
 * with each unvisited navigator uncovered.
 *
 * What that missed is not the tab bar. It is the **header affordance**:
 * `stackOptions` puts Emergency on the header of every stack, and the
 * only way to find a stack that forgot it is to open that stack. N-01
 * requires Emergency within one tap from anywhere in the signed-in app,
 * and "anywhere" is the part a Home-only test cannot check.
 */

const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  identity: {
    subjectId: 'subject-1',
    displayName: 'Sara Ahmed',
    email: 'sara@example.com',
    emailVerified: true,
  },
};

/**
 * A signed-in shell. The Profile tab reads the session for its identity
 * header, so the provider is not optional scaffolding here — it is the
 * state these tabs exist in.
 */
function renderTabs() {
  const authService = {
    refresh: jest.fn(() => Promise.resolve(SIGNED_IN)),
    logout: jest.fn(() => Promise.resolve()),
  } as unknown as AuthService;

  return renderWithProviders(
    <SessionProvider
      authService={authService}
      tokenStorage={createTokenStorage(createInMemorySecureStore())}
    >
      <NavigationContainer>
        <AppTabs />
      </NavigationContainer>
    </SessionProvider>,
  );
}

/**
 * Presses a tab by its label and waits for the screen behind it.
 *
 * The bottom tab bar takes its accessible name from the label text
 * rather than an `accessibilityLabel`, and the same word can appear on
 * the screen above it — Home's quick actions include a "Messages"
 * button. The tab bar renders last, so the last match is the tab.
 */
async function openTab(view: ReturnType<typeof renderTabs>, label: string, screenTestId: string) {
  const matches = view.getAllByText(label);
  await act(async () => {
    fireEvent.press(matches[matches.length - 1]);
  });
  await waitFor(() => expect(view.getByTestId(screenTestId)).toBeTruthy(), { timeout: 10_000 });
}

describe('the five tabs each mount their own stack', () => {
  it('starts on Home', async () => {
    const view = renderTabs();

    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy(), { timeout: 10_000 });
  });

  it.each([
    ['Discover', 'discover-screen'],
    ['Appointments', 'appointments-screen'],
    ['Messages', 'messages-screen'],
    ['Profile', 'profile-screen'],
  ])('opens %s', async (label, testId) => {
    const view = renderTabs();
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy(), { timeout: 10_000 });

    await openTab(view, label, testId);
  });
});

describe('Emergency is on every header (N-01)', () => {
  it.each([
    ['Home', 'home-screen'],
    ['Discover', 'discover-screen'],
    ['Appointments', 'appointments-screen'],
    ['Messages', 'messages-screen'],
    ['Profile', 'profile-screen'],
  ])('is reachable in one tap from %s', async (label, testId) => {
    // One tap from anywhere in the signed-in app. A stack whose
    // `screenOptions` forgot `headerRight` would fail here and nowhere
    // else, because the affordance is per-stack.
    const view = renderTabs();
    await waitFor(() => expect(view.getByTestId('home-screen')).toBeTruthy(), { timeout: 10_000 });

    if (testId !== 'home-screen') await openTab(view, label, testId);

    const buttons = view.getAllByTestId('header-emergency');
    expect(buttons.length).toBeGreaterThan(0);
    // And it says what it does NOT do: the tap opens guidance, it does
    // not place a call (audit R-6).
    expect(String(buttons[0]?.props.accessibilityHint)).toContain('does not place a call');
  });
});
