import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { EndpointNotImplementedError } from '@/api/seam';
import { ToastProvider } from '@/components';
import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { SessionProvider } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import type { EmergencyContact } from '@/features/health/model/types';
import { healthService } from '@/features/health/service';
import { LocaleProvider } from '@/i18n';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { ThemeProvider } from '@/theme';

import { EmergencyContacts } from './components/EmergencyContacts';
import { EmergencyScreen } from './screens/EmergencyScreen';

/**
 * The patient's emergency contacts — checklist N-08.
 *
 * The list itself is three lines of rendering. What is worth testing is
 * everything the section must NOT do to the one screen that has to work
 * in airplane mode, signed out, on a phone somebody else is holding:
 *
 * - no session → no section, and **no request**;
 * - failure → no section, and the guidance underneath untouched;
 * - a number → the two-step dial, never a one-tap call (N-03).
 */

const CONTACTS: EmergencyContact[] = [
  {
    id: 'EC-1',
    name: 'Huda Ahmed',
    relationship: 'Sister',
    phone: '+962 79 111 2222',
    primary: true,
  },
  {
    id: 'EC-2',
    name: 'Kareem Ahmed',
    relationship: null,
    phone: '+962 79 333 4444',
    primary: false,
  },
];

const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  identity: {
    subjectId: 'subject-1',
    displayName: 'Sara Ahmed',
    email: 'sara@example.com',
    emailVerified: true,
  },
};

const installed: { mockRestore: () => void }[] = [];

beforeEach(() => {
  installed.push(jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined));
});

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub(result: EmergencyContact[] | Error) {
  const spy = jest.spyOn(healthService, 'listEmergencyContacts');
  if (result instanceof Error) spy.mockRejectedValue(result);
  else spy.mockResolvedValue(result);
  installed.push(spy);
  return spy;
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/**
 * `test/render.tsx` mounts no `SessionProvider`, which is exactly what
 * the signed-out case needs and exactly what the signed-in case cannot
 * use. So this file builds its own wrapper and takes the session as a
 * parameter rather than as an ambient fact.
 */
function renderWithSession(
  ui: ReactNode,
  { withSession, locale }: { withSession: boolean; locale?: 'en' | 'ar' },
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    // `SessionProvider` reads the QueryClient (it sweeps the PHI cache
    // on logout), so it goes INSIDE the client rather than around the
    // whole tree — the same order `App.tsx` uses and for the same
    // reason.
    const authService = {
      refresh: jest.fn(() => Promise.resolve(SIGNED_IN)),
      logout: jest.fn(() => Promise.resolve()),
    } as unknown as AuthService;

    // A stored refresh token is what makes the boot restore a session
    // rather than settle on `unauthenticated`. Without it the assertions
    // below would pass for the wrong reason — no section, because no
    // session — which is the failure mode this file is about.
    const store = createInMemorySecureStore();
    void store.setItem('medora.refresh-token', 'refresh-1');

    const session = withSession ? (
      <SessionProvider authService={authService} tokenStorage={createTokenStorage(store)}>
        {children}
      </SessionProvider>
    ) : (
      children
    );
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <LocaleProvider {...(locale === undefined ? {} : { initialLocale: locale })}>
          <ThemeProvider initialMode="light">
            <QueryClientProvider client={queryClient}>
              <ToastProvider>{session}</ToastProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    );
  }

  return render(<>{ui}</>, { wrapper: Wrapper });
}

describe('signed out, or with no provider at all', () => {
  it('renders nothing, and asks for nothing', async () => {
    const list = stub(CONTACTS);

    const view = renderWithSession(<EmergencyContacts />, { withSession: false });

    await waitFor(() => {
      expect(view.queryByText('Your emergency contacts')).toBeNull();
    });
    // The stronger half: a screen reached without signing in must not
    // put a `/me` read on the wire at all.
    expect(list).not.toHaveBeenCalled();
  });

  it('leaves the Emergency screen renderable with no providers around it', () => {
    stub(CONTACTS);

    // The guarantee `emergency.test.tsx` protects, restated for the one
    // component on that screen that knows what a session is: mounting it
    // outside a `SessionProvider` must not throw.
    const view = renderWithSession(<EmergencyScreen />, { withSession: false });

    expect(view.getByTestId('emergency-screen')).toBeTruthy();
    expect(view.queryByText('Your emergency contacts')).toBeNull();
  });
});

describe('signed in, with contacts on the record', () => {
  it('lists them, and says which one the clinic calls first', async () => {
    stub(CONTACTS);

    const view = renderWithSession(<EmergencyContacts />, { withSession: true });

    expect(await view.findByTestId('emergency-contact-EC-1')).toBeTruthy();
    expect(view.getByText('Huda Ahmed')).toBeTruthy();
    expect(view.getByText('Sister · first to call')).toBeTruthy();
    // A contact with no relationship recorded still says what it is,
    // rather than leaving a blank line where a word should be.
    expect(view.getByText('Emergency contact')).toBeTruthy();
  });

  it('never dials on the first tap (N-03)', async () => {
    stub(CONTACTS);

    const view = renderWithSession(<EmergencyContacts />, { withSession: true });
    const call = await view.findByTestId('emergency-call-contact-EC-1');

    fireEvent.press(call);

    // The sheet names the number; only its confirm button dials. A
    // relative is a person, and calling one from a pocket is the same
    // defect as calling an ambulance from a pocket.
    expect(await view.findByTestId('emergency-call-contact-EC-1-confirm-sheet')).toBeTruthy();
    expect(view.getByText('Call +962 79 111 2222')).toBeTruthy();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('offers no way to add, edit or remove one', async () => {
    stub(CONTACTS);

    const view = renderWithSession(<EmergencyContacts />, { withSession: true });
    await view.findByTestId('emergency-contact-EC-1');

    // The clinic owns `patient_emergency_contacts`. RA-030.2 is the
    // decision that would change that, and it is open.
    for (const forbidden of [/^Add/i, /^Edit/i, /^Remove/i, /^Delete/i]) {
      expect(view.queryByText(forbidden)).toBeNull();
    }
  });
});

describe('when the read fails', () => {
  it('renders nothing rather than an error on the emergency screen', async () => {
    stub(new EndpointNotImplementedError('BE-09 / AD-5', 'capability.healthRecords'));

    const view = renderWithSession(<EmergencyScreen />, { withSession: true });

    await waitFor(() => {
      expect(view.queryByText('Your emergency contacts')).toBeNull();
    });
    // And the screen underneath is intact: this is what "may add, may
    // never take away" means in practice.
    expect(view.getByTestId('emergency-screen')).toBeTruthy();
    expect(view.getByText('Chest pain or pressure')).toBeTruthy();
  });

  it('renders nothing for an empty list either', async () => {
    stub([]);

    const view = renderWithSession(<EmergencyScreen />, { withSession: true });

    await waitFor(() => {
      expect(view.getByTestId('emergency-screen')).toBeTruthy();
    });
    // A section headed "Your emergency contacts" with nothing under it
    // is worse than no section: on this screen it reads as a list that
    // failed to load at the moment it is needed.
    expect(view.queryByText('Your emergency contacts')).toBeNull();
  });
});

/**
 * Arabic twin — W-10 translation approval, 2026-11-23. The names and the
 * relationship are the clinic's record and stay as recorded; only the
 * frame around them is Arabic.
 */
describe('in Arabic', () => {
  it('frames the recorded contacts in Arabic and leaves the record as written', async () => {
    stub(CONTACTS);

    const view = renderWithSession(<EmergencyContacts />, { withSession: true, locale: 'ar' });

    expect(await view.findByTestId('emergency-contact-EC-1')).toBeTruthy();
    expect(view.getByText('جهات اتصالك في الطوارئ')).toBeTruthy();
    expect(view.getByText('Huda Ahmed')).toBeTruthy();
    expect(view.getByText('\u2068Sister\u2069 · أول من يُتصل به')).toBeTruthy();
    expect(view.getByText('جهة اتصال في الطوارئ')).toBeTruthy();
    expect(view.queryByText('Your emergency contacts')).toBeNull();
  });
});
