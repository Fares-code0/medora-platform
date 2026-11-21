import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import { renderWithProviders } from '@/test/render';

import type { NotificationPreferences } from './model/types';
import {
  DEFAULT_PREFERENCES,
  isCategoryLocked,
  isChannelAvailable,
  isTimeOfDay,
  PATIENT_CATEGORIES,
  PATIENT_CHANNELS,
  quietHoursIssue,
  setCategory,
  setChannel,
  setQuietHours,
} from './preferences';
import { NotificationPrefsScreen } from './screens/NotificationPrefsScreen';
import { notificationService } from './service';

/**
 * Notification settings — checklist O-06.
 *
 * The rules are tested as rules (pure, in every language at once) and
 * the screen is tested for the three things a rule cannot enforce on its
 * own: that the locked category is never rendered as a control, that the
 * unavailable channel is not either, and that a failed write puts the
 * switch back and says so.
 */

const PREFERENCES: NotificationPreferences = {
  ...DEFAULT_PREFERENCES,
  channels: { ...DEFAULT_PREFERENCES.channels, sms: false },
};

const installed: { mockRestore: () => void }[] = [];

function stub<K extends 'getPreferences' | 'updatePreferences'>(method: K) {
  const spy = jest.spyOn(notificationService, method);
  installed.push(spy);
  return spy;
}

function renderPrefs(preferences: NotificationPreferences = PREFERENCES) {
  stub('getPreferences').mockResolvedValue(preferences);
  return renderWithProviders(<NotificationPrefsScreen />);
}

/** A write held open, so the assertion in between sees only the optimism. */
function heldWrite() {
  let release!: (value: NotificationPreferences) => void;
  const promise = new Promise<NotificationPreferences>((resolve) => {
    release = resolve;
  });
  return {
    promise,
    async release(value: NotificationPreferences) {
      release(value);
      await act(async () => {
        await promise;
      });
    },
  };
}

afterEach(() => {
  while (installed.length > 0) installed.pop()?.mockRestore();
});

describe('the rules (preferences.ts)', () => {
  it('refuses to switch a locked category off, and allows it on', () => {
    expect(isCategoryLocked('security')).toBe(true);
    expect(setCategory(PREFERENCES, 'security', false)).toBe(PREFERENCES);
    expect(setCategory(PREFERENCES, 'security', true).categories.security).toBe(true);
  });

  it('edits an ordinary category without touching its neighbours', () => {
    const next = setCategory(PREFERENCES, 'pharmacy', false);

    expect(next.categories.pharmacy).toBe(false);
    expect(next.categories.laboratory).toBe(true);
    // The write is a whole row, so what the screen does not render has
    // to survive it. `patients` and `ai` are deliberately off-screen.
    expect(next.categories.patients).toBe(PREFERENCES.categories.patients);
    expect(next.categories.ai).toBe(PREFERENCES.categories.ai);
  });

  it('leaves `desktop` alone when a channel changes', () => {
    const next = setChannel(PREFERENCES, 'email', false);

    expect(next.channels.email).toBe(false);
    expect(next.channels.desktop).toBe(PREFERENCES.channels.desktop);
  });

  it('does not pretend to edit a channel this build cannot deliver', () => {
    expect(isChannelAvailable('push')).toBe(false);
    expect(setChannel(PREFERENCES, 'push', false)).toBe(PREFERENCES);
  });

  it('accepts a 24-hour time and rejects everything else', () => {
    for (const valid of ['00:00', '09:30', '22:00', '23:59']) {
      expect(isTimeOfDay(valid)).toBe(true);
    }
    for (const invalid of ['24:00', '7:00', '22:60', '22-00', 'evening', '']) {
      expect(isTimeOfDay(invalid)).toBe(false);
    }
  });

  it('treats a window across midnight as normal and an empty one as wrong', () => {
    // The usual case, and the one a naive from < to check would reject.
    expect(quietHoursIssue('22:00', '07:00')).toBeNull();
    expect(quietHoursIssue('22:00', '22:00')).toBe('notificationPrefs.quietHours.identical');
    expect(quietHoursIssue('22:0', '07:00')).toBe('notificationPrefs.quietHours.invalid');
  });

  it('keeps the quiet window when only the switch moves', () => {
    const next = setQuietHours(PREFERENCES, { enabled: true });

    expect(next.quietHours).toEqual({ enabled: true, from: '22:00', to: '07:00' });
  });

  it('renders only channels and categories a patient can act on', () => {
    expect(PATIENT_CHANNELS).not.toContain('desktop');
    expect(PATIENT_CATEGORIES).not.toContain('patients');
    // Phase K is closed on AD-4. A preference row is a promise that the
    // feature exists.
    expect(PATIENT_CATEGORIES).not.toContain('ai');
  });
});

describe('the screen', () => {
  it('states that security alerts are always on instead of offering a switch', async () => {
    const { findByTestId, getByText } = renderPrefs();

    const row = await findByTestId('category-security');

    // A read-only row, not a checkbox: `Checkbox` marks itself
    // `accessibilityRole: 'checkbox'`, and the absence of that role is
    // the assertion — a control that snaps back is worse than no control.
    expect(row.props.accessibilityRole).not.toBe('checkbox');
    expect(getByText('Always on')).toBeTruthy();
  });

  it('does not offer to turn on a push notification it cannot send', async () => {
    const { findByTestId, getByText } = renderPrefs();

    const row = await findByTestId('channel-push');

    expect(row.props.accessibilityRole).not.toBe('checkbox');
    expect(getByText('Not available yet')).toBeTruthy();
  });

  it('says urgent alerts still arrive, whether quiet hours are on or off', async () => {
    const { findByTestId } = renderPrefs();

    // Visible before the switch is touched: it is what the patient needs
    // in order to decide, not a reassurance afterwards.
    expect(await findByTestId('quiet-hours-urgent-note')).toBeTruthy();
  });

  it('moves the switch on the tap, not on the response', async () => {
    const write = heldWrite();
    stub('updatePreferences').mockReturnValue(write.promise);
    const { findByTestId } = renderPrefs();

    const sms = await findByTestId('channel-sms');
    expect(sms.props.accessibilityState.checked).toBe(false);

    fireEvent.press(sms);

    await waitFor(() => {
      expect(sms.props.accessibilityState.checked).toBe(true);
    });

    await write.release({ ...PREFERENCES, channels: { ...PREFERENCES.channels, sms: true } });
  });

  it('puts the switch back and says so when the write fails', async () => {
    stub('updatePreferences').mockRejectedValue(
      Object.assign(new Error('offline'), { kind: 'network' }),
    );
    const { findByTestId, findByText } = renderPrefs();

    const sms = await findByTestId('channel-sms');
    fireEvent.press(sms);

    expect(await findByText('That setting could not be saved. It has been put back.')).toBeTruthy();
    await waitFor(() => {
      expect(sms.props.accessibilityState.checked).toBe(false);
    });
  });

  it('shows the quiet window once both times are valid, and the fault while one is not', async () => {
    stub('updatePreferences').mockImplementation((next) => Promise.resolve(next));
    const { findByTestId, queryByTestId } = renderPrefs({
      ...PREFERENCES,
      quietHours: { enabled: true, from: '22:00', to: '07:00' },
    });

    const to = await findByTestId('quiet-hours-to');
    fireEvent.changeText(to, '07:0');

    await waitFor(() => {
      expect(queryByTestId('quiet-hours-error')).not.toBeNull();
    });
    expect(queryByTestId('quiet-hours-window')).toBeNull();

    fireEvent.changeText(to, '07:05');

    await waitFor(() => {
      expect(queryByTestId('quiet-hours-window')).not.toBeNull();
    });
  });

  it('says the settings are not available yet rather than showing invented ones', async () => {
    // A service that refuses by name (a build whose adapter cannot reach
    // the route) must not make the screen fall back to its own defaults.
    stub('getPreferences').mockRejectedValue(
      new EndpointNotImplementedError('BE-00', 'capability.messages'),
    );
    const { findByText, queryByTestId } = renderWithProviders(<NotificationPrefsScreen />);

    expect(await findByText(/not available yet/i)).toBeTruthy();
    expect(queryByTestId('category-security')).toBeNull();
  });
});
