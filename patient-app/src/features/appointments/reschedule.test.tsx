import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import type { AppointmentsStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import { describeCancelledReason } from './cancel-reasons';
import type {
  AppointmentDetail,
  BookableSlot,
  RescheduleRequest,
  RescheduleRequestStatus,
} from './model/types';
import { AppointmentDetailScreen } from './screens/AppointmentDetailScreen';
import { RescheduleRequestScreen } from './screens/RescheduleRequestScreen';
import { appointmentService } from './service';

/**
 * The reschedule REQUEST workflow (ADR-049): ask, see the status, withdraw.
 * The words that matter are asserted: the appointment stays booked until
 * the hospital approves, and the requested time is not held.
 */

const HOSPITAL = { id: 'HOS-1', name: 'Medora Central' };

function request(
  status: RescheduleRequestStatus = 'pending',
  overrides: Partial<RescheduleRequest> = {},
): RescheduleRequest {
  return {
    id: 'RR-1',
    appointmentId: 'APT-1',
    status,
    requestedSlot: { id: 'SL-2', startsAt: '2026-10-05T09:00:00.000Z', durationMin: 30 },
    note: null,
    decisionReason: null,
    createdAt: '2026-09-20T09:00:00.000Z',
    decidedAt: null,
    ...overrides,
  };
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
    hospital: HOSPITAL,
    availableActions: ['cancel', 'reschedule'],
    pendingRescheduleRequest: null,
    events: [],
    ...overrides,
  };
}

function slot(id: string, hours: number, hospital = HOSPITAL): BookableSlot {
  return {
    id,
    startsAt: new Date(Date.now() + hours * 3_600_000).toISOString(),
    durationMin: 30,
    hospital,
  };
}

function conflict(code: string) {
  return Object.assign(new Error('API error: conflict'), {
    kind: 'conflict' as const,
    code,
    detail: 'detail',
  });
}

afterEach(() => jest.restoreAllMocks());

function props<T extends 'AppointmentDetail' | 'RescheduleRequest'>(name: T) {
  return {
    navigation: { navigate: jest.fn(), goBack: jest.fn() },
    route: { key: 'k', name, params: { appointmentId: 'APT-1' } },
  } as unknown as NativeStackScreenProps<AppointmentsStackParamList, T>;
}

describe('the request screen', () => {
  function setup(slots: BookableSlot[], appointment = detail()) {
    jest.spyOn(appointmentService, 'getById').mockResolvedValue(appointment);
    jest.spyOn(appointmentService, 'listSlots').mockResolvedValue(slots);
    const p = props('RescheduleRequest');
    return { ...renderWithProviders(<RescheduleRequestScreen {...p} />), nav: p.navigation };
  }

  it('says the appointment stays booked and the new time is not held — before anything is sent', async () => {
    const view = setup([slot('SL-2', 48)]);

    const explainer = await view.findByTestId('reschedule-explainer');
    expect(explainer).toBeTruthy();
    expect(
      view.getByText(/stays booked at its current time until the hospital approves/),
    ).toBeTruthy();
    expect(view.getByText(/is not held for you/)).toBeTruthy();
  });

  it('offers only this hospital’s times, and sends the slot with the note', async () => {
    const send = jest.spyOn(appointmentService, 'requestReschedule').mockResolvedValue(request());
    const view = setup([slot('SL-2', 48), slot('SL-X', 50, { id: 'HOS-9', name: 'Other' })]);

    fireEvent.press(await view.findByTestId('reschedule-slot-SL-2'));
    expect(view.queryByTestId('reschedule-slot-SL-X')).toBeNull();
    fireEvent.changeText(view.getByTestId('reschedule-note'), '  Travelling  ');
    await act(async () => {
      fireEvent.press(view.getByTestId('reschedule-submit'));
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe('APT-1');
    expect(send.mock.calls[0]?.[1]).toEqual({ slotId: 'SL-2', note: 'Travelling' });
    expect(send.mock.calls[0]?.[2]).toBeTruthy();
    await waitFor(() => expect(view.nav.goBack).toHaveBeenCalled());
  });

  it('will not send without a chosen time', async () => {
    const view = setup([slot('SL-2', 48)]);
    await view.findByTestId('reschedule-slot-SL-2');
    expect(view.getByTestId('reschedule-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('renders no form when the server no longer offers reschedule', async () => {
    const view = setup([slot('SL-2', 48)], detail({ availableActions: ['cancel'] }));
    expect(await view.findByTestId('reschedule-unavailable')).toBeTruthy();
    expect(view.queryByTestId('reschedule-submit')).toBeNull();
  });

  it('on a taken time, refreshes the list, clears the pick and keeps the note', async () => {
    const send = jest
      .spyOn(appointmentService, 'requestReschedule')
      .mockRejectedValue(conflict('slot_taken'));
    const view = setup([slot('SL-2', 48)]);

    fireEvent.press(await view.findByTestId('reschedule-slot-SL-2'));
    fireEvent.changeText(view.getByTestId('reschedule-note'), 'Keep me');
    await act(async () => {
      fireEvent.press(view.getByTestId('reschedule-submit'));
    });

    expect(await view.findByText(/Someone else booked that time/)).toBeTruthy();
    expect(send).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('reschedule-note').props.value).toBe('Keep me');
    expect(view.getByTestId('reschedule-submit').props.accessibilityState.disabled).toBe(true);
  });

  it('says a request is already open on 409 reschedule_request_pending', async () => {
    jest
      .spyOn(appointmentService, 'requestReschedule')
      .mockRejectedValue(conflict('reschedule_request_pending'));
    const view = setup([slot('SL-2', 48)]);

    fireEvent.press(await view.findByTestId('reschedule-slot-SL-2'));
    await act(async () => {
      fireEvent.press(view.getByTestId('reschedule-submit'));
    });

    expect(await view.findByText(/already have a reschedule request waiting/)).toBeTruthy();
  });

  it('keeps the form on a dropped connection and retries under the same key', async () => {
    const send = jest
      .spyOn(appointmentService, 'requestReschedule')
      .mockRejectedValueOnce(Object.assign(new Error('x'), { kind: 'network' as const }))
      .mockResolvedValueOnce(request());
    const view = setup([slot('SL-2', 48)]);

    fireEvent.press(await view.findByTestId('reschedule-slot-SL-2'));
    await act(async () => {
      fireEvent.press(view.getByTestId('reschedule-submit'));
    });
    expect(await view.findByText(/could not be reached/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId('reschedule-submit'));
    });

    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]?.[2]).toBe(send.mock.calls[0]?.[2]);
  });
});

describe('status on the appointment detail', () => {
  function renderDetail(appointment: AppointmentDetail, history: RescheduleRequest[] = []) {
    jest.spyOn(appointmentService, 'getById').mockResolvedValue(appointment);
    jest.spyOn(appointmentService, 'listRescheduleRequests').mockResolvedValue(history);
    return renderWithProviders(<AppointmentDetailScreen {...props('AppointmentDetail')} />);
  }

  it('shows a pending request with the stays-booked and not-held sentences', async () => {
    const view = renderDetail(
      detail({ pendingRescheduleRequest: request(), availableActions: ['cancel'] }),
    );

    expect(await view.findByTestId('reschedule-pending')).toBeTruthy();
    expect(view.getByTestId('reschedule-pending-status')).toBeTruthy();
    expect(view.getByText('Waiting for the hospital')).toBeTruthy();
    expect(view.getByText(/stays booked at its current time/)).toBeTruthy();
    expect(view.getByText(/not held for you/)).toBeTruthy();
    // The server stopped offering reschedule; there is no second ask.
    expect(view.queryByTestId('appointment-reschedule')).toBeNull();
  });

  it.each([
    ['approved', 'Approved'],
    ['rejected', 'Not approved'],
    ['withdrawn', 'Withdrawn'],
    ['superseded', 'No longer needed'],
  ] as const)('renders a %s request in the history', async (status, label) => {
    const view = renderDetail(detail(), [
      request(status, {
        id: 'RR-9',
        decisionReason: status === 'rejected' ? 'Doctor is away' : null,
      }),
    ]);

    expect(await view.findByTestId('reschedule-history-RR-9')).toBeTruthy();
    expect(view.getByText(label)).toBeTruthy();
    if (status === 'rejected') expect(view.getByText(/Doctor is away/)).toBeTruthy();
  });

  it('withdraws through a confirmation, once', async () => {
    const withdraw = jest
      .spyOn(appointmentService, 'withdrawRescheduleRequest')
      .mockResolvedValue(request('withdrawn'));
    const view = renderDetail(detail({ pendingRescheduleRequest: request() }));

    fireEvent.press(await view.findByTestId('reschedule-withdraw'));
    expect(withdraw).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(view.getByTestId('reschedule-withdraw-sheet-confirm'));
    });

    expect(withdraw).toHaveBeenCalledWith('RR-1');
    expect(await view.findByText('Request withdrawn')).toBeTruthy();
  });

  it('offers the reschedule button only because availableActions says so', async () => {
    const view = renderDetail(detail());
    expect(await view.findByTestId('appointment-reschedule')).toBeTruthy();
    fireEvent.press(view.getByTestId('appointment-reschedule'));
  });

  it('shows the hospital', async () => {
    const view = renderDetail(detail());
    expect((await view.findByTestId('appointment-hospital')).props.children).toBe('Medora Central');
  });
});

describe('describing a stored cancellation reason', () => {
  const t = (key: string) => (key.endsWith('transport') ? 'I cannot get there' : key);
  it('localizes a patient code and keeps the note', () => {
    expect(describeCancelledReason('patient:transport Car broke', t as never)).toBe(
      'I cannot get there — Car broke',
    );
    expect(describeCancelledReason('patient:transport', t as never)).toBe('I cannot get there');
  });
  it('shows anything else verbatim', () => {
    expect(describeCancelledReason('Cancelled by the clinic', t as never)).toBe(
      'Cancelled by the clinic',
    );
    expect(describeCancelledReason('patient:unknown_code', t as never)).toBe(
      'patient:unknown_code',
    );
  });
});
