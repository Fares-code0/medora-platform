import { act, waitFor } from '@testing-library/react-native';

import { apiClient } from '@/api/client';
import { interpolate, type Locale } from '@/i18n';
import { catalogues } from '@/i18n/messages';
import { renderWithProviders } from '@/test/render';

import { decideDeprecation, DEPRECATION_HEADER, SUNSET_HEADER } from './deprecation';
import { DeprecationBanner, deprecationMessage } from './DeprecationBanner';

/**
 * API deprecation notices — checklist W-07.
 *
 * The rule this suite exists to hold: the banner appears only when a
 * server has actually said the surface is deprecated, and never on a
 * value this client cannot read. A banner that cries wolf is worse than
 * no banner, because the one that matters will be ignored too.
 */

const SUNSET = 'Sat, 31 Dec 2033 23:59:59 GMT';

describe('deciding whether there is a notice', () => {
  it('says nothing when the server said nothing', () => {
    expect(decideDeprecation(null, null)).toBeNull();
    expect(decideDeprecation(undefined, undefined)).toBeNull();
    expect(decideDeprecation('', null)).toBeNull();
    expect(decideDeprecation('   ', null)).toBeNull();
  });

  it('reads the RFC 9745 unix form', () => {
    const notice = decideDeprecation('@1735689600', null);
    expect(notice?.deprecatedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(notice?.sunsetAt).toBeNull();
  });

  it('reads the HTTP-date form the pre-RFC drafts used', () => {
    const notice = decideDeprecation('Wed, 01 Jan 2025 00:00:00 GMT', null);
    expect(notice?.deprecatedAt?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('accepts a dateless `true` rather than discarding a real warning', () => {
    const notice = decideDeprecation('true', null);
    expect(notice).not.toBeNull();
    expect(notice?.deprecatedAt).toBeNull();
  });

  it('treats `false` as what it says — not deprecated', () => {
    expect(decideDeprecation('false', null)).toBeNull();
  });

  it('says nothing for a spelling it does not understand', () => {
    // Guessing here would put a banner in front of every patient on the
    // strength of a header nobody could parse.
    expect(decideDeprecation('soon', null)).toBeNull();
    expect(decideDeprecation('@not-a-number', null)).toBeNull();
    expect(decideDeprecation('@', null)).toBeNull();
  });

  it('carries the sunset when there is one', () => {
    const notice = decideDeprecation('true', SUNSET);
    expect(notice?.sunsetAt?.toISOString()).toBe('2033-12-31T23:59:59.000Z');
  });

  it('ignores an unreadable sunset instead of dropping the notice', () => {
    const notice = decideDeprecation('true', 'whenever');
    expect(notice).not.toBeNull();
    expect(notice?.sunsetAt).toBeNull();
  });

  it('does NOT treat a lone Sunset as a deprecation', () => {
    // The two headers are independent in the RFCs. Announcing a
    // retirement the server never declared would be inventing a fact.
    expect(decideDeprecation(null, SUNSET)).toBeNull();
  });
});

describe('the message a patient reads', () => {
  /** The key resolved against a catalogue — see `auth-error-message.test.ts`. */
  const sentence = (notice: Parameters<typeof deprecationMessage>[0], locale: Locale = 'en') => {
    const message = deprecationMessage(notice, locale);
    return interpolate(catalogues[locale][message.key], message.params);
  };

  it('asks for an update when there is no date to give', () => {
    expect(sentence({ deprecatedAt: null, sunsetAt: null })).toMatch(
      /newer version .* is available/i,
    );
  });

  it('names the date when the server gave one', () => {
    // Mid-year, not `SUNSET`: the date renders in the device's zone, and
    // one second before UTC midnight on 31 December is already 2034 on
    // any phone east of UTC — which is then the true date to show.
    const notice = { deprecatedAt: null, sunsetAt: new Date('2033-06-15T12:00:00.000Z') };

    expect(sentence(notice)).toMatch(/stops working on/i);
    // The year is the point of the long form, and it survives the
    // translation because it is interpolated rather than written into
    // either catalogue.
    expect(sentence(notice)).toMatch(/2033/);
    expect(sentence(notice, 'ar')).toMatch(/2033/);
  });

  it('gives the two cases different keys, so neither can read as the other', () => {
    expect(deprecationMessage({ deprecatedAt: null, sunsetAt: null }, 'en').key).not.toBe(
      deprecationMessage({ deprecatedAt: null, sunsetAt: new Date() }, 'en').key,
    );
  });
});

/** Drives the observers the way `ApiClient` does, without a network. */
function emit(headers: Record<string, string>): void {
  const observers = (apiClient as unknown as { responseObservers: Set<(h: Headers) => void> })
    .responseObservers;
  act(() => {
    for (const observer of [...observers]) observer(new Headers(headers));
  });
}

describe('the banner', () => {
  it('shows nothing until a response says so', () => {
    const { queryByTestId } = renderWithProviders(<DeprecationBanner />);

    emit({ 'Content-Type': 'application/json' });

    expect(queryByTestId('deprecation-banner')).toBeNull();
  });

  it('appears once a response carries the header', async () => {
    const { queryByTestId } = renderWithProviders(<DeprecationBanner />);

    emit({ [DEPRECATION_HEADER]: 'true', [SUNSET_HEADER]: SUNSET });

    await waitFor(() => expect(queryByTestId('deprecation-banner')).not.toBeNull());
  });

  it('is not retracted by a later response that omits the header', async () => {
    // A call that fell back to a cache, or hit an instance behind a
    // rollout, must not un-say what the server said.
    const { queryByTestId } = renderWithProviders(<DeprecationBanner />);
    emit({ [DEPRECATION_HEADER]: 'true' });
    await waitFor(() => expect(queryByTestId('deprecation-banner')).not.toBeNull());

    emit({ 'Content-Type': 'application/json' });

    expect(queryByTestId('deprecation-banner')).not.toBeNull();
  });

  it('detaches its observer on unmount', () => {
    const observers = (apiClient as unknown as { responseObservers: Set<unknown> })
      .responseObservers;
    const before = observers.size;

    const { unmount } = renderWithProviders(<DeprecationBanner />);
    expect(observers.size).toBe(before + 1);

    unmount();
    expect(observers.size).toBe(before);
  });
});
