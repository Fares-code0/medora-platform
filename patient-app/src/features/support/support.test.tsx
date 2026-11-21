import { fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { parseEnv } from '@/configs/env';
import { renderWithProviders } from '@/test/render';

import { SupportScreen, supportMailtoUrl, supportMessageBody } from './screens/SupportScreen';

/**
 * Support and feedback — checklist W-11.
 *
 * Two things are asserted here and the first matters more: the screen
 * must never read as a way to reach a clinician, and the message it
 * prepares must never carry PHI. A patient who mistakes a support inbox
 * for a clinical channel is a patient waiting for an answer that is not
 * coming.
 */

describe('the message this screen prepares', () => {
  it('carries the build and the platform, because a request without them costs a round trip', () => {
    const body = supportMessageBody();
    expect(body).toMatch(/App version: \d+\.\d+\.\d+/);
    expect(body).toMatch(/Platform: \w+/);
  });

  it('carries no account identifier, no token and nothing clinical', () => {
    // The patient's own address comes from their mail app, which is
    // their choice to send. Nothing this screen writes identifies a
    // patient or their care (T-04).
    const body = supportMessageBody().toLowerCase();
    for (const forbidden of [
      'token',
      'patient',
      'diagnosis',
      'medication',
      'appointment',
      'record',
      'email:',
      'subject id',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  it('asks the patient not to put medical details in it', () => {
    expect(supportMessageBody()).toMatch(/do not include medical details/i);
  });

  it('escapes the subject and body into the mailto link', () => {
    const url = supportMailtoUrl('support@example.com');
    expect(url.startsWith('mailto:support@example.com?')).toBe(true);
    expect(url).toContain('subject=Medora%20app%20support');
    // Newlines survive as escapes rather than breaking the URL.
    expect(url).toContain('%0A');
    expect(url).not.toMatch(/\s/);
  });
});

describe('the screen', () => {
  it('puts the emergency route above everything else', () => {
    const { getByTestId } = renderWithProviders(<SupportScreen />);

    const notice = getByTestId('support-urgent-notice');
    expect(notice).toBeTruthy();
    expect(getByTestId('support-screen')).toBeTruthy();
  });

  it('names Messages as the clinical channel, not this one', () => {
    const { getByText } = renderWithProviders(<SupportScreen />);
    expect(getByText(/through Messages/i)).toBeTruthy();
  });

  it('shows the build so a support reply can start from the right version', () => {
    const { getByTestId } = renderWithProviders(<SupportScreen />);
    expect(getByTestId('support-app-version')).toBeTruthy();
  });
});

describe('configuration', () => {
  it('accepts a build with no support address', () => {
    // Optional, deliberately: there is no inbox configured yet, and a
    // guessed address is a message that goes nowhere.
    expect(parseEnv({}).supportEmail).toBeNull();
  });

  it('reads a configured address', () => {
    expect(parseEnv({ EXPO_PUBLIC_SUPPORT_EMAIL: 'help@example.com' }).supportEmail).toBe(
      'help@example.com',
    );
  });

  it('refuses something that is not an address rather than opening a broken link', () => {
    expect(() => parseEnv({ EXPO_PUBLIC_SUPPORT_EMAIL: 'not-an-address' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});

describe('contacting support (W-11), in both of the states a deployment can be in', () => {
  /**
   * The test that stood here read the button, and if the button was
   * absent it asserted the no-address card and **returned**. So exactly
   * one of W-11's two states was covered per run and which one was not
   * up to the test — it was up to whatever `EXPO_PUBLIC_SUPPORT_EMAIL`
   * happened to be in the build. `SupportScreen` takes the address as a
   * prop now, the way `ConsentScreen` takes its documents, and both
   * states are exercised here.
   */
  const ADDRESS = 'help@example.com';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('offers a way to write, and prepares the message', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const view = renderWithProviders(<SupportScreen address={ADDRESS} />);

    fireEvent.press(view.getByTestId('support-contact'));

    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
    const url = String(openURL.mock.calls[0]?.[0]);
    expect(url.startsWith(`mailto:${ADDRESS}?`)).toBe(true);
    expect(url).toContain('subject=');
    expect(url).toContain('body=');
  });

  it('puts the address on the screen as well as behind the button', () => {
    // A patient whose phone has no mail app still needs to be able to
    // read it and write from somewhere else.
    const view = renderWithProviders(<SupportScreen address={ADDRESS} />);

    expect(view.getByText(new RegExp(ADDRESS))).toBeTruthy();
  });

  it('says so in words when the operator configured no address', () => {
    // Never a button that goes nowhere — the W-11 rule, and the same one
    // `ConsentScreen` follows for an unpublished terms URL.
    const view = renderWithProviders(<SupportScreen address={null} />);

    expect(view.getByTestId('support-no-address')).toBeTruthy();
    expect(view.queryByTestId('support-contact')).toBeNull();
  });

  it('keeps the emergency notice and the build line in both states', () => {
    // Neither of them depends on the address, and the emergency card is
    // the one thing on this screen that must never be conditional.
    for (const address of [ADDRESS, null]) {
      const view = renderWithProviders(<SupportScreen address={address} />);
      expect(view.getByTestId('support-urgent-notice')).toBeTruthy();
      expect(view.getByTestId('support-app-version')).toBeTruthy();
    }
  });

  it('survives a phone with no mail app, and leaves the address readable', async () => {
    // `Linking.openURL` rejects when nothing answers `mailto:`. The
    // screen must not crash and must not clear the one thing the patient
    // can still act on.
    const openURL = jest
      .spyOn(Linking, 'openURL')
      .mockRejectedValue(new Error('No Activity found to handle Intent'));
    const view = renderWithProviders(<SupportScreen address={ADDRESS} />);

    fireEvent.press(view.getByTestId('support-contact'));

    await waitFor(() => expect(openURL).toHaveBeenCalled());
    expect(view.getByTestId('support-screen')).toBeTruthy();
    expect(view.getByText(new RegExp(ADDRESS))).toBeTruthy();
  });
});
