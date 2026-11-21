import { fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { renderWithProviders } from '@/test/render';

import { CONSENT_VERSION, openConsentDocument } from './consent';
import { ConsentScreen } from './screens/ConsentScreen';

/**
 * Terms and privacy — checklist E-05.
 *
 * Registration has collected both consents since the form existed, and
 * sends them for real (`POST /auth/register` is live). What this adds is
 * the ability to READ what is being ticked, so the tests are about the
 * two states that decide whether that is honest: a published document,
 * and a deployment that has not published one.
 *
 * The version is asserted as *shown* and never as *sent*: the register
 * payload has no field for it (BE-01), and `consent.ts` carries the
 * argument against inventing one.
 */

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stubLinking(result: void | Error = undefined) {
  const spy = jest.spyOn(Linking, 'openURL');
  if (result instanceof Error) spy.mockRejectedValue(result);
  else spy.mockResolvedValue(result);
  installed.push(spy);
  return spy;
}

describe('opening a document', () => {
  it('opens an https URL in the browser', async () => {
    const openURL = stubLinking();

    await expect(openConsentDocument('https://example.org/terms')).resolves.toBe(true);
    expect(openURL).toHaveBeenCalledWith('https://example.org/terms');
  });

  it('refuses anything that is not https, whatever the configuration says', async () => {
    const openURL = stubLinking();

    // Boot validation is a deployment guard; this is the call site that
    // hands a string to the OS, and the check belongs where the harm is
    // — the same argument `dial.ts` makes about a phone number.
    for (const hostile of ['javascript:alert(1)', 'medora://profile', 'http://example.org/terms']) {
      await expect(openConsentDocument(hostile)).resolves.toBe(false);
    }
    expect(openURL).not.toHaveBeenCalled();
  });

  it('reports failure rather than throwing when there is no browser', async () => {
    stubLinking(new Error('no activity found'));

    // A consent screen that crashes is worse than one that cannot open a
    // page: the caller renders a message and the screen survives.
    await expect(openConsentDocument('https://example.org/terms')).resolves.toBe(false);
  });
});

describe('the screen, with nothing published', () => {
  it('says so instead of offering a button that goes nowhere', async () => {
    // `env` defaults both URLs to null, which is the shipped state.
    const view = renderWithProviders(<ConsentScreen />);

    expect(await view.findByTestId('consent-terms-unpublished')).toBeTruthy();
    expect(view.getByTestId('consent-privacy-unpublished')).toBeTruthy();
    expect(view.queryByTestId('consent-terms-open')).toBeNull();
  });

  it('still names both documents and the version they are', async () => {
    const view = renderWithProviders(<ConsentScreen />);

    expect(await view.findByText('Terms and conditions')).toBeTruthy();
    expect(view.getByText('Privacy policy')).toBeTruthy();
    // Shown so a patient can tell which document they read. Not sent:
    // the register payload has no field for it (BE-01).
    expect(view.getByText(`Version ${CONSENT_VERSION}`)).toBeTruthy();
  });
});

describe('the screen, with documents published', () => {
  /**
   * Through the `documents` seam rather than by re-importing the module
   * graph: `env` is read once at load, and `jest.resetModules()` takes
   * React with it — which is how this file first failed, with the
   * testing library unable to detect host components at all.
   */
  const PUBLISHED = [
    { id: 'terms' as const, url: 'https://example.org/terms' },
    { id: 'privacy' as const, url: 'https://example.org/privacy' },
  ];

  it('offers each one, and opens the one that was pressed', async () => {
    const openURL = stubLinking();
    const view = renderWithProviders(<ConsentScreen documents={PUBLISHED} />);

    fireEvent.press(await view.findByTestId('consent-privacy-open'));

    await waitFor(() => {
      expect(openURL).toHaveBeenCalledWith('https://example.org/privacy');
    });
  });

  it('says so on screen when the document will not open', async () => {
    stubLinking(new Error('no browser'));
    const view = renderWithProviders(<ConsentScreen documents={PUBLISHED} />);

    fireEvent.press(await view.findByTestId('consent-terms-open'));

    expect(await view.findByTestId('consent-open-failed')).toBeTruthy();
  });
});
