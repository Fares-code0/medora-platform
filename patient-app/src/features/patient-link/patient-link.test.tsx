import { type ReactNode } from 'react';

import { useQuery, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { apiClient } from '@/api/client';
import { patientLinkEndpoints } from '@/api/endpoints/patient-link';
import { createQueryClient } from '@/api/query-client';
import { ToastProvider } from '@/components';
import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { SessionProvider, useSession } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import { LocaleProvider, type Locale } from '@/i18n';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { ThemeProvider } from '@/theme';
import type { ApiError } from '@/types/api';

import { formatCountdown, groupCode, secondsUntil, spokenCode } from './code';
import { LinkRecordBanner } from './components/LinkRecordBanner';
import { PatientLinkProbe } from './components/PatientLinkProbe';
import { httpPatientLinkService } from './http-patient-link-service';
import type { PatientLinkState } from './model/types';
import { LinkRecordScreen } from './screens/LinkRecordScreen';
import { patientLinkService } from './service';

/**
 * Account linking (ADR-048) and the eligibility probe (C-11).
 */

const PATIENT_A: SignInResult = {
  tokens: { accessToken: 'access-a', refreshToken: 'refresh-a' },
  identity: {
    subjectId: 'subject-a',
    role: 'patient',
    displayName: 'Sara',
    email: 'a@example.com',
    emailVerified: true,
  },
};
const PATIENT_B: SignInResult = {
  tokens: { accessToken: 'access-b', refreshToken: 'refresh-b' },
  identity: {
    subjectId: 'subject-b',
    role: 'patient',
    displayName: 'Omar',
    email: 'b@example.com',
    emailVerified: true,
  },
};

const UNLINKED: PatientLinkState = { linked: false, patient: null };
const LINKED_A: PatientLinkState = {
  linked: true,
  patient: { id: 'PT-1', fullName: 'Sara Ahmed' },
};

function apiError(error: ApiError): Error {
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

const spies: { mockRestore: () => void }[] = [];
function track<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

let session: ReturnType<typeof useSession> | null = null;
let mounted: QueryClient | null = null;

function Capture() {
  const s = useSession();
  session = s;
  const reason = s.state.status === 'unauthenticated' ? (s.state.reason ?? '') : '';
  return (
    <>
      <Text testID="status">{s.state.status}</Text>
      <Text testID="reason">{reason}</Text>
    </>
  );
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

async function mount(
  ui: ReactNode,
  options: { refresh?: AuthService['refresh']; locale?: Locale; signIn?: boolean } = {},
) {
  const queryClient = createQueryClient();
  mounted = queryClient;
  const tokenStorage = createTokenStorage(createInMemorySecureStore());
  const auth = {
    refresh: jest.fn(options.refresh ?? (() => Promise.resolve(PATIENT_A))),
    logout: jest.fn(() => Promise.resolve()),
  } as unknown as AuthService & { logout: jest.Mock };

  const view = render(
    <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
      <LocaleProvider initialLocale={options.locale ?? 'en'}>
        <ThemeProvider initialMode="light">
          <QueryClientProvider client={queryClient}>
            <ToastProvider>
              <SessionProvider authService={auth} tokenStorage={tokenStorage}>
                <Capture />
                {ui}
              </SessionProvider>
            </ToastProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </LocaleProvider>
    </SafeAreaProvider>,
  );
  const status = () => view.getByTestId('status').props.children as string;
  const reason = () => view.getByTestId('reason').props.children as string;
  await waitFor(() => expect(status()).toBe('unauthenticated'));
  if (options.signIn !== false) {
    await act(async () => {
      await session?.adoptSession(PATIENT_A);
    });
    await waitFor(() => expect(status()).toBe('authenticated'));
  }
  return { view, queryClient, auth, status, reason, tokenStorage };
}

/** Renders `ui` only while signed in, as the navigator does. */
function SignedIn({ children }: { children: ReactNode }) {
  const { state } = useSession();
  return state.status === 'authenticated' ? <>{children}</> : null;
}

beforeEach(() => {
  track(jest.spyOn(console, 'info').mockImplementation(() => {}));
  track(jest.spyOn(console, 'warn').mockImplementation(() => {}));
  track(jest.spyOn(console, 'error').mockImplementation(() => {}));
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  mounted?.clear();
  mounted = null;
  apiClient.setAccessToken(null);
  apiClient.setRefreshHandler(null);
  apiClient.setSessionLostHandler(null);
  session = null;
});

describe('presenting a code', () => {
  it('groups 4-4, spells for a screen reader, and counts down', () => {
    expect(groupCode('ABCD2345')).toBe('ABCD 2345');
    expect(spokenCode('ABCD2345')).toBe('A B C D, 2 3 4 5');
    expect(secondsUntil('2026-01-01T00:15:00Z', Date.parse('2026-01-01T00:00:00Z'))).toBe(900);
    expect(secondsUntil('2026-01-01T00:00:00Z', Date.parse('2026-01-01T00:00:05Z'))).toBe(0);
    expect(secondsUntil('not a date', 0)).toBe(0);
    expect(formatCountdown(900)).toBe('15:00');
    expect(formatCountdown(65)).toBe('1:05');
  });
});

describe('the HTTP adapter', () => {
  it('reads the state and issues a code through the contract routes', async () => {
    const fetchMock = track(
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ data: { linked: false, patient: null } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ data: { code: 'ABCD2345', expiresAt: '2026-01-01T00:15:00Z' } }),
            { status: 201, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );
    await expect(httpPatientLinkService.getState()).resolves.toEqual(UNLINKED);
    await expect(httpPatientLinkService.issueCode()).resolves.toEqual({
      code: 'ABCD2345',
      expiresAt: '2026-01-01T00:15:00Z',
    });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toMatch(/\/me\/patient-link$/);
    expect(urls[1]).toMatch(/\/me\/patient-link\/code$/);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST');
  });

  it('never carries a patient onto the screen for an unlinked answer', async () => {
    track(
      jest
        .spyOn(patientLinkEndpoints, 'getState')
        .mockResolvedValue({ data: { linked: false, patient: { id: 'x', fullName: 'X' } } }),
    );
    await expect(httpPatientLinkService.getState()).resolves.toEqual(UNLINKED);
  });
});

describe('the eligibility probe (C-11)', () => {
  it('ends the session on 403 patient_only from GET /me/patient-link', async () => {
    track(
      jest
        .spyOn(patientLinkService, 'getState')
        .mockRejectedValue(apiError({ kind: 'forbidden', code: 'patient_only' })),
    );
    const t = await mount(
      <SignedIn>
        <PatientLinkProbe />
      </SignedIn>,
      { signIn: false },
    );
    await act(async () => {
      await session?.adoptSession(PATIENT_A);
    });
    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    expect(t.auth.logout).toHaveBeenCalledWith({ skipRefresh: true });
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
  });

  it('does not end the session on a 403 without the patient_only code', async () => {
    const getState = track(
      jest.spyOn(patientLinkService, 'getState').mockRejectedValue(apiError({ kind: 'forbidden' })),
    );
    const t = await mount(
      <SignedIn>
        <PatientLinkProbe />
      </SignedIn>,
    );
    await waitFor(() => expect(getState).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(t.status()).toBe('authenticated');
    expect(t.auth.logout).not.toHaveBeenCalled();
  });

  it('does not treat patient_only from any OTHER endpoint as ineligibility', async () => {
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(UNLINKED));
    const other = jest.fn(() =>
      Promise.reject(apiError({ kind: 'forbidden', code: 'patient_only' })),
    );
    function OtherEndpoint() {
      const q = useQuery({ queryKey: ['appointments', 'list', {}], queryFn: other });
      return <Text testID="other">{q.status}</Text>;
    }
    const t = await mount(
      <SignedIn>
        <PatientLinkProbe />
        <OtherEndpoint />
      </SignedIn>,
    );
    await waitFor(() => expect(t.view.getByTestId('other').props.children).toBe('error'));
    expect(t.status()).toBe('authenticated');
    expect(t.auth.logout).not.toHaveBeenCalled();
  });
});

describe('the link banner', () => {
  it('shows for an unlinked account and is a 44pt-target button', async () => {
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(UNLINKED));
    const onLink = jest.fn();
    const t = await mount(
      <SignedIn>
        <LinkRecordBanner onLink={onLink} />
      </SignedIn>,
    );
    const action = await t.view.findByTestId('link-record-banner-action');
    expect(t.view.getByText('Link your hospital record')).toBeTruthy();
    expect(action.props.accessibilityRole).toBe('button');
    fireEvent.press(action);
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it('is absent when linked, and while the state is unknown', async () => {
    let resolve: (state: PatientLinkState) => void = () => undefined;
    track(
      jest.spyOn(patientLinkService, 'getState').mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    );
    const t = await mount(
      <SignedIn>
        <LinkRecordBanner onLink={jest.fn()} />
      </SignedIn>,
    );
    expect(t.view.queryByTestId('link-record-banner')).toBeNull();
    await act(async () => {
      resolve(LINKED_A);
    });
    expect(t.view.queryByTestId('link-record-banner')).toBeNull();
  });

  it('reads in Arabic', async () => {
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(UNLINKED));
    const t = await mount(
      <SignedIn>
        <LinkRecordBanner onLink={jest.fn()} />
      </SignedIn>,
      { locale: 'ar' },
    );
    expect(await t.view.findByText('اربط سجلّك في المستشفى')).toBeTruthy();
  });
});

describe('the link screen', () => {
  it('issues a code: grouped, spelled out, announced, with a countdown', async () => {
    const announce = track(jest.spyOn(AccessibilityInfo, 'announceForAccessibility'));
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(UNLINKED));
    const issue = track(
      jest.spyOn(patientLinkService, 'issueCode').mockResolvedValue({
        code: 'K7XM2PQR',
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      }),
    );
    const t = await mount(
      <SignedIn>
        <LinkRecordScreen />
      </SignedIn>,
    );
    expect(
      await t.view.findByText(
        'Bring an identity document: national ID, passport, residence permit or driving licence.',
      ),
    ).toBeTruthy();

    fireEvent.press(t.view.getByTestId('link-code-generate'));
    const value = await t.view.findByTestId('link-code-value');
    expect(issue).toHaveBeenCalledTimes(1);
    expect(value.props.children).toBe('K7XM 2PQR');
    expect(value.props.selectable).toBe(true);
    expect(value.props.accessibilityLabel).toBe('Linking code: K 7 X M, 2 P Q R');
    expect(t.view.getByTestId('link-code-countdown').props.children).toMatch(
      /^Expires in 1[45]:\d\d$/,
    );
    expect(announce).toHaveBeenCalledWith(
      expect.stringContaining('Linking code ready: K 7 X M, 2 P Q R.'),
    );

    // Regenerate asks again; the server voids the previous code.
    expect(t.view.getByText('Get a new code')).toBeTruthy();
    fireEvent.press(t.view.getByTestId('link-code-generate'));
    await waitFor(() => expect(issue).toHaveBeenCalledTimes(2));
  });

  it('shows an expired code as expired and offers a new one', async () => {
    const announce = track(jest.spyOn(AccessibilityInfo, 'announceForAccessibility'));
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(UNLINKED));
    track(
      jest.spyOn(patientLinkService, 'issueCode').mockResolvedValue({
        code: 'ABCD2345',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );
    const t = await mount(
      <SignedIn>
        <LinkRecordScreen />
      </SignedIn>,
    );
    fireEvent.press(await t.view.findByTestId('link-code-generate'));
    expect(await t.view.findByTestId('link-code-expired')).toBeTruthy();
    expect(t.view.queryByTestId('link-code-countdown')).toBeNull();
    expect(announce).toHaveBeenCalledWith(
      'This code has expired. Get a new one when you are at the desk.',
    );
  });

  it('on 409 already_linked, reads the state again and shows the linked record', async () => {
    const getState = track(
      jest
        .spyOn(patientLinkService, 'getState')
        .mockResolvedValueOnce(UNLINKED)
        .mockResolvedValue(LINKED_A),
    );
    track(
      jest
        .spyOn(patientLinkService, 'issueCode')
        .mockRejectedValue(
          apiError({ kind: 'conflict', code: 'already_linked', detail: 'Already linked' }),
        ),
    );
    const t = await mount(
      <SignedIn>
        <LinkRecordScreen />
      </SignedIn>,
    );
    fireEvent.press(await t.view.findByTestId('link-code-generate'));
    expect(await t.view.findByTestId('link-record-linked')).toBeTruthy();
    expect(getState).toHaveBeenCalledTimes(2);
    expect(
      t.view.getByText('Your account is linked to the hospital record of Sara Ahmed.'),
    ).toBeTruthy();
    expect(t.view.queryByTestId('link-code-error')).toBeNull();
  });

  it('says so when a code could not be issued', async () => {
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(UNLINKED));
    track(
      jest
        .spyOn(patientLinkService, 'issueCode')
        .mockRejectedValue(apiError({ kind: 'rate_limited', retryAfterSeconds: 60 })),
    );
    const t = await mount(
      <SignedIn>
        <LinkRecordScreen />
      </SignedIn>,
    );
    fireEvent.press(await t.view.findByTestId('link-code-generate'));
    const error = await t.view.findByTestId('link-code-error');
    expect(error.props.children).toBe(
      'Too many codes were requested. Wait a few minutes, then try again.',
    );
    expect(error.props.accessibilityRole).toBe('alert');
  });
});

describe('switching accounts', () => {
  it("clears A's link state and every PHI query before B's session exists", async () => {
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(LINKED_A));
    const t = await mount(
      <SignedIn>
        <PatientLinkProbe />
      </SignedIn>,
    );
    await waitFor(() => expect(t.queryClient.getQueryData(['patient-link'])).toEqual(LINKED_A));
    t.queryClient.setQueryData(['appointments', 'list', {}], [{ id: 'a-appt' }]);

    await act(async () => {
      await session?.logout();
    });
    await waitFor(() => expect(t.status()).toBe('unauthenticated'));
    expect(t.queryClient.getQueryData(['patient-link'])).toBeUndefined();
    expect(t.queryClient.getQueryCache().getAll()).toHaveLength(0);

    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(UNLINKED));
    await act(async () => {
      await session?.adoptSession(PATIENT_B);
    });
    await waitFor(() => expect(t.queryClient.getQueryData(['patient-link'])).toEqual(UNLINKED));
    expect(
      JSON.stringify(
        t.queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain('Sara Ahmed');
  });

  it('clears link state when a refresh comes back as a different account (A-P4)', async () => {
    track(jest.spyOn(patientLinkService, 'getState').mockResolvedValue(LINKED_A));
    const t = await mount(<Text>nothing</Text>, { refresh: () => Promise.resolve(PATIENT_B) });
    t.queryClient.setQueryData(['patient-link'], LINKED_A);

    track(
      jest.spyOn(global, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'unauthorized', message: 'Session expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await act(async () => {
      await apiClient.get('me/appointments').catch(() => undefined);
    });
    await waitFor(() => expect(t.queryClient.getQueryData(['patient-link'])).toBeUndefined());
    expect(t.status()).toBe('authenticated');
  });
});
