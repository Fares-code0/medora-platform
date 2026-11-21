import { fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { renderWithProviders } from '@/test/render';

import { EmergencyCallButton } from './components/EmergencyCallButton';
import { EMERGENCY_DISCLAIMER, RED_FLAGS } from './content/guidance';
import { dial, isDialable, openMap } from './dial';
import { UNCONFIGURED_EMERGENCY } from './model/types';
import { EmergencyScreen } from './screens/EmergencyScreen';
import { emergencyService } from './service';

/**
 * Emergency tests.
 *
 * These are the assertions behind the guarantees the feature exists for,
 * and every one of them is a property that a plausible refactor could
 * break silently:
 *
 *  - it renders with no session and no network,
 *  - it never invents a number,
 *  - nothing dials on one tap,
 *  - cancel really cancels.
 */

describe('the screen renders with nothing available', () => {
  it('renders with no session, no network and no API', () => {
    // No SessionProvider, no NetworkProvider, no fetch stub — if this
    // screen needed any of them, this test would fail (checklist N-06).
    const { getByTestId } = renderWithProviders(<EmergencyScreen />);
    expect(getByTestId('emergency-screen')).toBeTruthy();
  });

  it('shows the disclaimer, and it is not dismissible', () => {
    const { getByTestId, queryByLabelText } = renderWithProviders(<EmergencyScreen />);

    expect(getByTestId('emergency-disclaimer').props.accessibilityLabel).toBe(EMERGENCY_DISCLAIMER);
    // There is no control that could hide it.
    expect(queryByLabelText('Dismiss')).toBeNull();
    expect(queryByLabelText('Close')).toBeNull();
  });

  it('announces the disclaimer as an alert', () => {
    const { getByTestId } = renderWithProviders(<EmergencyScreen />);
    expect(getByTestId('emergency-disclaimer').props.accessibilityRole).toBe('alert');
  });

  it('renders every red flag from bundled content', () => {
    const { getByText } = renderWithProviders(<EmergencyScreen />);
    for (const flag of RED_FLAGS) {
      expect(getByText(flag.title)).toBeTruthy();
    }
  });

  it('renders in the dark theme', () => {
    const { getByTestId } = renderWithProviders(<EmergencyScreen />, { mode: 'dark' });
    expect(getByTestId('emergency-screen')).toBeTruthy();
  });
});

describe('no number is invented', () => {
  it('ships with an empty configuration', async () => {
    const configuration = await emergencyService.getConfiguration();
    expect(configuration.numbers).toEqual([]);
    expect(configuration.source).toBe('unconfigured');
  });

  it('the default configuration is empty and says so', () => {
    expect(UNCONFIGURED_EMERGENCY.numbers).toHaveLength(0);
    expect(UNCONFIGURED_EMERGENCY.clinic).toBeNull();
  });

  it('tells the patient to use their local number instead of showing one', async () => {
    const { getByTestId, findByText } = renderWithProviders(<EmergencyScreen />);

    expect(getByTestId('emergency-numbers-unconfigured')).toBeTruthy();
    expect(await findByText('Call your local emergency number')).toBeTruthy();
  });

  it('contains no dialable digit sequence anywhere in the bundled content', () => {
    // The guard against somebody "just adding 911 for now": a bare
    // 3-to-4 digit number in emergency copy is almost certainly one.
    const content = [
      EMERGENCY_DISCLAIMER,
      ...RED_FLAGS.flatMap((flag) => [flag.title, flag.detail]),
    ].join(' ');
    expect(content).not.toMatch(/\b\d{3,4}\b/);
  });
});

describe('two-step dial (N-03, R-6)', () => {
  beforeEach(() => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not dial on the first tap', () => {
    const { getByTestId } = renderWithProviders(
      <EmergencyCallButton label="the ambulance service" number="112" testID="call" />,
    );

    fireEvent.press(getByTestId('call'));
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('opens a confirmation that names the number', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <EmergencyCallButton label="the ambulance service" number="112" testID="call" />,
    );

    fireEvent.press(getByTestId('call'));
    expect(getByText('Call the ambulance service?')).toBeTruthy();
    // Naming the number IS the confirmation — on the button and in the body.
    expect(getByText('Call 112')).toBeTruthy();
    expect(getByText(/Medora will open your phone's dialler with 112/)).toBeTruthy();
  });

  it('dials only after the confirmation is accepted', async () => {
    const { getByTestId } = renderWithProviders(
      <EmergencyCallButton label="the ambulance service" number="112" testID="call" />,
    );

    fireEvent.press(getByTestId('call'));
    fireEvent.press(getByTestId('call-confirm-sheet-confirm'));

    await waitFor(() => {
      expect(Linking.openURL).toHaveBeenCalledWith('tel:112');
    });
  });

  it('cancels without dialling', () => {
    const { getByTestId, queryByText } = renderWithProviders(
      <EmergencyCallButton label="the ambulance service" number="112" testID="call" />,
    );

    fireEvent.press(getByTestId('call'));
    fireEvent.press(getByTestId('call-confirm-sheet-cancel'));

    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(queryByText('Call the ambulance service?')).toBeNull();
  });

  it('tells a screen-reader user that the tap only opens a confirmation', () => {
    const { getByTestId } = renderWithProviders(
      <EmergencyCallButton label="the ambulance service" number="112" testID="call" />,
    );
    expect(getByTestId('call').props.accessibilityHint).toContain('confirmation');
  });
});

describe('dial()', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts real dial strings', () => {
    expect(isDialable('112')).toBe(true);
    expect(isDialable('+962 6 000 0000')).toBe(true);
    expect(isDialable('(01) 234-5678')).toBe(true);
  });

  it('rejects anything that is not a phone number', () => {
    // The number arrives from operator configuration over the network, so
    // it is untrusted input and `openURL` opens any scheme it is given.
    expect(isDialable('sms:112')).toBe(false);
    expect(isDialable('javascript:alert(1)')).toBe(false);
    expect(isDialable('medora://profile')).toBe(false);
    expect(isDialable('')).toBe(false);
  });

  it('refuses to open a URL for a non-number', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await expect(dial('https://evil.example')).resolves.toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('strips spaces from the tel: URL', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await dial('+962 6 000 0000');
    expect(openURL).toHaveBeenCalledWith('tel:+96260000000');
  });

  it('reports failure rather than throwing when there is no dialler', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await expect(dial('112')).resolves.toBe(false);
  });
});

describe('openMap()', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a maps link from an address string, with no location permission', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await openMap('14 Al-Nahda Street, Amman');

    expect(openURL).toHaveBeenCalledWith(expect.stringContaining('14%20Al-Nahda%20Street'));
  });

  it('reports failure rather than throwing when there is no maps app', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    await expect(openMap('somewhere')).resolves.toBe(false);
  });
});
