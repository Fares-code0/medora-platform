import { useEffect, type ReactNode } from 'react';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { apiClient } from '@/api/client';
import { createQueryClient } from '@/api/query-client';
import { listRecentDoctors, recordDoctorView } from '@/features/doctors/recent';
import {
  createLinkCoordinator,
  sessionSnapshot,
  type LinkCoordinator,
  type LinkSource,
} from '@/navigation/link-resume';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { logger } from '@/utils/logger';
import {
  installCrashReporting,
  reportCrash,
  toReport,
  type CrashReport,
} from '@/utils/monitoring';

import type { AuthService, SignInResult } from './model/types';
import { SessionProvider, useSession } from './SessionProvider';
import { createTokenStorage, type TokenStorage } from './storage';

/**
 * What the session does when the account behind it changes (A-P3, A-P4,
 * A-P5), with the real `SessionProvider`, the app's own query client, the
 * real token storage over an in-memory keychain, and the link coordinator
 * wired as `App.tsx`'s `LinkCapture` wires it.
 */

const GUARD_401 = { message: 'Unauthorized', code: 'unauthorized' } as const;

const ACCOUNT_A: SignInResult = {
  tokens: { accessToken: 'access-a', refreshToken: 'refresh-a' },
  identity: {
    subjectId: 'subject-a',
    displayName: 'Sara',
    email: 'a@example.com',
    emailVerified: true,
  },
};

const ACCOUNT_A_ROTATED: SignInResult = {
  ...ACCOUNT_A,
  tokens: { accessToken: 'access-a-2', refreshToken: 'refresh-a-2' },
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

const A_MARK = 'account-a-only';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
let mounted: QueryClient | null = null;
let uninstallMonitoring: (() => void) | null = null;

function Capture({ coordinator }: { coordinator: LinkCoordinator }) {
  const s = useSession();
  session = s;
  useEffect(() => {
    coordinator.setSession(sessionSnapshot(s.state, s.locked));
  }, [coordinator, s.state, s.locked]);
  useEffect(() => coordinator.attach(), [coordinator]);
  const subject = s.state.status === 'authenticated' ? s.state.identity.subjectId : '';
  return (
    <>
      <Text testID="status">{s.state.status}</Text>
      <Text testID="subject">{subject}</Text>
    </>
  );
}

async function mount(refresh: AuthService['refresh']) {
  const queryClient = createQueryClient();
  mounted = queryClient;
  const fake = fakeSource();
  const coordinator = createLinkCoordinator({ source: fake.source });
  const tokenStorage: TokenStorage = createTokenStorage(createInMemorySecureStore());
  const auth = {
    refresh: jest.fn(refresh),
    logout: jest.fn(() => Promise.resolve()),
  } as unknown as AuthService & { refresh: jest.Mock };

  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const view = render(
    <Tree>
      <SessionProvider authService={auth} tokenStorage={tokenStorage}>
        <Capture coordinator={coordinator} />
      </SessionProvider>
    </Tree>,
  );
  await waitFor(() => expect(view.getByTestId('status').props.children).toBe('unauthenticated'));

  const status = () => view.getByTestId('status').props.children as string;
  const subject = () => view.getByTestId('subject').props.children as string;
  const signIn = async (result: SignInResult) => {
    await act(async () => {
      await session?.adoptSession(result);
    });
    await waitFor(() => expect(status()).toBe('authenticated'));
  };
  const signOut = async () => {
    await act(async () => {
      await session?.logout();
    });
    await waitFor(() => expect(status()).toBe('unauthenticated'));
  };

  return { queryClient, coordinator, emit: fake.emit, tokenStorage, auth, status, subject, signIn, signOut };
}

function seed(t: Awaited<ReturnType<typeof mount>>) {
  t.queryClient.setQueryData(['profile', 'me'], { fullName: `Sara ${A_MARK}` });
  recordDoctorView({
    id: 'doc-1',
    fullName: 'Dr Oncology',
    title: 'Dr',
    specialty: 'Oncology',
    photoUrl: null,
  } as Parameters<typeof recordDoctorView>[0]);
  // No navigation container is mounted, so a protected link is held — for A.
  act(() => t.emit('medora://notifications'));
  expect(t.queryClient.getQueryCache().getAll()).not.toHaveLength(0);
  expect(listRecentDoctors()).toHaveLength(1);
  expect(t.coordinator.hasPending()).toBe(true);
}

function breadcrumbMessages(): string[] {
  const report: CrashReport = toReport(new Error('probe'), { kind: 'handled' });
  return report.breadcrumbs.map((crumb) => crumb.message);
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  uninstallMonitoring?.();
  uninstallMonitoring = null;
  mounted?.clear();
  mounted = null;
  apiClient.setAccessToken(null);
  session = null;
  jest.restoreAllMocks();
});

describe("a 401 from A's request that lands after B signed in (A-P3)", () => {
  it("does not refresh B's session, replay A's request, or end B's session", async () => {
    const t = await mount(() => Promise.resolve(ACCOUNT_B));
    await t.signIn(ACCOUNT_A);

    let answerA: (response: Response) => void = () => undefined;
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          answerA = resolve;
        }),
    );
    const fromA = apiClient.get('me/appointments').then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await act(async () => {
      await Promise.resolve();
    });

    await t.signOut();
    await t.signIn(ACCOUNT_B);

    await act(async () => {
      answerA(json(401, GUARD_401));
      expect(await fromA).toMatchObject({ kind: 'cancelled' });
    });

    expect(t.auth.refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(t.status()).toBe('authenticated');
    expect(t.subject()).toBe('subject-b');
    expect(apiClient.hasAccessToken()).toBe(true);
    expect(await t.tokenStorage.readRefreshToken()).toBe('refresh-b');
  });

  it('still refreshes once and replays a 401 from the current session', async () => {
    const t = await mount(() => Promise.resolve(ACCOUNT_A_ROTATED));
    await t.signIn(ACCOUNT_A);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(json(401, GUARD_401))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));

    await act(async () => {
      await expect(apiClient.get('me/appointments')).resolves.toEqual({ data: { ok: true } });
    });

    expect(t.auth.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(t.status()).toBe('authenticated');
    expect(await t.tokenStorage.readRefreshToken()).toBe('refresh-a-2');
  });
});

describe('a mid-session refresh that returns a different account (A-P4)', () => {
  it("clears A's cache, recent doctors, held link and breadcrumbs, then adopts B", async () => {
    uninstallMonitoring = installCrashReporting({ sinks: [] });
    const t = await mount(() => Promise.resolve(ACCOUNT_B));
    await t.signIn(ACCOUNT_A);
    seed(t);
    logger.info(`breadcrumb ${A_MARK}`);
    expect(breadcrumbMessages()).toContain(`breadcrumb ${A_MARK}`);

    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(json(401, GUARD_401))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));

    await act(async () => {
      // A's request is not replayed with B's token.
      await expect(apiClient.get('me/appointments')).rejects.toMatchObject({ kind: 'cancelled' });
    });
    await waitFor(() => expect(t.subject()).toBe('subject-b'));

    expect(t.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(listRecentDoctors()).toEqual([]);
    expect(t.coordinator.hasPending()).toBe(false);
    expect(breadcrumbMessages()).not.toContain(`breadcrumb ${A_MARK}`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Not a refusal: the new account's token is kept, the session stays.
    expect(t.status()).toBe('authenticated');
    expect(apiClient.hasAccessToken()).toBe(true);
    expect(await t.tokenStorage.readRefreshToken()).toBe('refresh-b');
  });

  it('clears nothing when the refresh returns the same account', async () => {
    uninstallMonitoring = installCrashReporting({ sinks: [] });
    const t = await mount(() => Promise.resolve(ACCOUNT_A_ROTATED));
    await t.signIn(ACCOUNT_A);
    seed(t);
    logger.info(`breadcrumb ${A_MARK}`);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(json(401, GUARD_401))
      .mockResolvedValueOnce(json(200, { data: { ok: true } }));

    await act(async () => {
      await expect(apiClient.get('me/appointments')).resolves.toEqual({ data: { ok: true } });
    });

    expect(t.subject()).toBe('subject-a');
    expect(t.queryClient.getQueryData(['profile', 'me'])).toEqual({ fullName: `Sara ${A_MARK}` });
    expect(listRecentDoctors()).toHaveLength(1);
    expect(t.coordinator.hasPending()).toBe(true);
    expect(breadcrumbMessages()).toContain(`breadcrumb ${A_MARK}`);
    expect(await t.tokenStorage.readRefreshToken()).toBe('refresh-a-2');
  });
});

describe('breadcrumbs across a sign-out (A-P5)', () => {
  it('leaves no breadcrumb of the ended session, and keeps collecting after it', async () => {
    const sink = jest.fn();
    uninstallMonitoring = installCrashReporting({ sinks: [sink] });
    const t = await mount(() => Promise.resolve(ACCOUNT_A));
    await t.signIn(ACCOUNT_A);
    logger.info(`breadcrumb ${A_MARK}`);
    expect(breadcrumbMessages()).toContain(`breadcrumb ${A_MARK}`);

    await t.signOut();

    expect(breadcrumbMessages()).toEqual([]);
    // Monitoring is otherwise untouched: lines are still collected and a
    // report still reaches the registered sink.
    logger.info('after sign-out');
    expect(breadcrumbMessages()).toEqual(['after sign-out']);
    reportCrash(new Error('probe'), { kind: 'handled' });
    expect(sink).toHaveBeenCalledTimes(1);
  });
});
