import { useEffect, type ReactNode } from 'react';

import { MutationObserver, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { apiClient } from '@/api/client';
import { optimisticUpdate, type OptimisticContext } from '@/api/optimistic';
import { createQueryClient } from '@/api/query-client';
import { listRecentDoctors, recordDoctorView } from '@/features/doctors/recent';
import { notificationKeys } from '@/features/notifications/keys';
import {
  createLinkCoordinator,
  sessionSnapshot,
  type LinkCoordinator,
  type LinkSource,
} from '@/navigation/link-resume';
import { createInMemorySecureStore } from '@/storage/secure-store';

import type { AuthService, SignInResult } from './model/types';
import { SessionProvider, useSession } from './SessionProvider';
import { createTokenStorage } from './storage';

/**
 * Two accounts on one phone (issues #45, #48).
 *
 * Account A signs in, browses, and leaves things behind in every place the
 * app keeps per-session state: the query cache, the recent-doctors list and
 * a held deep link. A signs out and B signs in. Nothing of A's may be
 * reachable from B's session.
 *
 * The client is the app's own (`createQueryClient`), the session is the
 * real `SessionProvider`, and the link coordinator is wired to the session
 * exactly as `App.tsx`'s `LinkCapture` wires it.
 */

const A_MARK = 'account-a-only';

const ACCOUNT_A: SignInResult = {
  tokens: { accessToken: 'access-a', refreshToken: 'refresh-a' },
  identity: {
    subjectId: 'subject-a',
    displayName: `Sara ${A_MARK}`,
    email: 'a@example.com',
    emailVerified: true,
  },
};

const ACCOUNT_B: SignInResult = {
  tokens: { accessToken: 'access-b', refreshToken: 'refresh-b' },
  identity: {
    subjectId: 'subject-b',
    displayName: 'Omar',
    email: 'b@example.com',
    emailVerified: true,
  },
};

function authService(): AuthService {
  return {
    refresh: jest.fn(() => Promise.resolve(ACCOUNT_A)),
    logout: jest.fn(() => Promise.resolve()),
  } as unknown as AuthService;
}

function fakeSource() {
  let handler: ((event: { url: string }) => void) | null = null;
  const source: LinkSource = {
    getInitialURL: () => Promise.resolve(null),
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

let session: ReturnType<typeof useSession> | null = null;
/** Cleared after each test, pass or fail, so no gc timer outlives it. */
let mounted: QueryClient | null = null;

/** `LinkCapture` from App.tsx, with the coordinator injected. */
function Capture({ coordinator }: { coordinator: LinkCoordinator }) {
  const s = useSession();
  session = s;
  useEffect(() => {
    coordinator.setSession(sessionSnapshot(s.state, s.locked));
  }, [coordinator, s.state, s.locked]);
  useEffect(() => coordinator.attach(), [coordinator]);
  return <Text testID="status">{s.state.status}</Text>;
}

async function mount() {
  const queryClient = createQueryClient();
  mounted = queryClient;
  const fake = fakeSource();
  const coordinator = createLinkCoordinator({ source: fake.source });
  const tokenStorage = createTokenStorage(createInMemorySecureStore());

  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const view = render(
    <Tree>
      <SessionProvider authService={authService()} tokenStorage={tokenStorage}>
        <Capture coordinator={coordinator} />
      </SessionProvider>
    </Tree>,
  );
  await waitFor(() => expect(view.getByTestId('status').props.children).toBe('unauthenticated'));

  const signIn = async (result: SignInResult) => {
    await act(async () => {
      await session?.adoptSession(result);
    });
    await waitFor(() => expect(view.getByTestId('status').props.children).toBe('authenticated'));
  };
  const signOut = async () => {
    await act(async () => {
      await session?.logout();
    });
    await waitFor(() => expect(view.getByTestId('status').props.children).toBe('unauthenticated'));
  };

  return { queryClient, coordinator, emit: fake.emit, signIn, signOut };
}

/** Every byte the cache holds, so a marker anywhere in it is found. */
function cachedData(queryClient: QueryClient): string {
  return JSON.stringify(queryClient.getQueryCache().getAll().map((query) => query.state.data));
}

function seedAccountA(queryClient: QueryClient) {
  queryClient.setQueryData(['profile', 'me'], { fullName: `Sara ${A_MARK}` });
  queryClient.setQueryData(['appointments', 'list', {}], [{ id: 'appt-1', note: A_MARK }]);
  queryClient.setQueryData(notificationKeys.lists(), [{ id: 'n-1', title: A_MARK, read: false }]);
  queryClient.setQueryData(notificationKeys.unreadCount(), 7);
}

afterEach(() => {
  mounted?.clear();
  mounted = null;
  apiClient.setAccessToken(null);
  session = null;
});

describe('signing out of one account and into another', () => {
  it("leaves none of A's cache, recent doctors or held link to B", async () => {
    const t = await mount();
    await t.signIn(ACCOUNT_A);

    seedAccountA(t.queryClient);
    recordDoctorView({
      id: 'doc-1',
      fullName: 'Dr Oncology',
      title: 'Dr',
      specialty: 'Oncology',
      photoUrl: null,
    } as Parameters<typeof recordDoctorView>[0]);
    // No navigation container is mounted, so a protected link is held — for A.
    act(() => t.emit('medora://notifications'));
    expect(cachedData(t.queryClient)).toContain(A_MARK);
    expect(listRecentDoctors()).toHaveLength(1);
    expect(t.coordinator.hasPending()).toBe(true);

    await t.signOut();
    await t.signIn(ACCOUNT_B);

    expect(cachedData(t.queryClient)).not.toContain(A_MARK);
    expect(t.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(listRecentDoctors()).toEqual([]);
    expect(t.coordinator.hasPending()).toBe(false);
    expect(t.coordinator.flush()).toBe(false);
  });

  it("does not let A's failed mark-read roll back into B's feed", async () => {
    const t = await mount();
    await t.signIn(ACCOUNT_A);
    seedAccountA(t.queryClient);

    // A's mark-read, built exactly as `NotificationsScreen` builds it, is
    // still on the wire when A signs out.
    let failRequest: (error: Error) => void = () => undefined;
    const request = new Promise<void>((_, reject) => {
      failRequest = reject;
    });
    const observer = new MutationObserver<void, Error, string, OptimisticContext>(t.queryClient, {
      mutationFn: () => request,
      ...optimisticUpdate<string, { id: string; read: boolean }[], void, Error>({
        queryClient: t.queryClient,
        queryKey: notificationKeys.lists(),
        apply: (current, id) =>
          current.map((item) => (item.id === id ? { ...item, read: true } : item)),
      }),
    });
    const settled = observer.mutate('n-1').catch(() => undefined);
    await waitFor(() =>
      expect(
        t.queryClient.getQueryData<{ read: boolean }[]>(notificationKeys.lists())?.[0]?.read,
      ).toBe(true),
    );

    await t.signOut();
    await t.signIn(ACCOUNT_B);
    const B_FEED = [{ id: 'n-9', title: 'for B', read: false }];
    t.queryClient.setQueryData(notificationKeys.lists(), B_FEED);

    await act(async () => {
      failRequest(new Error('offline'));
      await settled;
    });

    expect(t.queryClient.getQueryData(notificationKeys.lists())).toEqual(B_FEED);
    expect(cachedData(t.queryClient)).not.toContain(A_MARK);
  });
});
