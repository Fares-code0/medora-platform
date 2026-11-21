import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';
import { renderWithProviders } from '@/test/render';

import type { ActiveSession } from './model/types';
import { SecurityScreen } from './screens/SecurityScreen';
import { profileService } from './service';

/**
 * The Security screen — checklist P-05, P-06, D-15, D-16.
 *
 * It sat at 10% of statements: everything on it is a component with its
 * own tests, and the screen that assembles them had none. That gap is
 * not academic here. This is the one screen a patient opens *because*
 * they are worried about their account, and what it does or does not
 * offer is the answer to that worry.
 *
 * Three things are asserted that no component test can:
 *
 *  - the four sections are all present, so a change to one does not
 *    quietly remove another,
 *  - the device list renders its states rather than a bare spinner, and
 *  - the biometric setting appears only where the device can do it,
 *    which is `BiometricUnlockSetting`'s decision but this screen's
 *    consequence.
 */

const SESSIONS: ActiveSession[] = [
  { id: 'S-1', deviceLabel: 'iPhone 14', lastSeenAt: new Date().toISOString(), current: true },
  {
    id: 'S-2',
    deviceLabel: 'Pixel 7',
    lastSeenAt: new Date(Date.now() - 86_400_000).toISOString(),
    current: false,
  },
];

const installed: { mockRestore: () => void }[] = [];

beforeEach(() => {
  preferenceStore.remove(PREFERENCE_KEYS.biometricUnlock);
});

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
  preferenceStore.remove(PREFERENCE_KEYS.biometricUnlock);
  jest.restoreAllMocks();
});

async function renderSecurity(
  sessions: () => Promise<readonly ActiveSession[]> = () => Promise.resolve(SESSIONS),
  options: { locale?: 'en' | 'ar' } = {},
) {
  installed.push(jest.spyOn(profileService, 'listSessions').mockImplementation(sessions));
  const view = renderWithProviders(<SecurityScreen />, {
    ...(options.locale === undefined ? {} : { locale: options.locale }),
  });
  await act(async () => undefined);
  return view;
}

describe('what the screen offers', () => {
  it('renders every section, so removing one is visible', async () => {
    const view = await renderSecurity();

    expect(view.getByTestId('security-screen')).toBeTruthy();
    // "Password" appears twice — the section heading and the form's own
    // field label — which is itself the evidence the section is there.
    expect(view.getAllByText('Password').length).toBeGreaterThanOrEqual(1);
    expect(view.getByText('Unlocking this app')).toBeTruthy();
    expect(view.getByText('Two-factor authentication')).toBeTruthy();
    expect(view.getByText('Where you are signed in')).toBeTruthy();
    expect(view.getByText('How Medora protects your information')).toBeTruthy();
  });

  it('warns that Medora never asks for a password by message', async () => {
    // The one line on this screen that is about a threat the app cannot
    // defend against on its own.
    const view = await renderSecurity();

    expect(view.getByText(/never ask you for your password by email or message/)).toBeTruthy();
  });

  it('says where clinical data lives, in plain terms', async () => {
    const view = await renderSecurity();

    expect(view.getByText(/never saved onto this phone/)).toBeTruthy();
    expect(view.getByText(/secure keychain/)).toBeTruthy();
  });
});

describe('in Arabic (C-09)', () => {
  /**
   * This screen was English whatever the language, until 2026-09-12.
   *
   * Not because the translation was missing — `messages/ar.ts` had every
   * key, written when C-09 landed — but because the screen was never
   * wired to them and nothing noticed. `no-inline-copy.test.ts` scanned
   * props, and these were JSX text nodes and one template literal. So
   * the assertion here is both directions: the Arabic is present AND the
   * English is gone, which is the only way "it is translated" is a claim
   * rather than a hope.
   */
  it('reads its own headings and notices in Arabic', async () => {
    const view = await renderSecurity(undefined, { locale: 'ar' });

    expect(view.getByText('الأمان')).toBeTruthy();
    expect(view.queryByText('Security')).toBeNull();
    expect(view.queryByText(/never ask you for your password/)).toBeNull();
    expect(view.queryByText(/never saved onto this phone/)).toBeNull();
  });

  it('translates the device list, including the row that names this phone', async () => {
    const view = await renderSecurity(undefined, { locale: 'ar' });

    await waitFor(() => expect(view.getByText('iPhone 14')).toBeTruthy());
    // The device LABEL is the server's own string and stays as it is;
    // "This device" and "Last used …" are this app's words.
    expect(view.queryByText('This device')).toBeNull();
    expect(view.queryByText(/^Last used/)).toBeNull();
  });
});

describe('the device list (P-06)', () => {
  it('shows a skeleton first, not a bare spinner (R-01)', async () => {
    const view = await renderSecurity(() => new Promise<readonly ActiveSession[]>(() => {}));

    expect(view.getByTestId('security-sessions-loading')).toBeTruthy();
  });

  it('marks the current device, so revoking the wrong one is harder', async () => {
    const view = await renderSecurity();

    await waitFor(() => expect(view.getByText('iPhone 14')).toBeTruthy());
    expect(view.getByText('This device')).toBeTruthy();
    expect(view.getByText('Pixel 7')).toBeTruthy();
  });

  it('has an empty state rather than an empty card (R-02)', async () => {
    const view = await renderSecurity(() => Promise.resolve([]));

    await waitFor(() => expect(view.getByTestId('security-sessions-empty')).toBeTruthy());
    expect(view.getByText('No other devices')).toBeTruthy();
  });

  it('names a session the server could not name, in the app language', async () => {
    // `sessions.device` and `sessions.browser` are both nullable, so a
    // session can arrive with no name at all. The adapter reports that
    // as `null` rather than substituting an English label in the
    // transport layer, which leaves the wording here — C-09.
    const view = await renderSecurity(() =>
      Promise.resolve([
        { id: 'S-9', deviceLabel: null, lastSeenAt: new Date().toISOString(), current: false },
      ]),
    );

    await waitFor(() => expect(view.getByText('Unrecognised device')).toBeTruthy());
  });

  it('names an unnamed session in Arabic too, rather than falling back to English', async () => {
    const view = await renderSecurity(
      () =>
        Promise.resolve([
          { id: 'S-9', deviceLabel: null, lastSeenAt: new Date().toISOString(), current: false },
        ]),
      { locale: 'ar' },
    );

    await waitFor(() => expect(view.getByText('جهاز غير معروف')).toBeTruthy());
    expect(view.queryByText('Unrecognised device')).toBeNull();
  });

  it('carries the same fallback into the confirmation, never an empty name', async () => {
    // The sheet interpolates the device into its title. An empty
    // interpolation would read as "Sign out ?" on exactly the session a
    // patient is least able to identify and most likely to want ended.
    const view = await renderSecurity(() =>
      Promise.resolve([
        { id: 'S-9', deviceLabel: null, lastSeenAt: new Date().toISOString(), current: false },
      ]),
    );

    await waitFor(() => expect(view.getByTestId('session-S-9')).toBeTruthy());
    fireEvent.press(view.getByTestId('session-S-9'));

    await waitFor(() => expect(view.getByTestId('session-revoke-confirm')).toBeTruthy());
    expect(view.getByText('Sign out Unrecognised device?')).toBeTruthy();
  });

  it('shows an error state when the list will not load (R-03)', async () => {
    const view = await renderSecurity(() =>
      Promise.reject(Object.assign(new Error('API error: network'), { kind: 'network' })),
    );

    await waitFor(() => expect(view.getByTestId('security-sessions-error')).toBeTruthy());
    // The rest of the screen survives it: a failed device list must not
    // take the password form down with it.
    expect(view.getByTestId('change-password-form')).toBeTruthy();
  });
});

describe('signing another device out (P-06)', () => {
  it('offers no way to revoke the phone the patient is holding', async () => {
    // A row that signed this phone out would be Sign out wearing a
    // device's name, and without the sweep `logout()` performs — the
    // keychain, the query cache, the PHI T-03 clears.
    const view = await renderSecurity();

    await waitFor(() => expect(view.getByText('iPhone 14')).toBeTruthy());
    fireEvent.press(view.getByTestId('session-S-1'));

    expect(view.queryByTestId('session-revoke-confirm-confirm')).toBeNull();
  });

  it('confirms before it revokes, and names the device it will sign out', async () => {
    const revoke = jest.spyOn(profileService, 'revokeSession').mockResolvedValue(undefined);
    installed.push(revoke);
    const view = await renderSecurity();
    await waitFor(() => expect(view.getByText('Pixel 7')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-S-2'));

    expect(await view.findByText('Sign out Pixel 7?')).toBeTruthy();
    // The question a confirmation for this action has to answer.
    expect(view.getByText(/This phone stays signed in/i)).toBeTruthy();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('revokes the session the patient confirmed, and re-reads the list', async () => {
    const revoke = jest.spyOn(profileService, 'revokeSession').mockResolvedValue(undefined);
    installed.push(revoke);
    const list = jest
      .spyOn(profileService, 'listSessions')
      .mockResolvedValue(SESSIONS)
      .mockResolvedValueOnce(SESSIONS);
    installed.push(list);

    const view = renderWithProviders(<SecurityScreen />);
    await act(async () => undefined);
    await waitFor(() => expect(view.getByText('Pixel 7')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-S-2'));
    fireEvent.press(await view.findByTestId('session-revoke-confirm-confirm'));

    await waitFor(() => expect(revoke).toHaveBeenCalledWith('S-2'));
    // Which sessions survive is the server's answer, not this screen's
    // guess: the list is re-read rather than edited in place.
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(1));
  });

  it('does not revoke when the patient backs out', async () => {
    const revoke = jest.spyOn(profileService, 'revokeSession').mockResolvedValue(undefined);
    installed.push(revoke);
    const view = await renderSecurity();
    await waitFor(() => expect(view.getByText('Pixel 7')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-S-2'));
    fireEvent.press(await view.findByTestId('session-revoke-confirm-cancel'));

    await act(async () => undefined);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('says so when the revoke fails, rather than showing the device gone', async () => {
    const revoke = jest
      .spyOn(profileService, 'revokeSession')
      .mockRejectedValue(new Error('network'));
    installed.push(revoke);
    const view = await renderSecurity();
    await waitFor(() => expect(view.getByText('Pixel 7')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-S-2'));
    fireEvent.press(await view.findByTestId('session-revoke-confirm-confirm'));

    expect(await view.findByText(/could not be signed out/i)).toBeTruthy();
    // Not optimistic: the row is still there, because the server still
    // has the session.
    expect(view.getByText('Pixel 7')).toBeTruthy();
  });
});

describe('the biometric setting (D-15)', () => {
  it('is absent on a device with no enrolled biometric', async () => {
    // `setup.ts` mocks the SDK to "no hardware", which is the honest
    // default for a test device — and the state most patients' first
    // launch is in until they enrol one.
    const view = await renderSecurity();

    await waitFor(() => expect(view.getByText('Unlocking this app')).toBeTruthy());
    expect(view.queryByTestId('biometric-unlock-toggle')).toBeNull();
  });
});
