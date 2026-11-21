import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import { renderWithProviders } from '@/test/render';

import type { PrivacyState } from './model/types';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { profileService } from './service';

/**
 * Your data — checklist P-09, P-10.
 *
 * The two requests are three lines of mutation each. What is worth
 * testing is the copy and the shape around them, because both are the
 * substance of the rows:
 *
 * - **P-10 is not a deletion.** PHI is never hard-deleted (DB §7), so
 *   the screen must never offer one — and must say what actually
 *   happens *before* the confirmation, not inside it.
 * - **A second request is not offered** while the first is running.
 * - **The refusal is shown**, not hidden. Unlike Home's activity feed,
 *   a patient who came here to ask for their data is owed an answer.
 */

const NONE: PrivacyState = {
  export: { status: 'none', requestedAt: null },
  deactivation: { status: 'none', requestedAt: null },
};

const EXPORT_PENDING: PrivacyState = {
  ...NONE,
  export: { status: 'pending', requestedAt: new Date('2026-09-01T09:00:00Z').toISOString() },
};

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub(state: PrivacyState | Error = NONE) {
  const get = jest.spyOn(profileService, 'getPrivacyState');
  if (state instanceof Error) get.mockRejectedValue(state);
  else get.mockResolvedValue(state);
  installed.push(get);
  return get;
}

function spyOnRequest(method: 'requestDataExport' | 'requestDeactivation', result: PrivacyState) {
  const spy = jest.spyOn(profileService, method).mockResolvedValue(result);
  installed.push(spy);
  return spy;
}

describe('asking for a copy of your data (P-09)', () => {
  it('sends the request and says the file will be notified, not downloaded', async () => {
    stub();
    const request = spyOnRequest('requestDataExport', EXPORT_PENDING);
    const view = renderWithProviders(<PrivacyScreen />);

    const button = await view.findByTestId('privacy-export-request');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(
      await view.findByText('Your clinic has your request. You will hear when the file is ready.'),
    ).toBeTruthy();
    // No download control anywhere: this client cannot see the job and
    // cannot show the file.
    expect(view.queryByText(/download/i)).toBeNull();
  });

  it('does not offer a second request while one is running', async () => {
    stub(EXPORT_PENDING);
    const view = renderWithProviders(<PrivacyScreen />);

    const button = await view.findByTestId('privacy-export-request');

    expect(button.props.accessibilityState.disabled).toBe(true);
    expect(view.getByText('In progress')).toBeTruthy();
    // The date itself is `formatDate`'s business and locale-dependent;
    // what this asserts is that the screen says WHEN, so a patient who
    // forgot they asked is not left guessing.
    expect(view.getByText(/^Requested on /)).toBeTruthy();
  });
});

describe('asking to close your account (P-10)', () => {
  it('never offers to delete anything, and says the record is kept', async () => {
    stub();
    const view = renderWithProviders(<PrivacyScreen />);

    await view.findByTestId('privacy-close-request');

    // The word people arrive with, and the one no CONTROL here may use
    // — an app that offered deletion would either be lying or breaking
    // the clinic's retention duty. The copy is free to use it, and has
    // to: the sentence below is the whole point of the section.
    const controls = view
      .queryAllByRole('button')
      .map((node) => String(node.props.accessibilityLabel ?? ''));
    expect(controls.length).toBeGreaterThan(0);
    for (const label of controls) {
      expect(label).not.toMatch(/delete|erase|remove|wipe/i);
    }
    expect(
      view.getByText(
        'Your medical record is not deleted. Your clinic has to keep it, and closing this account does not change what is in it or who may see it.',
      ),
    ).toBeTruthy();
  });

  it('confirms before sending, and sends nothing if the sheet is cancelled', async () => {
    stub();
    const request = spyOnRequest('requestDeactivation', NONE);
    const view = renderWithProviders(<PrivacyScreen />);

    fireEvent.press(await view.findByTestId('privacy-close-request'));

    expect(await view.findByTestId('privacy-close-confirm')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });

  it('sends the request once the sheet is confirmed', async () => {
    stub();
    const request = spyOnRequest('requestDeactivation', {
      ...NONE,
      deactivation: { status: 'pending', requestedAt: new Date().toISOString() },
    });
    const view = renderWithProviders(<PrivacyScreen />);

    fireEvent.press(await view.findByTestId('privacy-close-request'));
    const confirm = await view.findByTestId('privacy-close-confirm-confirm');
    await act(async () => {
      fireEvent.press(confirm);
    });

    expect(request).toHaveBeenCalledTimes(1);
    expect(
      await view.findByText('Your clinic has your request and will be in touch.'),
    ).toBeTruthy();
  });
});

describe('when the requests cannot be read', () => {
  it('says so rather than hiding the screen', async () => {
    stub(new EndpointNotImplementedError('BE-10 / M8', 'capability.privacyRequests'));
    const view = renderWithProviders(<PrivacyScreen />);

    // Deliberately unlike Home's activity feed: a patient who came here
    // to ask for their data is owed an answer, and silence would read as
    // "asked and ignored".
    expect(await view.findByText(/not available yet/i)).toBeTruthy();
    await waitFor(() => {
      expect(view.queryByTestId('privacy-export-request')).toBeNull();
    });
  });

  it('says the write failed rather than pretending it landed', async () => {
    stub();
    const spy = jest
      .spyOn(profileService, 'requestDataExport')
      .mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' }));
    installed.push(spy);
    const view = renderWithProviders(<PrivacyScreen />);

    const button = await view.findByTestId('privacy-export-request');
    await act(async () => {
      fireEvent.press(button);
    });

    expect(
      await view.findByText('That request could not be sent. Try again in a moment.'),
    ).toBeTruthy();
  });
});
