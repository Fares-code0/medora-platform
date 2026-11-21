import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Linking } from 'react-native';

import { renderWithProviders } from '@/test/render';

import type { EmergencyConfiguration } from './model/types';
import { EmergencyScreen } from './screens/EmergencyScreen';
import { emergencyService } from './service';

/**
 * The Emergency screen once an operator HAS configured it — N-04, N-05.
 *
 * `emergency.test.tsx` covers the shipped state, which is unconfigured:
 * no number is invented, and the screen says to use the local emergency
 * number instead. That left the configured half — every branch a real
 * deployment actually takes — at 42.9% of branches, on the one screen in
 * this app where a wrong render is a safety problem rather than a bug.
 *
 * What is asserted here is the same set of guarantees, on the other side
 * of the condition: the operator's numbers are rendered **verbatim**, the
 * two-step gate still stands in front of every one of them, the clinic's
 * own line is a dial and not a link, and a configuration that fails to
 * load leaves the screen whole rather than empty.
 */

const CONFIGURED: EmergencyConfiguration = {
  numbers: [
    { id: 'amb', label: 'Ambulance', number: '997', whenToUse: 'Life-threatening emergencies' },
    { id: 'poison', label: 'Poison control', number: '937' },
  ],
  clinic: {
    name: 'Medora Clinic',
    phone: '+966 11 555 0100',
    addressLine: '4th Floor, 21 King Fahd Road, Riyadh',
  },
  source: 'operator',
};

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
  jest.restoreAllMocks();
});

async function renderConfigured(configuration: EmergencyConfiguration = CONFIGURED) {
  installed.push(jest.spyOn(emergencyService, 'getConfiguration').mockResolvedValue(configuration));
  const view = renderWithProviders(<EmergencyScreen />);
  await act(async () => undefined);
  return view;
}

describe("the operator's numbers are rendered, verbatim", () => {
  it('renders one call button per configured number', async () => {
    const view = await renderConfigured();

    await waitFor(() => expect(view.getByTestId('emergency-call-amb')).toBeTruthy());
    expect(view.getByTestId('emergency-call-poison')).toBeTruthy();
    // And the unconfigured card is gone — the two are exclusive, so a
    // screen showing both would be telling the patient two things.
    expect(view.queryByTestId('emergency-numbers-unconfigured')).toBeNull();
  });

  it('shows the operator line about when to use one, and omits it when there is none', async () => {
    const view = await renderConfigured();

    await waitFor(() => expect(view.getByText('Life-threatening emergencies')).toBeTruthy());
    // Poison control has no `whenToUse`; nothing is invented for it.
    expect(view.getByText('Call Poison control')).toBeTruthy();
  });

  it('names the region the numbers came from, rather than implying they are universal', async () => {
    const view = await renderConfigured();

    await waitFor(() =>
      expect(view.getByText('Numbers provided by your clinic for this region')).toBeTruthy(),
    );
  });
});

describe('the two-step gate stands in front of a configured number too (N-03, R-6)', () => {
  it('does not dial on the first tap', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const view = await renderConfigured();

    const button = await waitFor(() => view.getByTestId('emergency-call-amb'));
    fireEvent.press(button);

    expect(open).not.toHaveBeenCalled();
    expect(view.getByText('Call Ambulance?')).toBeTruthy();
  });

  it('names the number in the confirmation, which is what makes it a confirmation', async () => {
    const view = await renderConfigured();

    fireEvent.press(await waitFor(() => view.getByTestId('emergency-call-amb')));

    // Twice, and both deliberately: the sheet's sentence names it, and
    // so does the confirm button, so the number is on screen wherever
    // the patient's eye lands before they commit.
    expect(view.getAllByText(/997/).length).toBeGreaterThanOrEqual(2);
    expect(view.getByText('Call 997')).toBeTruthy();
  });

  it('dials the operator string exactly, once confirmed', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const view = await renderConfigured();

    fireEvent.press(await waitFor(() => view.getByTestId('emergency-call-amb')));
    await act(async () => {
      fireEvent.press(view.getByText('Call 997'));
    });

    await waitFor(() => expect(open).toHaveBeenCalledWith('tel:997'));
  });
});

describe("the clinic's own contact (N-05)", () => {
  it('offers the clinic as a dial, behind the same gate', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const view = await renderConfigured();

    const button = await waitFor(() => view.getByTestId('emergency-call-clinic'));
    fireEvent.press(button);

    expect(open).not.toHaveBeenCalled();
    // The clinic number carries spaces as the operator wrote them; the
    // `tel:` URL strips them, and `dial.ts` owns that.
    expect(view.getAllByText(/\+966 11 555 0100/).length).toBeGreaterThanOrEqual(1);
    expect(view.getByText('Call +966 11 555 0100')).toBeTruthy();
  });

  it('hands the address to the maps app rather than resolving it here', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    const view = await renderConfigured();

    await act(async () => {
      fireEvent.press(await waitFor(() => view.getByText('Open in maps')));
    });

    await waitFor(() => expect(open).toHaveBeenCalled());
    const url = String(open.mock.calls.at(-1)?.[0]);
    expect(url).toContain('King%20Fahd');
    // No coordinates: this works with no location permission at all
    // (Q-03, Q-04).
    expect(url).not.toMatch(/-?\d+\.\d+,-?\d+\.\d+/);
  });

  it('shows no clinic section when the operator configured none', async () => {
    const view = await renderConfigured({ ...CONFIGURED, clinic: null });

    await waitFor(() => expect(view.getByTestId('emergency-call-amb')).toBeTruthy());
    expect(view.queryByTestId('emergency-call-clinic')).toBeNull();
    expect(view.queryByText('Open in maps')).toBeNull();
  });
});

describe('a configuration that will not load', () => {
  it('leaves the screen whole, with no error and no spinner', async () => {
    // The hook swallows the failure on purpose: the bundled guidance IS
    // the screen, and operator numbers are an addition to it. A patient
    // in crisis must never meet a retry button here.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    installed.push(
      jest.spyOn(emergencyService, 'getConfiguration').mockRejectedValue(new Error('no network')),
    );

    const view = renderWithProviders(<EmergencyScreen />);
    await act(async () => undefined);

    expect(view.getByTestId('emergency-screen')).toBeTruthy();
    expect(view.getByTestId('emergency-numbers-unconfigured')).toBeTruthy();
    expect(view.queryByText('Try again')).toBeNull();
  });
});

describe('a device that cannot dial says the number out loud instead', () => {
  it('shows the number as readable text when the dialler will not open', async () => {
    // A dead button on this screen is worse than no button. `openURL`
    // REJECTS on a device with no dialler — a tablet, an emulator —
    // `dial()` reports that rather than throwing, and the fallback
    // exists so the number can still be read aloud to somebody who does
    // have a phone.
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no dialler'));
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});
    const view = await renderConfigured();

    fireEvent.press(await waitFor(() => view.getByTestId('emergency-call-amb')));
    await act(async () => {
      fireEvent.press(view.getByText('Call 997'));
    });

    await waitFor(() =>
      expect(
        view.getByText('This device cannot place calls. Dial this number from another phone:'),
      ).toBeTruthy(),
    );
    // Announced too, because a screen-reader user gets no visual cue
    // that the tap did nothing.
    expect(announce).toHaveBeenCalledWith(expect.stringContaining('997'));
  });

  it('shows nothing of the sort while the dialler works', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const view = await renderConfigured();

    fireEvent.press(await waitFor(() => view.getByTestId('emergency-call-amb')));
    await act(async () => {
      fireEvent.press(view.getByText('Call 997'));
    });

    expect(view.queryByText(/cannot place calls/)).toBeNull();
  });
});

describe('the offer to book instead (N-01)', () => {
  /**
   * The screen's "when to call, and when to book instead" section has
   * always ended with an offer to book, and until 2026-09-13 the button
   * that would do it was never rendered: `onBook` is optional and
   * nothing passed it, so a patient read the advice with no way to act
   * on it.
   *
   * It is passed by `RootNavigator` — the modal over the tabs — and
   * deliberately not by `AuthStack`. A signed-out patient cannot book,
   * and this screen must never offer something it cannot do. Both halves
   * are asserted, because the second one is the one a refactor would
   * quietly break by moving the prop into the screen itself.
   */
  it('offers nothing when there is nothing to offer, which is the signed-out case', async () => {
    const view = renderWithProviders(<EmergencyScreen />);
    await act(async () => undefined);

    // By testID, not by text: the advice above the button contains the
    // same words, which is the point of the button.
    expect(view.queryByTestId('emergency-book')).toBeNull();
    // The advice itself stays: knowing when NOT to call is the point of
    // the section, and it is true on either side of the gate.
    expect(view.getByTestId('emergency-screen')).toBeTruthy();
  });

  it('offers it when a caller supplied the route, and calls back rather than dialling', async () => {
    const onBook = jest.fn();
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    installed.push(openURL);
    const view = renderWithProviders(<EmergencyScreen onBook={onBook} />);
    await act(async () => undefined);

    fireEvent.press(view.getByTestId('emergency-book'));

    expect(onBook).toHaveBeenCalledTimes(1);
    // The rule this whole screen is built on: nothing here dials except
    // through the two-step gate.
    expect(openURL).not.toHaveBeenCalled();
  });
});
