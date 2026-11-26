import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';
import type { ApiError } from '@/types/api';

import { AppointmentActions } from './components/AppointmentActions';
import type { AppointmentDetail } from './model/types';
import { appointmentService } from './service';

/**
 * What happens after the cancel button — checklist I-05, I-08.
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

function stub<K extends 'cancel'>(method: K) {
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
    hospital: { id: 'HOS-1', name: 'Medora Clinic' },
    availableActions: ['cancel', 'reschedule'],
    pendingRescheduleRequest: null,
    events: [],
    ...overrides,
  };
}

function render(appointment: AppointmentDetail = detail(), onAskReschedule = jest.fn()) {
  return renderWithProviders(
    <AppointmentActions appointment={appointment} onAskReschedule={onAskReschedule} />,
  );
}

/** Open the cancel sheet, pick a reason code and (optionally) type a note. */
async function openCancel(
  view: ReturnType<typeof render>,
  code = 'schedule_conflict',
  note?: string,
) {
  fireEvent.press(view.getByTestId('appointment-cancel'));
  await waitFor(() => expect(view.getByTestId('appointment-cancel-confirm')).toBeTruthy());
  fireEvent.press(view.getByTestId(`cancel-reason-${code}`));
  if (note !== undefined) fireEvent.changeText(view.getByTestId('appointment-cancel-note'), note);
}

describe('cancelling (I-08)', () => {
  it('sends the chosen reason CODE, and the trimmed note when there is one', async () => {
    const cancel = stub('cancel').mockResolvedValue(undefined as never);
    const view = render();

    await openCancel(view, 'transport', '  Cannot get a lift  ');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    expect(cancel).toHaveBeenCalledWith('APT-1', {
      reasonCode: 'transport',
      note: 'Cannot get a lift',
    });
  });

  it('omits the note when none was typed', async () => {
    const cancel = stub('cancel').mockResolvedValue(undefined as never);
    const view = render();

    await openCancel(view, 'feeling_better');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    expect(cancel).toHaveBeenCalledWith('APT-1', { reasonCode: 'feeling_better' });
  });

  it('offers exactly the six reasons the server accepts, in words', async () => {
    const view = render();
    fireEvent.press(view.getByTestId('appointment-cancel'));
    await waitFor(() => expect(view.getByTestId('appointment-cancel-confirm')).toBeTruthy());

    for (const code of [
      'schedule_conflict',
      'feeling_better',
      'booked_elsewhere',
      'transport',
      'cost',
      'other',
    ]) {
      expect(view.getByTestId(`cancel-reason-${code}`).props.accessibilityRole).toBe('radio');
    }
    expect(view.getByText('I am feeling better')).toBeTruthy();
    expect(view.queryByText(/schedule_conflict/)).toBeNull();
  });

  it('closes the sheet and confirms it once the write lands', async () => {
    stub('cancel').mockResolvedValue(undefined as never);
    const view = render();

    await openCancel(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    expect(await view.findByText('Appointment cancelled')).toBeTruthy();
  });

  it('keeps the sheet open, the reason and the note when it loses a race (I-05)', async () => {
    // Somebody at the clinic moved this while the sheet was open. The
    // patient did not cause it and cannot see it, so it must not cost
    // them what they chose and wrote — and the server's own sentence says
    // what happened.
    stub('cancel').mockRejectedValue(
      conflict('This appointment was already cancelled by the clinic.'),
    );
    const view = render();

    await openCancel(view, 'cost', 'Too expensive this month');
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    await waitFor(() => expect(view.getByText(/already cancelled by the clinic/i)).toBeTruthy());
    expect(view.getByTestId('appointment-cancel-sheet')).toBeTruthy();
    expect(view.getByTestId('appointment-cancel-note').props.value).toBe(
      'Too expensive this month',
    );
    expect(view.getByTestId('cancel-reason-cost').props.accessibilityState.selected).toBe(true);
  });

  it('says something plain when the failure is not a race', async () => {
    // Only a 409 / insurance 422 carries a `detail` worth reading.
    // Nothing else surfaces server text into the form.
    stub('cancel').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server' as const, ref: 'REQ-1' }),
    );
    const view = render();

    await openCancel(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    await waitFor(() => expect(view.getByText(/did not go through/i)).toBeTruthy());
    expect(view.queryByText(/REQ-1/)).toBeNull();
  });

  it('says the connection failed, and offers the same button again — without signing out', async () => {
    stub('cancel').mockRejectedValue(
      Object.assign(new Error('API error: network'), { kind: 'network' as const }),
    );
    const view = render();

    await openCancel(view);
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });

    await waitFor(() => expect(view.getByText(/could not be reached/i)).toBeTruthy());
    expect(view.getByTestId('appointment-cancel-confirm').props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it('will not submit without a reason, and ignores a second press while sending', async () => {
    let resolve: (value: undefined) => void = () => undefined;
    const cancel = stub('cancel').mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }) as never,
    );
    const view = render();

    fireEvent.press(view.getByTestId('appointment-cancel'));
    await waitFor(() => expect(view.getByTestId('appointment-cancel-confirm')).toBeTruthy());
    expect(view.getByTestId('appointment-cancel-confirm').props.accessibilityState.disabled).toBe(
      true,
    );

    fireEvent.press(view.getByTestId('cancel-reason-other'));
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('appointment-cancel-confirm'));
    });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('appointment-cancel-confirm').props.accessibilityState.busy).toBe(true);

    await act(async () => {
      resolve(undefined);
    });
  });

  it('lets the patient back out without cancelling anything', async () => {
    const cancel = stub('cancel');
    const view = render();

    await openCancel(view);
    fireEvent.press(view.getByText('Keep it'));

    expect(cancel).not.toHaveBeenCalled();
  });

  it('keeps the chosen reason while the sheet is closed and reopened', async () => {
    const view = render();

    await openCancel(view, 'booked_elsewhere');
    fireEvent.press(view.getByText('Keep it'));
    fireEvent.press(view.getByTestId('appointment-cancel'));

    await waitFor(() =>
      expect(
        view.getByTestId('cancel-reason-booked_elsewhere').props.accessibilityState.selected,
      ).toBe(true),
    );
  });
});

describe('asking to reschedule', () => {
  it('hands off to the request screen — it sends nothing from here', () => {
    const onAsk = jest.fn();
    const view = render(detail(), onAsk);

    fireEvent.press(view.getByTestId('appointment-reschedule'));

    expect(onAsk).toHaveBeenCalledTimes(1);
  });
});
