import { useCallback, useEffect, useMemo } from 'react';

import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createQueryClient } from '@/api/query-client';
import { ToastProvider } from '@/components';
import { UpgradeGate } from '@/features/app-version/UpgradeGate';
import { BiometricLockGate } from '@/features/auth/components/BiometricLockGate';
import { SessionProvider, useSession } from '@/features/auth/SessionProvider';
import { LocaleProvider } from '@/i18n';
import { linkCoordinator, sessionSnapshot } from '@/navigation/link-resume';
import { RootNavigator } from '@/navigation/RootNavigator';
import { NetworkProvider } from '@/network/NetworkProvider';
import { PhiPrivacyShield } from '@/privacy/PhiPrivacyShield';
import { ThemeProvider, useTheme } from '@/theme';
import { trackScreenView } from '@/utils/analytics';

import { ErrorBoundary } from './ErrorBoundary';
import { PreferenceGate } from './PreferenceGate';

/**
 * The provider stack, and the order it must stay in.
 *
 * ```
 * SafeAreaProvider      insets, needed by Screen and BottomSheet
 *   PreferenceGate      holds the first paint until the stored theme,
 *                       locale and onboarding flag are in memory
 *     LocaleProvider    language and direction — above the theme because
 *                       direction is a layout property, not a colour, and
 *                       nothing below should render before it is known
 *       ThemeProvider   colours — everything below reads them
 *       ErrorBoundary   inside the theme, so its fallback is themed
 *         QueryClient   the cache, needed by SessionProvider's sweep
 *           Network     connectivity
 *             Session   reads QueryClient (clearPhiCache) and wires
 *                       ApiClient's refresh handler
 *               UpgradeGate  W-06 — replaces everything below when the
 *                            operator withdraws this build
 *                 BiometricLockGate  D-15 — replaces the navigator while
 *                                    the opt-in lock is up
 *                   ToastProvider
 *                     ThemedNavigation
 *                     PhiPrivacyShield  T-09 — paints over the tree while
 *                                       the OS photographs the app
 *                       NavigationContainer → RootNavigator
 * ```
 *
 * Five of those are load-bearing rather than arbitrary:
 *
 * - `PreferenceGate` is ABOVE `LocaleProvider` and `ThemeProvider`
 *   because both read the preference store in a `useState` initialiser —
 *   which runs once, at mount. A hydration finishing after that would
 *   paint the wrong palette and the wrong language for a frame, which is
 *   the flash the synchronous port exists to prevent (E-02, P-07).
 *
 * - `ErrorBoundary` is INSIDE `ThemeProvider`. A fallback screen that
 *   renders outside the theme cannot read a colour and would land as
 *   black-on-black in dark mode — a crash screen you cannot read.
 * - `SessionProvider` is INSIDE `QueryClientProvider` because logout,
 *   session loss and the background timeout all sweep the PHI cache, and
 *   it needs the client to do it.
 * - `UpgradeGate` is ABOVE the navigator, so a withdrawn build cannot
 *   sign anyone in — the reason a build gets withdrawn is usually
 *   something about how it handles a session or clinical data, and
 *   letting it authenticate first is letting it do that thing. It is
 *   below `SessionProvider` so a gate tripping mid-session does not pull
 *   the session context out from under the screens beneath it.
 * - `BiometricLockGate` is below `UpgradeGate` — a build the operator
 *   has withdrawn should not be asking anyone for a fingerprint — and it
 *   REPLACES the navigator rather than covering it, because an overlay
 *   leaves the records screen mounted for the OS to photograph on the
 *   way to the task switcher (the T-09 reasoning, applied again).
 * - `PhiPrivacyShield` wraps the navigator rather than sitting beside
 *   it, because it has to paint OVER whatever the navigator is showing
 *   when the OS photographs the app for the task switcher (T-09). It
 *   lives inside `ThemedNavigation` for that reason: the thing it must
 *   cover is the navigator's own output.
 */
/**
 * Owns the OS url events and reports the session to the link coordinator.
 * It sits above `BiometricLockGate` because the container (and its own
 * listener) is unmounted while the lock is up; a link that arrives then
 * must still be held. Renders nothing.
 */
function LinkCapture() {
  const { state, locked } = useSession();
  // The identity binds a held link to one account (see `link-resume.ts`).
  useEffect(() => {
    linkCoordinator.setSession(sessionSnapshot(state, locked));
  }, [state, locked]);
  useEffect(() => linkCoordinator.attach(), []);
  return null;
}

function ThemedNavigation() {
  const theme = useTheme();
  const { state } = useSession();
  const navigation = useNavigationContainerRef();

  // Replay a link that arrived before the session could show it. Tried on
  // every status change and on the unlock remount, because the navigator
  // for the new status mounts in the same commit.
  const resumePending = useCallback(() => {
    if (state.status === 'authenticated' && navigation.isReady()) linkCoordinator.flush();
  }, [navigation, state.status]);
  useEffect(resumePending, [resumePending]);

  // Screen views (W-05). The navigator is the only place that knows what
  // is on screen, and one listener here is the alternative to a `track`
  // call in every screen — which is the arrangement where one screen
  // eventually passes its params along with the name.
  //
  // `trackScreenView` ignores anything outside its reviewed allow-list,
  // so the clinical routes reported here go no further. That check lives
  // there rather than in this callback so there is one list, not two.
  const reportScreen = useCallback(() => {
    const name = navigation.getCurrentRoute()?.name;
    if (name !== undefined) trackScreenView(name);
    // Also the container's readiness hook: after the unlock remount the
    // effect above runs before the container is ready (it awaits the async
    // getInitialURL), so a link held while locked is replayed here instead.
    // `flush` is a no-op with nothing pending and clears the slot when it
    // replays, so the state change it causes cannot replay twice.
    resumePending();
  }, [navigation, resumePending]);


  return (
    <PhiPrivacyShield protecting={state.status === 'authenticated'}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <NavigationContainer
        ref={navigation}
        linking={linkCoordinator.linking}
        onReady={reportScreen}
        onStateChange={reportScreen}
      >
        <RootNavigator />
      </NavigationContainer>
    </PhiPrivacyShield>
  );
}

export function App() {
  // One client for the app's lifetime. Recreating it would drop the
  // cache on every re-render of this component.
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <SafeAreaProvider>
      <PreferenceGate>
        <LocaleProvider>
          <ThemeProvider>
            <ErrorBoundary>
              <QueryClientProvider client={queryClient}>
                <NetworkProvider>
                  <SessionProvider>
                    <LinkCapture />
                    <UpgradeGate>
                      <BiometricLockGate>
                        <ToastProvider>
                          <ThemedNavigation />
                        </ToastProvider>
                      </BiometricLockGate>
                    </UpgradeGate>
                  </SessionProvider>
                </NetworkProvider>
              </QueryClientProvider>
            </ErrorBoundary>
          </ThemeProvider>
        </LocaleProvider>
      </PreferenceGate>
    </SafeAreaProvider>
  );
}
