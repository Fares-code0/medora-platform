import { useCallback, useEffect, type ReactNode } from 'react';

import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components';
import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { SessionProvider, useSession } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import { markOnboardingSeen } from '@/features/onboarding/seen';
import { LocaleProvider } from '@/i18n';
import { NetworkProvider } from '@/network/NetworkProvider';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { ThemeProvider } from '@/theme';

import {
  classifyLink,
  createLinkCoordinator,
  PENDING_LINK_TTL_MS,
  sessionSnapshot,
  type LinkCoordinator,
  type LinkSource,
} from './link-resume';
import { RootNavigator } from './RootNavigator';

const TARGET = 'medora://notifications';
const TARGET_TESTID = 'notifications-screen';
/** Two accounts on one phone. */
const A = 'subject-1';
const B = 'subject-2';

const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  identity: {
    subjectId: 'subject-1',
    role: 'patient',
    displayName: 'Sara Ahmed',
    email: 'sara@example.com',
    emailVerified: true,
  },
};

function fakeSource(initial: string | null = null) {
  let handler: ((event: { url: string }) => void) | null = null;
  const source: LinkSource = {
    getInitialURL: jest.fn(() => Promise.resolve(initial)),
    addEventListener: (_type, h) => {
      handler = h;
      return {
        remove: () => {
          handler = null;
        },
      };
    },
  };
  return { source, emit: (url: string) => handler?.({ url }) };
}

describe('classifyLink', () => {
  it.each([
    ['medora://emergency', 'signed-out-ok'],
    ['medora://reset-password?token=abc', 'signed-out-ok'],
    ['medora://notifications', 'protected'],
    ['medora://appointments/appt-1', 'protected'],
    ['medora://book', 'protected'],
    ['medora://nowhere', 'invalid'],
    ['medora://appointments/%E0%A4%A', 'invalid'],
    ['https://example.com/x', 'foreign'],
  ])('%s is %s', (url, kind) => {
    expect(classifyLink(url)).toBe(kind);
  });
});

describe('the coordinator', () => {
  function setup(initial: string | null = null, now: () => number = () => 0) {
    const fake = fakeSource(initial);
    const coordinator = createLinkCoordinator({ source: fake.source, now });
    const listener = jest.fn();
    const unsubscribe = coordinator.linking.subscribe?.(listener);
    const detach = coordinator.attach();
    return { ...fake, coordinator, listener, unsubscribe, detach };
  }

  it('holds a protected warm link while signed out and replays it once after sign-in', () => {
    const t = setup();
    t.coordinator.setSession({ status: 'unauthenticated', locked: false });
    t.emit(TARGET);
    expect(t.listener).not.toHaveBeenCalled();
    expect(t.coordinator.hasPending()).toBe(true);

    t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
    expect(t.coordinator.flush()).toBe(true);
    expect(t.coordinator.flush()).toBe(false);
    expect(t.listener).toHaveBeenCalledTimes(1);
    expect(t.listener).toHaveBeenCalledWith(TARGET);
  });

  it.each(['booting', 'unconfirmed'] as const)('holds a link that arrives while %s', (status) => {
    const t = setup();
    t.coordinator.setSession({ status, locked: false });
    t.emit(TARGET);
    t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
    expect(t.coordinator.flush()).toBe(true);
    expect(t.listener).toHaveBeenCalledWith(TARGET);
  });

  it('holds a link that arrives while locked, and does not replay until unlocked', () => {
    const t = setup();
    t.coordinator.setSession({ status: 'authenticated', locked: true, subjectId: A });
    t.emit(TARGET);
    expect(t.coordinator.flush()).toBe(false);
    t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
    expect(t.coordinator.flush()).toBe(true);
  });

  it('delivers a protected link at once when already signed in and unlocked', () => {
    const t = setup();
    t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
    t.emit(TARGET);
    expect(t.listener).toHaveBeenCalledWith(TARGET);
    expect(t.coordinator.hasPending()).toBe(false);
  });

  it('passes signed-out-valid links straight through, never storing them', () => {
    const t = setup();
    t.coordinator.setSession({ status: 'unauthenticated', locked: false });
    t.emit('medora://reset-password?token=abc');
    t.emit('medora://emergency');
    expect(t.listener).toHaveBeenCalledTimes(2);
    expect(t.coordinator.hasPending()).toBe(false);
  });

  it('discards the pending link when the session ends', () => {
    const t = setup();
    t.coordinator.setSession({ status: 'authenticated', locked: true, subjectId: A });
    t.emit(TARGET);
    t.coordinator.setSession({ status: 'unauthenticated', locked: false });
    expect(t.coordinator.hasPending()).toBe(false);
    t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
    expect(t.coordinator.flush()).toBe(false);
    expect(t.listener).not.toHaveBeenCalled();
  });

  it('keeps a link across booting to unauthenticated (it is not a sign-out)', () => {
    const t = setup();
    t.emit(TARGET);
    t.coordinator.setSession({ status: 'unauthenticated', locked: false });
    expect(t.coordinator.hasPending()).toBe(true);
  });

  it('ignores unsafe and unmatched links', () => {
    const t = setup();
    t.coordinator.setSession({ status: 'unauthenticated', locked: false });
    t.emit('medora://appointments/%E0%A4%A');
    t.emit('medora://nowhere');
    expect(t.coordinator.hasPending()).toBe(false);
    expect(t.listener).not.toHaveBeenCalled();
  });

  it('expires a pending link after the TTL', () => {
    let clock = 0;
    const t = setup(null, () => clock);
    t.emit(TARGET);
    t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
    clock = PENDING_LINK_TTL_MS + 1;
    expect(t.coordinator.flush()).toBe(false);
    expect(t.listener).not.toHaveBeenCalled();
    expect(t.coordinator.hasPending()).toBe(false);
  });

  it('keeps the newest link only', () => {
    const t = setup();
    t.emit('medora://notifications');
    t.emit('medora://appointments/appt-9');
    t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
    t.coordinator.flush();
    expect(t.listener).toHaveBeenCalledTimes(1);
    expect(t.listener).toHaveBeenCalledWith('medora://appointments/appt-9');
  });

  describe('binding a held link to one account', () => {
    it('replays a link held while locked when the same subject unlocks', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'authenticated', locked: true, subjectId: A });
      t.emit(TARGET);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      expect(t.coordinator.flush()).toBe(true);
      expect(t.listener).toHaveBeenCalledWith(TARGET);
    });

    it('drops a link held while locked when a different subject becomes authenticated', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'authenticated', locked: true, subjectId: A });
      t.emit(TARGET);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: B });
      expect(t.coordinator.hasPending()).toBe(false);
      expect(t.coordinator.flush()).toBe(false);
      expect(t.listener).not.toHaveBeenCalled();
    });

    it('drops a link held while locked when that session is signed out and another signs in', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'authenticated', locked: true, subjectId: A });
      t.emit(TARGET);
      t.coordinator.setSession({ status: 'unauthenticated', locked: false, ended: true });
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: B });
      expect(t.coordinator.flush()).toBe(false);
      expect(t.listener).not.toHaveBeenCalled();
    });

    it('clears on explicit logout, including a logout from unconfirmed', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'unconfirmed', locked: false });
      t.emit(TARGET);
      expect(t.coordinator.hasPending()).toBe(true);
      t.coordinator.setSession({ status: 'unauthenticated', locked: false, ended: true });
      expect(t.coordinator.hasPending()).toBe(false);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      expect(t.coordinator.flush()).toBe(false);
    });

    it('clears on session loss mid-session', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      // The container is not mounted, so the link is held for A.
      t.unsubscribe?.();
      t.emit(TARGET);
      expect(t.coordinator.hasPending()).toBe(true);
      t.coordinator.setSession({ status: 'unauthenticated', locked: false, ended: true });
      expect(t.coordinator.hasPending()).toBe(false);
    });

    it('clears when the stored session is refused during boot', () => {
      const t = setup();
      t.emit(TARGET);
      t.coordinator.setSession({ status: 'unauthenticated', locked: false, ended: true });
      expect(t.coordinator.hasPending()).toBe(false);
    });

    it('replays a signed-out link for the sign-in that immediately follows', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'unauthenticated', locked: false });
      t.emit(TARGET);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: B });
      expect(t.coordinator.flush()).toBe(true);
      expect(t.listener).toHaveBeenCalledWith(TARGET);
    });

    it('replays a signed-out link when the same subject signs back in after a logout', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      t.coordinator.setSession({ status: 'unauthenticated', locked: false, ended: true });
      t.emit(TARGET);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      expect(t.coordinator.flush()).toBe(true);
    });

    it('drops a signed-out link when a different subject signs in than the one last known', () => {
      const t = setup();
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      t.coordinator.setSession({ status: 'unauthenticated', locked: false, ended: true });
      t.emit(TARGET);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: B });
      expect(t.coordinator.hasPending()).toBe(false);
      expect(t.coordinator.flush()).toBe(false);
      expect(t.listener).not.toHaveBeenCalled();
    });

    it('binds a link held during boot to the restored subject, and drops it for any other', () => {
      const t = setup();
      t.emit(TARGET);
      // The restore lands behind the biometric lock: the link is now A's.
      t.coordinator.setSession({ status: 'authenticated', locked: true, subjectId: A });
      expect(t.coordinator.hasPending()).toBe(true);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: B });
      expect(t.coordinator.hasPending()).toBe(false);
      expect(t.listener).not.toHaveBeenCalled();
    });

    it('still enforces the TTL on a link bound to a locked session', () => {
      let clock = 0;
      const t = setup(null, () => clock);
      t.coordinator.setSession({ status: 'authenticated', locked: true, subjectId: A });
      t.emit(TARGET);
      clock = PENDING_LINK_TTL_MS + 1;
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      expect(t.coordinator.flush()).toBe(false);
      expect(t.coordinator.hasPending()).toBe(false);
      expect(t.listener).not.toHaveBeenCalled();
    });
  });

  describe('sessionSnapshot', () => {
    it('carries the subject when authenticated', () => {
      expect(
        sessionSnapshot({ status: 'authenticated', identity: SIGNED_IN.identity }, true),
      ).toEqual({ status: 'authenticated', locked: true, subjectId: 'subject-1' });
    });

    it('marks an unauthenticated state with a reason as ended, and one without as not', () => {
      expect(sessionSnapshot({ status: 'unauthenticated', reason: 'signed-out' }, false)).toEqual({
        status: 'unauthenticated',
        locked: false,
        ended: true,
      });
      expect(sessionSnapshot({ status: 'unauthenticated' }, false)).toEqual({
        status: 'unauthenticated',
        locked: false,
        ended: false,
      });
    });
  });

  describe('the initial URL', () => {
    it('is returned once, then never again', async () => {
      const t = setup('medora://emergency');
      expect(await t.coordinator.linking.getInitialURL?.()).toBe('medora://emergency');
      expect(await t.coordinator.linking.getInitialURL?.()).toBeUndefined();
    });

    it('is held, not returned, when protected and the session cannot show it', async () => {
      const t = setup(TARGET);
      t.coordinator.setSession({ status: 'booting', locked: false });
      expect(await t.coordinator.linking.getInitialURL?.()).toBeUndefined();
      expect(t.coordinator.hasPending()).toBe(true);
    });

    it('is returned when protected and the session is authenticated', async () => {
      const t = setup(TARGET);
      t.coordinator.setSession({ status: 'authenticated', locked: false, subjectId: A });
      expect(await t.coordinator.linking.getInitialURL?.()).toBe(TARGET);
      expect(t.coordinator.hasPending()).toBe(false);
    });

    it('is ignored when unsafe', async () => {
      const t = setup('medora://appointments/%E0%A4%A');
      expect(await t.coordinator.linking.getInitialURL?.()).toBeUndefined();
      expect(t.coordinator.hasPending()).toBe(false);
    });
  });
});

// ---- integration: the same wiring App.tsx uses, over the real navigators ----

let session: ReturnType<typeof useSession> | null = null;

function authService(): AuthService {
  return {
    refresh: jest.fn(() => Promise.resolve(SIGNED_IN)),
    logout: jest.fn(() => Promise.resolve()),
  } as unknown as AuthService;
}

// A sibling ahead of the navigation, exactly as `LinkCapture` sits in App.tsx,
// so its effects run before the navigation's.
function Capture({
  coordinator,
  lockedByTest,
}: {
  coordinator: LinkCoordinator;
  lockedByTest: boolean;
}) {
  const s = useSession();
  session = s;
  useEffect(() => {
    coordinator.setSession(sessionSnapshot(s.state, lockedByTest));
  }, [coordinator, s.state, lockedByTest]);
  useEffect(() => coordinator.attach(), [coordinator]);
  return null;
}

function Nav({ coordinator }: { coordinator: LinkCoordinator }) {
  const { state } = useSession();
  const navigation = useNavigationContainerRef();
  // Mirrors bootstrap/App.tsx exactly: an effect gated on status, plus the
  // container's onReady/onStateChange. The effect alone is not enough —
  // after the unlock remount it runs before the container is ready, and
  // only onReady then replays a link held while locked.
  const resume = useCallback(() => {
    if (state.status === 'authenticated' && navigation.isReady()) coordinator.flush();
  }, [coordinator, navigation, state.status]);
  useEffect(resume, [resume]);
  return (
    <NavigationContainer
      ref={navigation}
      linking={coordinator.linking}
      onReady={resume}
      onStateChange={resume}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}

function Tree({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <LocaleProvider>
        <ThemeProvider initialMode="light">
          <QueryClientProvider
            client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
          >
            <NetworkProvider>
              <ToastProvider>{children}</ToastProvider>
            </NetworkProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}

async function mount(opts: { initial?: string | null; stored?: boolean; locked?: boolean }) {
  const fake = fakeSource(opts.initial ?? null);
  const coordinator = createLinkCoordinator({ source: fake.source });
  const tokenStorage = createTokenStorage(createInMemorySecureStore());
  if (opts.stored === true) await tokenStorage.writeRefreshToken('refresh-1');
  const element = (locked: boolean) => (
    <Tree>
      <SessionProvider authService={authService()} tokenStorage={tokenStorage}>
        <Capture coordinator={coordinator} lockedByTest={locked} />
        {locked ? null : <Nav coordinator={coordinator} />}
      </SessionProvider>
    </Tree>
  );
  const view = render(element(opts.locked ?? false));
  return { ...fake, coordinator, view, element };
}

describe('resume through the real navigators', () => {
  beforeEach(() => {
    markOnboardingSeen();
    session = null;
  });

  it('a protected link received signed out lands on the target after sign-in, once', async () => {
    const t = await mount({});
    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeTruthy());

    act(() => t.emit(TARGET));
    expect(screen.queryByTestId(TARGET_TESTID)).toBeNull();
    expect(screen.getByTestId('welcome-screen')).toBeTruthy();

    await act(async () => {
      await session?.adoptSession(SIGNED_IN);
    });
    await waitFor(() => expect(screen.getByTestId(TARGET_TESTID)).toBeTruthy());
    expect(t.coordinator.hasPending()).toBe(false);
  });

  it('a cold-start protected link received during restore is replayed once authenticated', async () => {
    const t = await mount({ initial: TARGET, stored: true });
    await waitFor(() => expect(screen.getByTestId(TARGET_TESTID)).toBeTruthy());
    expect(t.coordinator.hasPending()).toBe(false);
  });

  it('after a sign-out, a new link is held for the next sign-in', async () => {
    const t = await mount({ stored: true, initial: null });
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    await act(async () => {
      await session?.logout();
    });
    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeTruthy());
    act(() => t.emit(TARGET));
    expect(t.coordinator.hasPending()).toBe(true);
    await act(async () => {
      await session?.adoptSession(SIGNED_IN);
    });
    await waitFor(() => expect(screen.getByTestId(TARGET_TESTID)).toBeTruthy());
  });

  it('after a sign-out, a link is not replayed to a different account that signs in', async () => {
    const t = await mount({ stored: true, initial: null });
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    await act(async () => {
      await session?.logout();
    });
    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeTruthy());
    act(() => t.emit(TARGET));
    await act(async () => {
      await session?.adoptSession({
        ...SIGNED_IN,
        identity: { ...SIGNED_IN.identity, subjectId: B, email: 'other@example.com' },
      });
    });
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    expect(screen.queryByTestId(TARGET_TESTID)).toBeNull();
    expect(t.coordinator.hasPending()).toBe(false);
  });

  it('does not re-apply the initial URL when the container remounts', async () => {
    const t = await mount({ initial: 'medora://notifications', stored: true });
    await waitFor(() => expect(screen.getByTestId(TARGET_TESTID)).toBeTruthy());

    // Lock: the container unmounts. Unlock: it remounts and re-reads the initial URL.
    t.view.rerender(t.element(true));
    await waitFor(() => expect(screen.queryByTestId(TARGET_TESTID)).toBeNull());
    t.view.rerender(t.element(false));
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    expect(screen.queryByTestId(TARGET_TESTID)).toBeNull();
    expect(t.source.getInitialURL).toHaveBeenCalledTimes(1);
  });

  it('a link arriving while locked opens after unlock', async () => {
    const t = await mount({ stored: true });
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    t.view.rerender(t.element(true));
    act(() => t.emit(TARGET));
    t.view.rerender(t.element(false));
    await waitFor(() => expect(screen.getByTestId(TARGET_TESTID)).toBeTruthy());
  });
});
