import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

import { en } from '@/i18n/messages';
import type { AppointmentsStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';
import type { ApiError } from '@/types/api';
import { APPOINTMENT_PRIORITIES, APPOINTMENT_STATUSES } from '@/types/vocabularies';

import type { AppointmentDetail, AppointmentEvent } from './model/types';
import { AppointmentDetailScreen } from './screens/AppointmentDetailScreen';
import { appointmentService } from './service';

/**
 * One appointment, in full — checklist I-06, I-07.
 *
 * The screen was at 0% of its 16 branches, and they are all "the server
 * sent this field, or it did not". The history timeline is the part worth
 * protecting: it is the only thing on the screen that answers *"why did
 * this change?"*, which is the question a patient actually has about a
 * rescheduled or cancelled appointment. A status badge alone does not
 * answer it.
 *
 * The rule underneath is audit §6 — **the server owns every transition**.
 * `appointments.test.tsx` asserts no action is derived from `status` by
 * reading the source; this asserts the same thing by rendering: the
 * detail screen shows every status the vocabulary has and offers an
 * action for none of them unless `availableActions` says so.
 */

const EVENT = (overrides: Partial<AppointmentEvent> = {}): AppointmentEvent => ({
  id: 'EV-1',
  at: '2026-09-20T09:00:00.000Z',
  fromStatus: 'pending',
  toStatus: 'confirmed',
  actor: 'The clinic',
  reason: null,
  ...overrides,
});

const DETAIL = (overrides: Partial<AppointmentDetail> = {}): AppointmentDetail => ({
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
  reason: 'Chest tightness when walking uphill',
  notes: null,
  cancelledReason: null,
  clinicTimezone: 'Asia/Amman',
  hospital: null,
  availableActions: [],
  pendingRescheduleRequest: null,
  events: [EVENT()],
  ...overrides,
});

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

async function renderDetail(detail: AppointmentDetail) {
  const get = jest.spyOn(appointmentService, 'getById').mockResolvedValue(detail);
  installed.push(get);

  const props = {
    navigation: { navigate: jest.fn(), goBack: jest.fn() },
    route: {
      key: 'ad-1',
      name: 'AppointmentDetail',
      params: { appointmentId: detail.id },
    },
  } as unknown as NativeStackScreenProps<AppointmentsStackParamList, 'AppointmentDetail'>;

  const view = renderWithProviders(<AppointmentDetailScreen {...props} />);
  await act(async () => undefined);
  await waitFor(() => expect(view.getByText('Details')).toBeTruthy());
  return { ...view, get };
}

describe('the appointment itself (I-06)', () => {
  it('asks for the appointment the navigator routed to, and no other', async () => {
    const view = await renderDetail(DETAIL({ id: 'APT-77' }));

    expect(view.get).toHaveBeenCalledTimes(1);
    expect(view.get).toHaveBeenCalledWith('APT-77');
  });

  it('renders the doctor with their title, and the department when there is one', async () => {
    const view = await renderDetail(DETAIL());

    expect(view.getByText('Dr Layla Haddad')).toBeTruthy();
    expect(view.getAllByText('Cardiology').length).toBeGreaterThan(0);
  });

  it('omits the department rather than inventing one', async () => {
    const view = await renderDetail(DETAIL({ departmentName: null }));

    expect(view.queryByText(/null|undefined/i)).toBeNull();
  });

  it('renders the reason the patient gave when they booked', async () => {
    const view = await renderDetail(DETAIL());

    expect(view.getByText('Chest tightness when walking uphill')).toBeTruthy();
  });

  it('shows notes only when the clinic wrote some', async () => {
    const without = await renderDetail(DETAIL({ notes: null }));
    expect(without.queryByText('Notes')).toBeNull();

    const withNotes = await renderDetail(DETAIL({ notes: 'Bring your inhaler.' }));
    expect(withNotes.getByText('Notes')).toBeTruthy();
    expect(withNotes.getByText('Bring your inhaler.')).toBeTruthy();
  });

  it('says why an appointment was cancelled, in error tone, when the server gave a reason', async () => {
    // "Cancelled" without a reason is the version of this screen a patient
    // rings the clinic about.
    const view = await renderDetail(
      DETAIL({ status: 'cancelled', cancelledReason: 'The clinician was called to theatre.' }),
    );

    expect(view.getByText('Cancelled because')).toBeTruthy();
    expect(view.getByText('The clinician was called to theatre.')).toBeTruthy();
  });

  it('does not show a cancellation section for an appointment that was not cancelled', async () => {
    const view = await renderDetail(DETAIL({ cancelledReason: null }));

    expect(view.queryByText('Cancelled because')).toBeNull();
  });
});

describe('the server owns every transition (I-07, audit §6)', () => {
  it.each(APPOINTMENT_STATUSES)('renders %s and offers no action for it', async (status) => {
    // Every status in the vocabulary, with `availableActions: []`. Not one
    // of them may produce a Cancel or a Reschedule — that would be this
    // client deciding a policy ADR-033 has not written.
    const view = await renderDetail(DETAIL({ status, availableActions: [] }));

    expect(view.getByTestId('appointment-detail-status')).toBeTruthy();
    expect(view.queryByTestId('appointment-cancel')).toBeNull();
    expect(view.queryByTestId('appointment-reschedule')).toBeNull();
  });

  it('offers exactly what the server offered, on a status that suggests otherwise', async () => {
    // `completed` is the status a derivation would most confidently
    // refuse to cancel. The server said cancel; the screen renders cancel.
    const view = await renderDetail(DETAIL({ status: 'completed', availableActions: ['cancel'] }));

    expect(view.getByTestId('appointment-cancel')).toBeTruthy();
    expect(view.queryByTestId('appointment-reschedule')).toBeNull();
  });

  it('renders no action for an empty `availableActions` — the server said "none"', async () => {
    // The field is required now: `[]` is the server's own statement, and
    // no button is invented on a status that looks cancellable.
    const view = await renderDetail(DETAIL({ status: 'pending', availableActions: [] }));

    expect(view.queryByTestId('appointment-cancel')).toBeNull();
    expect(view.queryByTestId('appointment-reschedule')).toBeNull();
  });
});

describe('the history timeline (I-06)', () => {
  it('names the actor and the time, and reads as one sentence to a screen reader', async () => {
    const view = await renderDetail(
      DETAIL({ events: [EVENT({ actor: 'The clinic', toStatus: 'confirmed' })] }),
    );

    // "Confirmed" is the patient-facing label from `statusPresentation`,
    // not the `confirmed` literal — the two coincide for this status,
    // which is why the test below uses one where they do not.
    expect(await view.findByLabelText(/The clinic set this to Confirmed on .+/)).toBeTruthy();
  });

  it('keeps an event that changed no status rather than tidying it away', async () => {
    // Dropping the row would edit a clinical history to suit a component.
    const view = await renderDetail(
      DETAIL({
        events: [EVENT({ id: 'EV-2', toStatus: null, actor: 'Dr Haddad', reason: 'Added a note' })],
      }),
    );

    expect(await view.findByLabelText(/Dr Haddad updated this on .+/)).toBeTruthy();
    expect(view.getByText('Added a note')).toBeTruthy();
  });

  it('shows the reason when the server gave one, and no blank when it did not', async () => {
    const view = await renderDetail(DETAIL({ events: [EVENT({ reason: null })] }));

    expect(view.getByText('History')).toBeTruthy();
    expect(view.queryByText(/null|undefined/i)).toBeNull();
  });

  it('renders every event, in the order the server sent them', async () => {
    const view = await renderDetail(
      DETAIL({
        events: [
          EVENT({ id: 'EV-1', actor: 'You', toStatus: 'pending' }),
          EVENT({ id: 'EV-2', actor: 'The clinic', toStatus: 'confirmed' }),
          EVENT({ id: 'EV-3', actor: 'The clinic', toStatus: 'cancelled' }),
        ],
      }),
    );

    const labels = view
      .getAllByLabelText(/set this to .+ on .+/)
      .map((node) => String(node.props.accessibilityLabel));
    expect(labels).toHaveLength(3);
    /*
      The screen-reader label carries the patient-facing word, not the
      database literal. This used to assert `pending` and passed, which is
      how the defect survived: a sighted user read "Awaiting clinic" off the
      badge while VoiceOver said "pending", and on this row the badge is the
      only other carrier. `pending` is the status chosen here precisely
      because its label differs from its literal — `confirmed` would have
      passed either way.
    */
    expect(labels[0]).toMatch(/^You set this to Awaiting clinic/);
    expect(labels[0]).not.toMatch(/\bpending\b/);
    expect(labels[2]).toMatch(/Cancelled/);
  });

  it('never reads a kebab-case literal out loud', async () => {
    // `awaiting-patient` and `no-show` are the two that would be spoken
    // as punctuation. They are also the two a patient most needs to
    // understand, `awaiting-patient` being a call to action.
    const view = await renderDetail(
      DETAIL({
        events: [
          EVENT({ id: 'EV-1', actor: 'The clinic', toStatus: 'awaiting-patient' }),
          EVENT({ id: 'EV-2', actor: 'You', toStatus: 'no-show' }),
        ],
      }),
    );

    const labels = view
      .getAllByLabelText(/set this to .+ on .+/)
      .map((node) => String(node.props.accessibilityLabel));

    expect(labels[0]).toMatch(/Needs your response/);
    expect(labels[1]).toMatch(/Missed/);
    for (const label of labels) expect(label).not.toMatch(/-/);
  });

  it('names no actor id — the projection sends a display string', async () => {
    const view = await renderDetail(DETAIL({ events: [EVENT({ actor: 'The clinic' })] }));

    expect(view.queryByText(/usr_|DR-1001|user_id/i)).toBeNull();
  });

  it('renders an appointment with no history at all', async () => {
    const view = await renderDetail(DETAIL({ events: [] }));

    expect(view.getByText('History')).toBeTruthy();
  });
});

/**
 * The clinic's triage priority is carried and never shown.
 *
 * `Appointment.priority` is mapped from the wire — dropping a field the
 * payload sends is how a client ends up unable to show something later —
 * and `low | normal | high | urgent` is the clinic's own scheduling
 * judgement about this patient. Rendering it is a clinical-communication
 * decision, not a rendering one: "Urgent" reads as *you are in danger* to
 * someone told nothing of the kind, and "Low" is a reason a patient gives
 * themselves for not attending. Neither is a word this app may choose.
 *
 * So the absence is asserted, for the reason F-05 asserts the absence of an
 * AI entry point: an omission nobody wrote down is indistinguishable from
 * an oversight, and the next reader "fixes" it.
 */
describe('appointment priority is carried, not rendered', () => {
  it.each(APPOINTMENT_PRIORITIES)('shows no priority word for %s', async (priority) => {
    const view = await renderDetail(DETAIL({ priority }));

    // The literal, and the words a label map would have chosen for it.
    expect(view.queryByText(new RegExp(`\\b${priority}\\b`, 'i'))).toBeNull();
    for (const word of [/\bUrgent\b/i, /\bHigh priority\b/i, /\bLow priority\b/i, /\bTriage\b/i]) {
      expect(view.queryByText(word)).toBeNull();
    }
  });

  it('still renders the status, which IS the clinic speaking to the patient', async () => {
    // The distinction this test pair exists to hold: a status is a
    // statement the clinic makes *to* the patient about their appointment,
    // and a priority is a note it makes to itself about scheduling.
    const view = await renderDetail(DETAIL({ priority: 'urgent', status: 'confirmed' }));

    expect(view.getByTestId('appointment-detail-status')).toBeTruthy();
  });
});

describe('pull to refresh', () => {
  it('refetches the appointment when the screen is pulled down', async () => {
    const view = await renderDetail(DETAIL());
    const before = view.get.mock.calls.length;

    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });

    await waitFor(() => expect(view.get.mock.calls.length).toBe(before + 1));
  });

  it('keeps the appointment on screen when a refresh fails, and says so without blocking', async () => {
    const view = await renderDetail(DETAIL());
    const network: ApiError = { kind: 'network' };
    const spy = jest.spyOn(appointmentService, 'getById').mockRejectedValue(network);
    const before = spy.mock.calls.length;

    await act(async () => {
      view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });

    expect(await view.findByText(en['state.error.network.title'])).toBeTruthy();
    expect(view.getByText('Dr Layla Haddad')).toBeTruthy();
    expect(view.queryByTestId('appointment-detail-error')).toBeNull();
    expect(view.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(spy.mock.calls.length).toBe(before + 1);
  });
});
