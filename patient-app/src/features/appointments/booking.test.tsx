import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import type { RootStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';
import type { ApiError } from '@/types/api';

import { BookingFlow } from './booking/BookingFlow';
import { resetAppointmentFixtures } from './fixtures/appointment-fixtures';
import { appointmentService } from './service';

/**
 * The booking flow, end to end — checklist U-05.
 *
 * ── Why this suite exists ────────────────────────────────────────────
 * Booking is the longest task in the app: five steps, a server round
 * trip at the end, and a race it can lose. `BookingFlow` already handles
 * that race — a 409 returns the patient to the Time step with their
 * reason intact — but nothing had ever run that path. The fixture's
 * `book()` cannot produce a conflict (only `acceptProposal` can), so the
 * recovery branch was written, reviewed, and never executed.
 *
 * A branch that has never executed is a branch that works by assertion
 * only. This suite executes it.
 *
 * ── How the conflict is produced ─────────────────────────────────────
 * By stubbing `appointmentService.book` for the one test that needs it,
 * NOT by teaching the fixture to fail. The fixture is development data
 * that ships in development builds; a "make this fail" switch in it is a
 * switch someone can trip by accident. A spy lives and dies inside the
 * test that sets it.
 */

/**
 * Typed with the real `RootStackParamList`, not left as `ParamListBase`.
 * `BookingFlow` takes `NativeStackScreenProps<RootStackParamList,
 * 'Booking'>` — with an untyped navigator its props resolve to `{}` and
 * the screen does not typecheck, which is how this file reached a commit
 * with a `tsc` error in it.
 */
const Stack = createNativeStackNavigator<RootStackParamList>();

/** Stands in for the tab navigator the flow lands on after success. */
function TabsStub() {
  return <RNText testID="tabs-stub">tabs</RNText>;
}

/**
 * Torn down in `afterEach` so the client does not outlive its test.
 *
 * ── The open handle this suite used to leave, and what it actually was ─
 * On the base this file was written against, Jest reported "did not exit
 * one second after the test run has completed" — but only for the tests
 * that SUBMIT. The cause was not these two queries, and not this
 * teardown, which did not fix it: `useBookAppointment` is a
 * `useMutation`, and a settled mutation schedules a garbage-collection
 * timer whose default is **five minutes**. One submit therefore left a
 * five-minute `setTimeout` behind and Jest waited for it.
 *
 * R-07 fixed it in the shared harness — `src/test/render.tsx` now sets
 * `mutations.gcTime: Infinity`, which is never a valid timeout, so no
 * timer is scheduled at all. Nothing here was weakened to get green: no
 * `forceExit`, no raised timeout, no disabled leak detection. The
 * teardown below stays because a client that outlives its test is worth
 * closing on its own merits.
 */
let queryClient: QueryClient | null = null;

function renderBooking(params?: RootStackParamList['Booking']) {
  const rendered = renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="Booking"
          component={BookingFlow}
          {...(params === undefined ? {} : { initialParams: params })}
        />
        <Stack.Screen name="Tabs" component={TabsStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
  queryClient = rendered.queryClient;
  return rendered;
}

/** Midnight, `days` after tomorrow. Negative goes into the past. */
function startOfTomorrow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1 + days);
  date.setHours(9, 0, 0, 0);
  return date;
}

function conflict(detail: string): ApiError & Error {
  return Object.assign(new Error('API error: conflict'), {
    kind: 'conflict' as const,
    detail,
  });
}

/**
 * Walks Doctor → Date → Time → Reason, leaving the flow on Confirm.
 *
 * `notes` is optional here because it is optional on `BookingRequest`:
 * every existing caller omits it and must keep passing no note at all,
 * which is the case the submit path has to get right.
 */
async function walkToConfirm(reason = 'Ongoing chest pain', notes?: string): Promise<void> {
  const [doctorCard] = await screen.findAllByTestId(/^booking-doctor-/);
  fireEvent.press(doctorCard);

  fireEvent.press(await screen.findByTestId('booking-to-time'));

  const [slot] = await screen.findAllByTestId(/^booking-slot-/);
  fireEvent.press(slot);
  fireEvent.press(screen.getByTestId('booking-to-reason'));

  fireEvent.changeText(await screen.findByTestId('booking-reason'), reason);
  if (notes !== undefined) {
    fireEvent.changeText(screen.getByTestId('booking-notes'), notes);
  }
  fireEvent.press(screen.getByTestId('booking-to-confirm'));

  await screen.findByTestId('booking-submit');
}

beforeEach(() => {
  resetAppointmentFixtures();
});

afterEach(() => {
  queryClient?.unmount();
  queryClient?.clear();
  queryClient = null;
});

describe('the five steps', () => {
  it('starts on the doctor step and counts the steps for a screen reader', async () => {
    renderBooking();
    expect(await screen.findByTestId('booking-flow')).toBeTruthy();
    // The stepper dots are decorative; this text is the accessible
    // statement of progress, so it is the one worth asserting.
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('advances through every step in order', async () => {
    renderBooking();

    fireEvent.press((await screen.findAllByTestId(/^booking-doctor-/))[0]);
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();

    fireEvent.press(screen.getByTestId('booking-to-time'));
    expect(screen.getByText('Step 3 of 5')).toBeTruthy();

    fireEvent.press((await screen.findAllByTestId(/^booking-slot-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-reason'));
    expect(screen.getByText('Step 4 of 5')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('booking-reason'), 'Follow-up');
    fireEvent.press(screen.getByTestId('booking-to-confirm'));
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();
  });

  it('will not leave the time step until a slot is chosen', async () => {
    renderBooking();
    fireEvent.press((await screen.findAllByTestId(/^booking-doctor-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-time'));

    // A step that advanced with nothing selected would submit `slotId:
    // null` and 422 at the server.
    await screen.findAllByTestId(/^booking-slot-/);
    expect(screen.getByTestId('booking-to-reason').props.accessibilityState.disabled).toBe(true);
  });

  it('will not leave the reason step empty — the clinic reads it', async () => {
    renderBooking();
    fireEvent.press((await screen.findAllByTestId(/^booking-doctor-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-time'));
    fireEvent.press((await screen.findAllByTestId(/^booking-slot-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-reason'));

    const submit = screen.getByTestId('booking-to-confirm');
    expect(submit.props.accessibilityState.disabled).toBe(true);

    // Whitespace is not a reason.
    fireEvent.changeText(screen.getByTestId('booking-reason'), '   ');
    expect(screen.getByTestId('booking-to-confirm').props.accessibilityState.disabled).toBe(true);
  });

  it('caps the reason at the length the column accepts', async () => {
    renderBooking();
    fireEvent.press((await screen.findAllByTestId(/^booking-doctor-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-time'));
    fireEvent.press((await screen.findAllByTestId(/^booking-slot-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-reason'));

    const input = screen.getByTestId('booking-reason');
    fireEvent.changeText(input, 'x'.repeat(400));
    // Truncated in the client rather than rejected by the server.
    expect(screen.getByTestId('booking-reason').props.value).toHaveLength(300);
  });

  it('steps back without losing the step behind it', async () => {
    renderBooking();
    fireEvent.press((await screen.findAllByTestId(/^booking-doctor-/))[0]);
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();

    fireEvent.press(screen.getByTestId('booking-back'));
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  it('guards the exit rather than discarding a part-finished booking', async () => {
    renderBooking();
    await screen.findByTestId('booking-flow');

    // Back from the first step is an exit, and an exit mid-task asks.
    // The sheet is mounted either way — RN's Modal renders its children
    // whether or not it is visible — so presence proves nothing. What
    // proves it is that the flow did NOT navigate away.
    fireEvent.press(screen.getByTestId('booking-back'));
    expect(await screen.findByTestId('booking-discard-confirm')).toBeTruthy();
    expect(screen.queryByTestId('tabs-stub')).toBeNull();
    expect(screen.getByTestId('booking-flow')).toBeTruthy();
  });
});

describe('submitting', () => {
  it('books the chosen slot and leaves the flow', async () => {
    const book = jest.spyOn(appointmentService, 'book');
    renderBooking();
    await walkToConfirm();

    fireEvent.press(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(book).toHaveBeenCalledTimes(1));
    const request = book.mock.calls[0]?.[0];
    expect(request?.reason).toBe('Ongoing chest pain');
    expect(request?.doctorId).toBeTruthy();
    expect(request?.slotId).toBeTruthy();

    // It lands on the appointment, not back at step one.
    await waitFor(() => expect(screen.getByTestId('tabs-stub')).toBeTruthy());
  });

  it('trims the reason before sending it', async () => {
    const book = jest.spyOn(appointmentService, 'book');
    renderBooking();
    await walkToConfirm('  Sore throat  ');

    fireEvent.press(screen.getByTestId('booking-submit'));
    await waitFor(() => expect(book).toHaveBeenCalled());
    expect(book.mock.calls[0]?.[0]?.reason).toBe('Sore throat');
  });
});

/**
 * The row's own acceptance criterion, and the reason the suite exists.
 */
describe('a taken slot (409) recovers without losing input', () => {
  it('returns to the time step, keeps the reason, and shows the server’s message', async () => {
    jest
      .spyOn(appointmentService, 'book')
      .mockRejectedValueOnce(conflict('That time was just taken.'));

    renderBooking();
    await walkToConfirm('Ongoing chest pain');
    fireEvent.press(screen.getByTestId('booking-submit'));

    // Back one step — never to the start of a five-step flow.
    await waitFor(() => expect(screen.getByText('Step 3 of 5')).toBeTruthy());

    // The server's words, not a generic failure.
    expect(screen.getByTestId('booking-failure')).toBeTruthy();
    expect(screen.getByText('That time was just taken.')).toBeTruthy();

    // And the typing survived. This is the whole point: a patient who has
    // described why they are coming in should not have to do it twice.
    fireEvent.press((await screen.findAllByTestId(/^booking-slot-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-reason'));
    expect(screen.getByTestId('booking-reason').props.value).toBe('Ongoing chest pain');
  });

  it('clears the stale slot so the same taken time cannot be resubmitted', async () => {
    jest.spyOn(appointmentService, 'book').mockRejectedValueOnce(conflict('Gone.'));

    renderBooking();
    await walkToConfirm();
    fireEvent.press(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(screen.getByText('Step 3 of 5')).toBeTruthy());
    // Nothing selected: Continue is disabled until a fresh slot is picked.
    await screen.findAllByTestId(/^booking-slot-/);
    expect(screen.getByTestId('booking-to-reason').props.accessibilityState.disabled).toBe(true);
  });

  it('succeeds on the retry, and books the NEW slot', async () => {
    const book = jest
      .spyOn(appointmentService, 'book')
      .mockRejectedValueOnce(conflict('That time was just taken.'));

    renderBooking();
    await walkToConfirm();
    fireEvent.press(screen.getByTestId('booking-submit'));
    await waitFor(() => expect(screen.getByText('Step 3 of 5')).toBeTruthy());

    const slots = await screen.findAllByTestId(/^booking-slot-/);
    const second = slots[1] ?? slots[0];
    fireEvent.press(second);
    fireEvent.press(screen.getByTestId('booking-to-reason'));
    fireEvent.press(screen.getByTestId('booking-to-confirm'));
    fireEvent.press(await screen.findByTestId('booking-submit'));

    await waitFor(() => expect(book).toHaveBeenCalledTimes(2));

    // The retry must carry the NEW slot. Resubmitting the taken one would
    // lose the same race a second time, forever.
    const first = book.mock.calls[0]?.[0];
    const retry = book.mock.calls[1]?.[0];
    expect(retry?.slotId).not.toBe(first?.slotId);
    // …and the same reason, still not retyped.
    expect(retry?.reason).toBe(first?.reason);

    await waitFor(() => expect(screen.getByTestId('tabs-stub')).toBeTruthy());
  });

  it('does not send the patient back a step for a failure that is not a conflict', async () => {
    // A 500 is not a lost race. Returning to the time step would tell the
    // patient to pick a different time for a problem that is not theirs.
    jest
      .spyOn(appointmentService, 'book')
      .mockRejectedValueOnce(
        Object.assign(new Error('API error: server'), { kind: 'server' as const, ref: 'REF-1' }),
      );

    renderBooking();
    await walkToConfirm();
    fireEvent.press(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(screen.getByTestId('booking-failure')).toBeTruthy());
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();
  });
});

describe('arriving from a doctor profile with a time (G-09)', () => {
  /**
   * The profile's availability preview hands over a `startsAt`. It is a
   * REQUEST, not a selection: the flow re-reads the day from the server
   * and adopts the time only if it is still offered. These two tests are
   * the two halves of that sentence.
   */
  async function offeredSlots(): Promise<readonly { id: string; startsAt: string }[]> {
    const from = new Date();
    from.setDate(from.getDate() + 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return appointmentService.listSlots('DR-1', from.toISOString(), to.toISOString());
  }

  it('opens on the time step with that slot already chosen', async () => {
    const [slot] = await offeredSlots();
    if (slot === undefined) throw new Error('the fixture offered no slots');

    renderBooking({ doctorId: 'DR-1', startsAt: slot.startsAt });

    // Straight to Time — the doctor and the day both came in the params,
    // so making the patient re-choose them would waste the hand-off.
    expect(await screen.findByTestId('booking-to-reason')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId(`booking-slot-${slot.id}`).props.accessibilityState.selected).toBe(
        true,
      );
    });
  });

  it("chooses nothing when the time is no longer on the server's list", async () => {
    const taken = new Date();
    taken.setDate(taken.getDate() + 1);
    taken.setHours(6, 15, 0, 0);

    renderBooking({ doctorId: 'DR-1', startsAt: taken.toISOString() });

    // Somebody else took it while the profile was open. The honest
    // outcome is the time step with nothing selected — never a booking
    // against a slot the server did not offer.
    const slots = await screen.findAllByTestId(/^booking-slot-/);
    for (const slot of slots) {
      expect(slot.props.accessibilityState.selected).toBe(false);
    }
    expect(screen.getByTestId('booking-to-reason').props.accessibilityState.disabled).toBe(true);
  });

  it('starts on the date step when the doctor came without a time', async () => {
    renderBooking({ doctorId: 'DR-1' });

    // The Book button's behaviour, unchanged: a doctor and no day.
    expect(await screen.findByTestId('booking-to-time')).toBeTruthy();
  });

  /**
   * The third half of that sentence, and the one nothing had run: a
   * requested time the **date strip cannot show**. `dayOffsetOf` answers
   * `null` for a day in the past, a day beyond the fourteen the strip
   * offers, and a string that is not a date at all — and each of those
   * arrives in the ordinary way, from a notification or a link a patient
   * kept. The flow then starts on the **date** step, which is where it
   * would have started with no time at all. The failure it avoids is
   * landing on a time step reading a day the patient cannot see or
   * change.
   */
  it.each([
    ['a day that has already passed', () => startOfTomorrow(-3)],
    ['a day beyond the strip', () => startOfTomorrow(60)],
  ])('ignores %s and starts where it would have', async (_name, at) => {
    renderBooking({ doctorId: 'DR-1', startsAt: at().toISOString() });

    expect(await screen.findByTestId('booking-to-time')).toBeTruthy();
    expect(screen.queryByTestId('booking-to-reason')).toBeNull();
  });

  it('ignores a startsAt that is not a date, rather than crashing on it', async () => {
    renderBooking({ doctorId: 'DR-1', startsAt: 'tomorrow-ish' });

    expect(await screen.findByTestId('booking-to-time')).toBeTruthy();
    expect(screen.getByTestId('booking-flow')).toBeTruthy();
  });
});

describe('the discard guard (I-03)', () => {
  it('leaves the flow when the patient confirms', async () => {
    /**
     * Booking is a modal *over* something, so this one needs a history
     * to go back to. `renderBooking` mounts it as the only route, where
     * `goBack()` has nowhere to go and the guard's confirm branch
     * therefore cannot be observed — which is why it had never run.
     */
    const navigation = createNavigationContainerRef<RootStackParamList>();
    renderWithProviders(
      <NavigationContainer ref={navigation}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Tabs" component={TabsStub} />
          <Stack.Screen name="Booking" component={BookingFlow} />
        </Stack.Navigator>
      </NavigationContainer>,
    );

    await act(async () => {
      navigation.navigate('Booking', {});
    });
    await screen.findByTestId('booking-flow');

    fireEvent.press(screen.getByTestId('booking-back'));
    fireEvent.press(await screen.findByTestId('booking-discard-confirm'));

    await waitFor(() => expect(screen.queryByTestId('booking-flow')).toBeNull());
    expect(screen.getByTestId('tabs-stub')).toBeTruthy();
  });

  it('stays exactly where it was when the patient backs out of the guard', async () => {
    renderBooking();
    const [doctorCard] = await screen.findAllByTestId(/^booking-doctor-/);
    fireEvent.press(doctorCard);
    fireEvent.press(await screen.findByTestId('booking-to-time'));
    const [slot] = await screen.findAllByTestId(/^booking-slot-/);
    fireEvent.press(slot);
    fireEvent.press(screen.getByTestId('booking-to-reason'));
    fireEvent.changeText(await screen.findByTestId('booking-reason'), 'Ongoing headaches');

    // Back three times to the first step, then change your mind about
    // leaving. The half-written reason is the thing that must survive.
    fireEvent.press(screen.getByTestId('booking-back'));
    fireEvent.press(screen.getByTestId('booking-back'));
    fireEvent.press(screen.getByTestId('booking-back'));
    fireEvent.press(screen.getByTestId('booking-back'));
    fireEvent.press(await screen.findByTestId('booking-discard-cancel'));

    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    fireEvent.press((await screen.findAllByTestId(/^booking-doctor-/))[0]);
    fireEvent.press(await screen.findByTestId('booking-to-time'));
    fireEvent.press((await screen.findAllByTestId(/^booking-slot-/))[0]);
    fireEvent.press(screen.getByTestId('booking-to-reason'));

    expect((await screen.findByTestId('booking-reason')).props.value).toBe('Ongoing headaches');
  });
});

describe('choosing a different day', () => {
  it('re-asks the server for that day rather than filtering what it has', async () => {
    // The strip is a query parameter, not a filter: availability minus
    // time-off minus booked minus buffer is server logic (I-04), and a
    // client that narrowed a list it already had would be computing it.
    const listSlots = jest.spyOn(appointmentService, 'listSlots');
    renderBooking({ doctorId: 'DR-1' });
    await screen.findByTestId('booking-day-1');
    const before = listSlots.mock.calls.length;

    fireEvent.press(screen.getByTestId('booking-day-4'));

    await waitFor(() => expect(listSlots.mock.calls.length).toBeGreaterThan(before));
    const last = listSlots.mock.calls[listSlots.mock.calls.length - 1];
    expect(new Date(String(last?.[1])).getDate()).toBe(startOfTomorrow(3).getDate());
    listSlots.mockRestore();
  });
});

/**
 * The optional note — the half of I-05 that was plumbed and unreachable.
 *
 * `BookingRequest.notes` was declared in the port and the fixture's `book()`
 * already read `request.notes ?? null`, so the field worked end to end and
 * no screen collected it. The row names it: "reason (required, ≤300),
 * notes, visit type".
 *
 * Visit type is deliberately still absent and is not a gap: `BookingRequest`
 * has no field for it, the server assigns it, and the appointment detail
 * screen renders what comes back. Adding a picker would mean inventing a
 * contract, which is what §11 of the brief forbids.
 */
describe('the optional note (I-05)', () => {
  it('sends it when the patient wrote one, trimmed', async () => {
    const book = jest.spyOn(appointmentService, 'book');
    renderBooking();
    await walkToConfirm('Sore throat', '  I am allergic to penicillin  ');

    fireEvent.press(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(book).toHaveBeenCalled());
    expect(book.mock.calls[0]?.[0]?.notes).toBe('I am allergic to penicillin');
  });

  it('omits the field entirely when there is no note', async () => {
    // Not `notes: ''`. An empty string is a different statement from "the
    // patient added nothing", and the clinic would read a blank note where
    // there is none.
    const book = jest.spyOn(appointmentService, 'book');
    renderBooking();
    await walkToConfirm('Sore throat');

    fireEvent.press(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(book).toHaveBeenCalled());
    const request = book.mock.calls[0]?.[0];
    expect(request?.notes).toBeUndefined();
    expect(Object.hasOwn(request ?? {}, 'notes')).toBe(false);
  });

  it('omits it when the patient typed only whitespace', async () => {
    const book = jest.spyOn(appointmentService, 'book');
    renderBooking();
    await walkToConfirm('Sore throat', '   \n  ');

    fireEvent.press(screen.getByTestId('booking-submit'));

    await waitFor(() => expect(book).toHaveBeenCalled());
    expect(book.mock.calls[0]?.[0]?.notes).toBeUndefined();
  });

  it('never blocks the step, because the field is optional', async () => {
    renderBooking();
    const [doctorCard] = await screen.findAllByTestId(/^booking-doctor-/);
    fireEvent.press(doctorCard);
    fireEvent.press(await screen.findByTestId('booking-to-time'));
    const [slot] = await screen.findAllByTestId(/^booking-slot-/);
    fireEvent.press(slot);
    fireEvent.press(screen.getByTestId('booking-to-reason'));

    // Reason filled, note empty: the step must still advance.
    fireEvent.changeText(await screen.findByTestId('booking-reason'), 'Follow-up');
    expect(screen.getByTestId('booking-to-confirm').props.accessibilityState.disabled).toBe(false);
  });

  it('shows the note on the confirm step, so nothing is sent unseen', async () => {
    renderBooking();
    await walkToConfirm('Sore throat', 'I am allergic to penicillin');

    expect(screen.getByTestId('booking-confirm-notes')).toBeTruthy();
    expect(screen.getByText('I am allergic to penicillin')).toBeTruthy();
  });

  it('shows no note row at all when there is no note', async () => {
    renderBooking();
    await walkToConfirm('Sore throat');

    expect(screen.queryByTestId('booking-confirm-notes')).toBeNull();
  });

  it('does not cap the note, because the contract states no limit', async () => {
    // `reason` is truncated at 300 because `model/types.ts` states that
    // limit. Nothing states one for `notes`, so a number here would be a
    // client rule that disagrees with the server the day it picks one —
    // the argument M-06 makes about the edit window, applied to a length.
    renderBooking();
    const long = 'x'.repeat(900);
    await walkToConfirm('Sore throat', long);

    expect(screen.getByTestId('booking-confirm-notes')).toBeTruthy();
    expect(screen.getByText(long)).toBeTruthy();
  });
});
