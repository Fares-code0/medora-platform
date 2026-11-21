import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';
import type { ApiError } from '@/types/api';

import { AppointmentActions } from './components/AppointmentActions';
import type { AppointmentDetail } from './model/types';
import { appointmentService } from './service';

/**
 * What happens after the button — checklist I-05, I-08, I-09, I-10.
 *
 * `appointments.test.tsx` covers which buttons render, which is the
 * `availableActions` rule and the more important half. It stops at the
 * tap. Everything past it — the write, the 409, the toast, and what
 * happens to the paragraph the patient typed — was uncovered, and
 * `AppointmentActions.tsx` sat at 46% statements for that reason.
 *
 * The assertion this file exists for is the one its own header promises:
 *
 * > A 409 means somebody at the clinic changed this while the sheet was
 * > open. The server's `detail` is shown, the sheet stays open, and the
 * > patient's typed reason is not thrown away.
 *
 * Losing a typed reason to a race the patient did not cause and cannot
 * see is the failure I-05 calls "recovers without losing input".
 */

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub<K extends 'cancel' | 'requestReschedule' | 'acceptProposal'>(method: K) {
  const spy = jest.spyOn(appointmentService, method);
  installed.push(spy);
  return spy;
}

function conflict(detail: string): ApiError {
  return Object.assign(new Error('API error: conflict'), {
    kind: 'conflict' as const,
    detail,
  });
}

function detail(overrides: Partial<AppointmentDetail> = {}): AppointmentDetail {
  return {
    id: 'APT-1',
    startsAt: '2026-10-01T09:30:00.000Z',
    durationMin: 30,
    status: 'confirmed',
    priority: 'normal',
    doctor: {
      id: 'DR-1',
      fullName: 'Layla Haddad',
      title: 'Dr',
      specialty: 'Cardiology',
      photoUrl: null,
    },
    departmentName: 'Cardiology',
    visitType: 'Follow-up',
    reason: 'Review',
    notes: null,
    cancelledReason: null,
    clinicTimezone: 'Asia/Amman',
    availableActions: ['cancel', 'reschedule'],
    proposedSlots: [],
    events: [],
    ...overrides,
  };
}

function render(appointment: AppointmentDetail = detail()) {
  return renderWithProviders(<AppointmentActions appointment={appointment} />);
}

/** Open the cancel sheet and type a reason into it. */
async function openCancel(view: ReturnType<typeof render>, reason: string) {
  fireEvent.press(view.getByTestId('appointment-cancel'));
  await waitFor(() => expect(view.getByTestId('appointment-cancel-confirm')).toBeTruthy());
  fireEvent.changeText(view.getByTestId('appointment-cancel-reason'), reason);
}

describe('cancelling (I-08)', () => {
  it('sends the trimmed reason, because the server CHECK requires one', async () => {
    const cancel = stub('cancel').mockResolvedValue(undefined as never);
    const view = render();

    await openCancel(view, '  I am away that week  ');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    expect(cancel).toHaveBeenCalledWith('APT-1', 'I am away that week');
  });

  it('closes the sheet and confirms it once the write lands', async () => {
    stub('cancel').mockResolvedValue(undefined as never);
    const view = render();

    await openCancel(view, 'I am away that week');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    expect(await view.findByText('Appointment cancelled')).toBeTruthy();
  });

  it('keeps the sheet open and the reason typed when it loses a race (I-05)', async () => {
    // The 409 the header promises to survive: somebody at the clinic
    // moved this while the sheet was open. The patient did not cause it
    // and cannot see it, so it must not cost them their paragraph.
    stub('cancel').mockRejectedValue(
      conflict('This appointment was already cancelled by the clinic.'),
    );
    const view = render();

    await openCancel(view, 'I am away that week');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    await waitFor(() => expect(view.getByText(/already cancelled by the clinic/i)).toBeTruthy());
    expect(view.getByTestId('appointment-cancel-sheet')).toBeTruthy();
    expect(view.getByTestId('appointment-cancel-reason').props.value).toBe('I am away that week');
  });

  it('says something plain when the failure is not a race', async () => {
    // Only a 409 carries a `detail` worth reading — it describes a change
    // to this patient's own appointment. Nothing else surfaces server
    // text into the form.
    stub('cancel').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server' as const, ref: 'REQ-1' }),
    );
    const view = render();

    await openCancel(view, 'I am away that week');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    await waitFor(() => expect(view.getByText(/did not go through/i)).toBeTruthy());
    expect(view.queryByText(/REQ-1/)).toBeNull();
  });

  it('lets the patient back out without cancelling anything', async () => {
    const cancel = stub('cancel');
    const view = render();

    await openCancel(view, 'I am away that week');
    fireEvent.press(view.getByText('Keep it'));

    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('asking to reschedule (I-09)', () => {
  it('sends the reason and confirms that the clinic has it', async () => {
    const request = stub('requestReschedule').mockResolvedValue(undefined as never);
    const view = render();

    fireEvent.press(view.getByTestId('appointment-reschedule'));
    await waitFor(() => expect(view.getByTestId('appointment-reschedule-confirm')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('appointment-reschedule-reason'), 'Work travel');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-reschedule-confirm'));
    });

    expect(request).toHaveBeenCalledWith('APT-1', 'Work travel');
    // The wording matters: the request is not the reschedule. The current
    // appointment stays booked until the patient accepts a new time.
    expect(await view.findByText(/has your reschedule request/i)).toBeTruthy();
  });

  it('keeps the sheet open and the reason typed on a 409', async () => {
    stub('requestReschedule').mockRejectedValue(conflict('The clinic has already moved this.'));
    const view = render();

    fireEvent.press(view.getByTestId('appointment-reschedule'));
    await waitFor(() => expect(view.getByTestId('appointment-reschedule-confirm')).toBeTruthy());
    fireEvent.changeText(view.getByTestId('appointment-reschedule-reason'), 'Work travel');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-reschedule-confirm'));
    });

    await waitFor(() => expect(view.getByText(/already moved this/i)).toBeTruthy());
    expect(view.getByTestId('appointment-reschedule-reason').props.value).toBe('Work travel');
  });

  it('will not send an empty reason', async () => {
    const request = stub('requestReschedule');
    const view = render();

    fireEvent.press(view.getByTestId('appointment-reschedule'));
    await waitFor(() => expect(view.getByTestId('appointment-reschedule-confirm')).toBeTruthy());

    expect(
      view.getByTestId('appointment-reschedule-confirm').props.accessibilityState.disabled,
    ).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('the two sheets do not share a box', () => {
  it('keeps a cancellation reason out of the reschedule form', async () => {
    // Two different questions — "the clinic needs a reason" and "why do
    // you need to move it?" — must not share one buffer, or a patient who
    // backs out of cancelling finds their cancellation reason waiting in
    // the reschedule box, ready to be sent as the wrong thing.
    const view = render();

    await openCancel(view, 'I want to cancel entirely');
    fireEvent.press(view.getByText('Keep it'));

    fireEvent.press(view.getByTestId('appointment-reschedule'));
    await waitFor(() => expect(view.getByTestId('appointment-reschedule-reason')).toBeTruthy());

    expect(view.getByTestId('appointment-reschedule-reason').props.value).toBe('');
  });

  it('keeps each reason while its own sheet is closed and reopened', async () => {
    const view = render();

    await openCancel(view, 'I am away that week');
    fireEvent.press(view.getByText('Keep it'));
    fireEvent.press(view.getByTestId('appointment-cancel'));

    await waitFor(() =>
      expect(view.getByTestId('appointment-cancel-reason').props.value).toBe('I am away that week'),
    );
  });
});

describe('responding to proposed slots (I-10)', () => {
  const withProposals = detail({
    status: 'awaiting-patient',
    availableActions: ['confirm', 'cancel'],
    proposedSlots: [
      { id: 'PS-1', startsAt: '2026-10-05T09:00:00.000Z', durationMin: 30 },
      { id: 'PS-2', startsAt: '2026-10-06T15:30:00.000Z', durationMin: 30 },
    ],
  });

  it('confirms the slot the patient chose, by id', async () => {
    const accept = stub('acceptProposal').mockResolvedValue(undefined as never);
    const view = render(withProposals);

    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-proposal-PS-2'));
    });

    expect(accept).toHaveBeenCalledWith('APT-1', 'PS-2');
    expect(await view.findByText('Appointment confirmed')).toBeTruthy();
  });

  it('says who took the slot when the patient loses the race for it', async () => {
    // The slot went while the screen was open. A generic "that didn't
    // work" here would leave the patient tapping the same dead slot.
    stub('acceptProposal').mockRejectedValue(conflict('That time was taken a moment ago.'));
    const view = render(withProposals);

    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-proposal-PS-1'));
    });

    expect(await view.findByText(/taken a moment ago/i)).toBeTruthy();
  });

  it('renders no proposal card when the server did not offer `confirm`', async () => {
    // The slots and the permission to take one are two different facts,
    // and the client renders neither from `status`.
    const view = render({ ...withProposals, availableActions: ['cancel'] });

    expect(view.queryByTestId('appointment-proposals')).toBeNull();
  });
});
