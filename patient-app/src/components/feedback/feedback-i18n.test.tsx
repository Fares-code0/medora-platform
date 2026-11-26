import fs from 'node:fs';
import path from 'node:path';

import NetInfo from '@react-native-community/netinfo';
import { act } from '@testing-library/react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorState } from '@/components/feedback/ErrorState';
import { OfflineBanner } from '@/components/feedback/OfflineBanner';
import { catalogues } from '@/i18n';
import { NetworkProvider } from '@/network/NetworkProvider';
import { renderWithProviders } from '@/test/render';

/**
 * C-09 — the state components read the catalogue.
 *
 * These are the strings a patient sees when something has gone wrong,
 * which is the worst moment to be reading a language you do not speak,
 * and they carry no clinical content — so they are the surface that
 * moved onto `useT` first.
 *
 * The tests below assert the *migration*, not the copy: that the
 * rendered text is the catalogue's entry rather than a sentence written
 * inline, and that switching the locale switches every one of them. A
 * test that only checked the English would pass unchanged if somebody
 * put a literal back.
 */

const en = catalogues.en;
const ar = catalogues.ar;

describe('ErrorState reads the catalogue', () => {
  it('renders the English entry for a network error', () => {
    const { getByText } = renderWithProviders(<ErrorState error={{ kind: 'network' }} />);

    expect(getByText(en['state.error.network.title'])).toBeTruthy();
    expect(getByText(en['state.error.network.body'])).toBeTruthy();
  });

  it('renders the Arabic entry for the same error', () => {
    const { getByText, queryByText } = renderWithProviders(
      <ErrorState error={{ kind: 'network' }} />,
      {
        locale: 'ar',
      },
    );

    expect(getByText(ar['state.error.network.title'])).toBeTruthy();
    expect(getByText(ar['state.error.network.body'])).toBeTruthy();
    expect(queryByText(en['state.error.network.title'])).toBeNull();
  });

  it('translates the retry button too', () => {
    const { getByText } = renderWithProviders(
      <ErrorState error={{ kind: 'network' }} onRetry={jest.fn()} />,
      { locale: 'ar' },
    );

    expect(getByText(ar['action.retry'])).toBeTruthy();
  });

  it('interpolates the countdown into whichever sentence the locale uses', () => {
    // `{seconds}` does not sit in the same place in both languages,
    // which is the reason the value travels as a parameter rather than
    // being concatenated at the call site.
    const { getByText } = renderWithProviders(
      <ErrorState error={{ kind: 'rate_limited', retryAfterSeconds: 45 }} />,
      { locale: 'ar' },
    );

    expect(getByText(ar['state.error.rateLimited.body'].replace('{seconds}', '45'))).toBeTruthy();
  });

  it('interpolates the correlation reference, and nothing else from the server', () => {
    const { getByText, queryByText } = renderWithProviders(
      <ErrorState error={{ kind: 'server', ref: 'HTTP-500', detail: 'Sara Ahmed changed this' }} />,
    );

    expect(getByText(en['state.error.server.body'].replace('{ref}', 'HTTP-500'))).toBeTruthy();
    expect(queryByText(/Sara Ahmed/)).toBeNull();
  });

  it('interpolates the capability an unbuilt endpoint names', () => {
    const { getByText, queryByText } = renderWithProviders(
      <ErrorState error={new EndpointNotImplementedError('BE-05', 'capability.messages')} />,
    );

    // The capability reaches `ErrorState` as a catalogue key and is
    // resolved before interpolation, so a patient reads words rather than
    // `capability.messages`.
    expect(
      getByText(
        en['state.error.unavailable.body'].replace('{capability}', en['capability.messages']),
      ),
    ).toBeTruthy();
    expect(queryByText(/capability\./)).toBeNull();
  });

  it('leaves no English in the refusal when the app is in Arabic', () => {
    /*
      The point of making `capability` a catalogue key. It used to be a
      plain English string written in the service layer, so every refusal
      an Arabic-speaking patient met was half-translated — "Recent
      activity غير متاح بعد." — on roughly ten screens, which is most of
      the app's current surface. The frame was translated and the subject
      of the sentence was not.
    */
    const { getByText, queryByText } = renderWithProviders(
      <ErrorState error={new EndpointNotImplementedError('BE-10', 'capability.recentActivity')} />,
      { locale: 'ar' },
    );

    expect(
      getByText(
        catalogues.ar['state.error.unavailable.body'].replace(
          '{capability}',
          catalogues.ar['capability.recentActivity'],
        ),
      ),
    ).toBeTruthy();
    // The English capability name is the half that used to survive.
    expect(queryByText(/Recent activity/)).toBeNull();
  });
});

describe('EmptyState falls back to the catalogue', () => {
  it('uses the generic pair when the caller gives no title', () => {
    const { getByText } = renderWithProviders(<EmptyState />);

    expect(getByText(en['state.empty.title'])).toBeTruthy();
    expect(getByText(en['state.empty.body'])).toBeTruthy();
  });

  it('translates that pair', () => {
    const { getByText } = renderWithProviders(<EmptyState />, { locale: 'ar' });

    expect(getByText(ar['state.empty.title'])).toBeTruthy();
    expect(getByText(ar['state.empty.body'])).toBeTruthy();
  });

  it('keeps a caller-supplied title, and drops the generic body beside it', () => {
    // "No appointments" followed by "When there is something to show…"
    // reads as two unrelated sentences, so the generic body is shown
    // only when the generic title is.
    const { getByText, queryByText } = renderWithProviders(<EmptyState title="No appointments" />);

    expect(getByText('No appointments')).toBeTruthy();
    expect(queryByText(en['state.empty.body'])).toBeNull();
  });
});

describe('OfflineBanner reads the catalogue', () => {
  /**
   * The banner shows nothing during the first probe, so a test has to
   * drive NetInfo to offline rather than assert on a fresh mount.
   */
  function renderBanner(locale: 'en' | 'ar') {
    const listeners: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void)[] =
      [];
    jest.spyOn(NetInfo, 'addEventListener').mockImplementation(((
      listener: (state: unknown) => void,
    ) => {
      listeners.push(listener);
      return () => undefined;
    }) as unknown as typeof NetInfo.addEventListener);

    const view = renderWithProviders(
      <NetworkProvider>
        <OfflineBanner />
      </NetworkProvider>,
      { locale },
    );

    act(() => {
      for (const listener of [...listeners]) {
        listener({ isConnected: false, isInternetReachable: false });
      }
    });

    return view;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the English line', () => {
    expect(renderBanner('en').getByText(en['state.offline.banner'])).toBeTruthy();
  });

  it('renders the Arabic line', () => {
    expect(renderBanner('ar').getByText(ar['state.offline.banner'])).toBeTruthy();
  });
});

describe('no patient-visible English is left inline in these three', () => {
  // The regression this guards is the easy one: a new error kind, or a
  // new empty variant, added with its sentence written in the component
  // because that is one line shorter than adding a catalogue entry.
  const FILES = ['EmptyState.tsx', 'ErrorState.tsx', 'OfflineBanner.tsx'];

  it.each(FILES)('%s holds no sentence-shaped string literal', (file) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // A sentence: two or more words and a full stop, or an apostrophe
    // contraction. Identifiers, keys and testIDs match neither.
    const sentences = [...withoutComments.matchAll(/'[^']*\s[^']*[.']\s*'/g)].map((m) => m[0]);

    expect(sentences).toEqual([]);
  });
});
