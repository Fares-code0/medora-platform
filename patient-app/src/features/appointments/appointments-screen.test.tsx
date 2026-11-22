import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';

import { profileService } from '@/features/profile/service';
import { en } from '@/i18n/messages';
import type { AppointmentsStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';
import { APPOINTMENT_STATUSES } from '@/types/vocabularies';
import { formatDateTime, formatRelative } from '@/utils/datetime';

import { AppointmentCard } from './components/AppointmentCard';
import type { Appointment, AppointmentPage } from './model/types';
import { AppointmentsScreen } from './screens/AppointmentsScreen';
import { appointmentService } from './service';

/**
 * The appointments tab — checklist I-01, I-02, and §4.2 of
 * `docs/COVERAGE.md`, which names the untaken branches in this tree as
 * error paths and error paths as what a PHI client is judged on.
 *
 * `AppointmentsScreen.tsx` sat at 46.7% of statements and
 * `AppointmentCard.tsx` at 25%: the two segments, the two empty states
 * they choose between, the failure, the refresh and every status badge
 * were unexercised. Each of those is a state a patient reaches by doing
 * something ordinary — opening the tab on a bad connection, looking at
 * Past before they have any, pulling to see whether the clinic approved
 * a request.
 */

/** The fixture clinic's zone — deliberately not the machine's. */
const CLINIC_ZONE = 'Asia/Amman';

const NOW = '2026-09-10T09:00:00.000Z';

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'APT-1',
    startsAt: NOW,
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
    clinicTimezone: CLINIC_ZONE,
    ...overrides,
  };
}

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

const navigate = jest.fn();
// `mock`-prefixed so the factory below may close over it: this screen
// reaches the root navigator through `useNavigation()` rather than a
// prop, because Booking is a modal above the tabs rather than a route
// inside them.
const mockRootNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual<object>('@react-navigation/native'),
  useNavigation: () => ({ navigate: (...args: unknown[]) => mockRootNavigate(...args) }),
}));

/**
 * Renders the tab with `list` under the test's control.
 *
 * `list` is spied rather than the whole service replaced, because the
 * seam is what decides which adapter is live and a test that swapped it
 * would stop proving that this screen goes through it.
 */
async function renderAppointments(list: (scope: 'upcoming' | 'past') => Promise<Appointment[]>) {
  // One page, and the last one. Every test below this line predates
  // paging and is about something else; `renderPaged` is what the
  // paging tests use.
  return renderPagedAppointments((scope) =>
    list(scope).then((items) => ({ items, totalItems: items.length, hasMore: false })),
  );
}

async function renderPagedAppointments(
  list: (scope: 'upcoming' | 'past', page: number) => Promise<AppointmentPage>,
) {
  navigate.mockClear();
  mockRootNavigate.mockClear();
  const spy = jest
    .spyOn(appointmentService, 'list')
    .mockImplementation((scope, page = 1) => list(scope, page));
  installed.push(spy);

  const view = renderWithProviders(
    <AppointmentsScreen
      {...({
        navigation: { navigate },
        route: { key: 'apt-1', name: 'AppointmentsRoot', params: undefined },
      } as unknown as NativeStackScreenProps<AppointmentsStackParamList, 'AppointmentsRoot'>)}
    />,
  );
  await act(async () => undefined);
  return { ...view, spy };
}

/** The honest "the query has settled" signal — see `health-records.test.tsx`. */
async function settled(view: { queryByTestId: (id: string) => unknown }) {
  // Poll with a plain presence check, not `expect(...).toBeNull()`: a failing
  // `toBeNull` on a test instance pretty-prints the whole fiber graph into its
  // message, about two seconds of CPU per poll that `waitFor` then throws
  // away — measured 2026-11-10, Phase 0. The assertion itself is unchanged
  // and runs once, after the wait, where it costs nothing when it passes.
  await waitFor(
    () => {
      if (view.queryByTestId('appointments-list-loading') !== null) {
        throw new Error('appointments-list-loading is still on screen');
      }
    },
    { timeout: 10_000 },
  );
  expect(view.queryByTestId('appointments-list-loading')).toBeNull();
}

describe('the three states of the list (I-01, R-01…R-03)', () => {
  it('shows a skeleton before the answer arrives, not a bare spinner', async () => {
    const view = await renderAppointments(() => new Promise<Appointment[]>(() => {}));

    expect(view.getByTestId('appointments-list-loading')).toBeTruthy();
    expect(view.queryByTestId('appointments-list-empty')).toBeNull();
  });

  it('renders a card per appointment once it does', async () => {
    const view = await renderAppointments(() =>
      Promise.resolve([appointment({ id: 'APT-1' }), appointment({ id: 'APT-2' })]),
    );
    await settled(view);

    expect(view.getByTestId('appointment-card-APT-1')).toBeTruthy();
    expect(view.getByTestId('appointment-card-APT-2')).toBeTruthy();
  });

  it('offers a way to book from the empty upcoming list (R-02)', async () => {
    const view = await renderAppointments(() => Promise.resolve([]));
    await settled(view);

    expect(view.getByTestId('appointments-list-empty')).toBeTruthy();
    expect(view.getByText('Nothing booked')).toBeTruthy();
    // "No appointments" is a dead end; "No appointments — Book one" is a
    // screen. The empty state's own action is the second Book control.
    // Two controls carry that label — the screen's own button above the
    // list, and the empty state's action. The empty state's is the last.
    const booking = view.getAllByText('Book an appointment');
    expect(booking.length).toBe(2);
    fireEvent.press(booking[booking.length - 1]);
    expect(mockRootNavigate).toHaveBeenCalledWith('Booking', {});
  });

  it('shows a retry on failure, and retrying re-asks the server (R-03)', async () => {
    let attempts = 0;
    const view = await renderAppointments(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(Object.assign(new Error('API error: network'), { kind: 'network' }))
        : Promise.resolve([appointment()]);
    });

    const retry = await waitFor(() => view.getByTestId('appointments-list-error-retry'));
    await act(async () => {
      fireEvent.press(retry);
    });

    await waitFor(() => expect(view.getByTestId('appointment-card-APT-1')).toBeTruthy());
    expect(attempts).toBe(2);
  });
});

describe('the two segments are two questions', () => {
  it('asks the server for the scope, rather than filtering one list', async () => {
    // A client-side split would mean the phone holding every past
    // appointment to show the upcoming ones — more PHI in memory than
    // the screen needs, for a question the server can answer.
    const view = await renderAppointments((scope) =>
      Promise.resolve(scope === 'upcoming' ? [appointment({ id: 'APT-UP' })] : []),
    );
    await settled(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('appointments-scope-past'));
    });

    await waitFor(() => expect(view.getByText('No past appointments')).toBeTruthy());
    // The page number is the query's, not the screen's: the assertion
    // names it so a screen that started passing its own would fail here.
    expect(view.spy).toHaveBeenCalledWith('past', 1);
  });

  it('gives Past its own empty state, with no Book button in it', async () => {
    // Booking is not the next action for "you have never been here".
    const view = await renderAppointments(() => Promise.resolve([]));
    await settled(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('appointments-scope-past'));
    });

    await waitFor(() => expect(view.getByText('No past appointments')).toBeTruthy());
    expect(view.queryByText('Nothing booked')).toBeNull();
  });
});

describe('pull-to-refresh', () => {
  it('re-asks the server, because status changes at the clinic', async () => {
    const view = await renderAppointments(() => Promise.resolve([appointment()]));
    await settled(view);
    const before = view.spy.mock.calls.length;

    await act(async () => {
      view.getByTestId('appointments-screen').props.refreshControl.props.onRefresh();
    });

    await waitFor(() => expect(view.spy.mock.calls.length).toBeGreaterThan(before));
  });
});

describe('opening one', () => {
  it('navigates by id, never by index', async () => {
    const view = await renderAppointments(() => Promise.resolve([appointment({ id: 'APT-7' })]));
    await settled(view);

    fireEvent.press(view.getByTestId('appointment-card-APT-7'));

    expect(navigate).toHaveBeenCalledWith('AppointmentDetail', { appointmentId: 'APT-7' });
  });
});

describe('the card (I-02)', () => {
  it.each([...APPOINTMENT_STATUSES])('renders the %s badge', (status) => {
    // All eight, including `awaiting-patient` and `no-show` — the two a
    // naive implementation forgets.
    const { getByTestId } = renderWithProviders(
      <AppointmentCard testID="card" appointment={appointment({ status })} onPress={jest.fn()} />,
    );

    expect(getByTestId('card-status')).toBeTruthy();
  });

  it('always shows the absolute time, and the relative hint beside it', () => {
    // The relative form is a hint, so it can never be the only answer to
    // "when" — it sits beside the absolute time and never replaces it.
    const { getByText } = renderWithProviders(
      <AppointmentCard testID="card" appointment={appointment()} onPress={jest.fn()} />,
    );

    expect(getByText(formatDateTime(NOW, 'en', CLINIC_ZONE))).toBeTruthy();
    expect(getByText(formatRelative(NOW, 'en', { timeZone: CLINIC_ZONE }))).toBeTruthy();
  });

  it('renders the time in the CLINIC’s zone, not the phone’s (A-08)', () => {
    // `GET /me/appointments` returns `clinicTimezone` and the mapper
    // dropped it until 2026-09-12, so a patient one zone from their
    // clinic read the wrong time for their own appointment. The fixture
    // clinic is in Amman and CI is not, which is what makes this
    // assertion mean something.
    const { getByText, queryByText } = renderWithProviders(
      <AppointmentCard testID="card" appointment={appointment()} onPress={jest.fn()} />,
    );

    expect(getByText(formatDateTime(NOW, 'en', CLINIC_ZONE))).toBeTruthy();
    expect(queryByText(formatDateTime(NOW, 'en', 'America/New_York'))).toBeNull();
  });

  it('falls back to the device zone when the payload carried none', () => {
    // A fixture, or a payload from before the field existed. The client
    // does not guess a zone for a clinic.
    const { getByText } = renderWithProviders(
      <AppointmentCard
        testID="card"
        appointment={appointment({ clinicTimezone: null })}
        onPress={jest.fn()}
      />,
    );

    expect(getByText(formatDateTime(NOW, 'en'))).toBeTruthy();
  });

  it('renders both of them in the app’s language, not the phone’s', () => {
    // Until 2026-09-12 every formatter passed `undefined` to `Intl`,
    // which resolves the DEVICE's locale — so a patient who set Medora
    // to Arabic read Arabic headings above an English date and an
    // English "tomorrow". The assertion is not about Arabic wording: it
    // is that the app's own locale reaches the formatter at all.
    const arabic = renderWithProviders(
      <AppointmentCard testID="card" appointment={appointment()} onPress={jest.fn()} />,
      { locale: 'ar' },
    );

    expect(arabic.queryByText(formatDateTime(NOW, 'en', CLINIC_ZONE))).toBeNull();
    expect(arabic.getByText(formatDateTime(NOW, 'ar', CLINIC_ZONE))).toBeTruthy();
    expect(arabic.getByText(formatRelative(NOW, 'ar', { timeZone: CLINIC_ZONE }))).toBeTruthy();
  });

  it("prefixes the doctor's title when there is one, and does not invent one when there is not", () => {
    const withTitle = renderWithProviders(
      <AppointmentCard testID="a" appointment={appointment()} onPress={jest.fn()} />,
    );
    expect(withTitle.getByText('Dr Layla Haddad')).toBeTruthy();
    withTitle.unmount();

    const without = renderWithProviders(
      <AppointmentCard
        testID="b"
        appointment={appointment({
          doctor: { ...appointment().doctor, title: null },
        })}
        onPress={jest.fn()}
      />,
    );
    expect(without.getByText('Layla Haddad')).toBeTruthy();
  });

  it('omits the department separator when there is no department', () => {
    const { getByText, queryByText } = renderWithProviders(
      <AppointmentCard
        testID="card"
        appointment={appointment({ departmentName: null })}
        onPress={jest.fn()}
      />,
    );

    expect(getByText('Cardiology')).toBeTruthy();
    expect(queryByText(/·/)).toBeNull();
  });

  it('reads the whole card as one label, so a screen reader is not given four fragments', () => {
    const { getByTestId } = renderWithProviders(
      <AppointmentCard testID="card" appointment={appointment()} onPress={jest.fn()} />,
    );

    const label = String(getByTestId('card').props.accessibilityLabel);
    expect(label).toContain('Dr Layla Haddad');
    expect(label).toContain('Cardiology');
  });
});

/**
 * Paging — the half of I-01 the list was missing.
 *
 * `GET /me/appointments` has always been paginated. The screen rendered
 * page one and said nothing about the rest, so a patient looking for an
 * appointment from last spring concluded it was not there. These assert
 * the three things that stop that being true again: that a second page
 * can be asked for, that asking for it keeps the rows already on screen,
 * and that a one-page list is not decorated with controls it does not
 * need.
 */
describe('a history longer than one page (I-01)', () => {
  /** Two pages of one appointment each, keyed by page number. */
  function twoPages() {
    return jest.fn(async (_scope: 'upcoming' | 'past', page: number) =>
      page === 1
        ? { items: [appointment({ id: 'APT-P1' })], totalItems: 2, hasMore: true }
        : { items: [appointment({ id: 'APT-P2' })], totalItems: 2, hasMore: false },
    );
  }

  it('offers Show more when the server says there is another page', async () => {
    const view = await renderPagedAppointments(twoPages());
    await settled(view);

    expect(view.getByTestId('appointments-load-more')).toBeTruthy();
    expect(view.queryByTestId('appointments-end')).toBeNull();
  });

  it('appends the next page rather than replacing the one being read', async () => {
    const list = twoPages();
    const view = await renderPagedAppointments(list);
    await settled(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('appointments-load-more'));
    });

    await waitFor(() => expect(view.getByTestId('appointment-card-APT-P2')).toBeTruthy());
    // The first page is still there. A patient who tapped for more has
    // not lost what they were reading.
    expect(view.getByTestId('appointment-card-APT-P1')).toBeTruthy();
    expect(list).toHaveBeenCalledWith('upcoming', 2);
  });

  it('says "that is all" once the last page is in, and not before', async () => {
    const view = await renderPagedAppointments(twoPages());
    await settled(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('appointments-load-more'));
    });

    // Cheap presence check while polling — see `settled()` above.
    await waitFor(() => {
      if (view.queryByTestId('appointments-load-more') !== null) {
        throw new Error('appointments-load-more is still on screen');
      }
    });
    expect(view.queryByTestId('appointments-load-more')).toBeNull();
    expect(view.getByTestId('appointments-end')).toBeTruthy();
  });

  it('leaves a single-page list undecorated — no button, and no "that is all"', async () => {
    // On a list that never paged, "That is all of them" is noise: the
    // patient can see that it is all of them.
    const view = await renderAppointments(() => Promise.resolve([appointment({ id: 'APT-1' })]));
    await settled(view);

    expect(view.queryByTestId('appointments-load-more')).toBeNull();
    expect(view.queryByTestId('appointments-end')).toBeNull();
  });

  it('pages each segment separately, so Past does not continue Upcoming', async () => {
    const list = twoPages();
    const view = await renderPagedAppointments(list);
    await settled(view);

    await act(async () => {
      fireEvent.press(view.getByTestId('appointments-load-more'));
    });
    await waitFor(() => expect(view.getByTestId('appointment-card-APT-P2')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('appointments-scope-past'));
    });

    // Page 1 again, because the scope is part of the query key. Asking
    // the server for page 2 of a list the patient has not seen page 1 of
    // would skip the newest half of their history.
    await waitFor(() => expect(list).toHaveBeenCalledWith('past', 1));
  });
});

describe('an account with no clinical record (F-09)', () => {
  function profileSays(linkedToClinicalRecord: boolean) {
    const spy = jest.spyOn(profileService, 'get').mockResolvedValue({
      displayName: 'Sara Ahmed',
      photoUrl: null,
      fields: [],
      linkedToClinicalRecord,
    });
    installed.push(spy);
  }

  it('explains the empty list on both segments, with no link or claim action', async () => {
    profileSays(false);
    const view = await renderAppointments(() => Promise.resolve([]));

    expect(await view.findByText(en['profile.unlinked.title'])).toBeTruthy();
    expect(view.queryByText(en['appointments.empty.upcoming.title'])).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByTestId('appointments-scope-past'));
    });
    expect(await view.findByText(en['profile.unlinked.title'])).toBeTruthy();
    expect(view.queryByText(en['appointments.empty.past.title'])).toBeNull();
    expect(view.queryByText(/claim|link (your|my) record/i)).toBeNull();
  });

  it('still lists appointments when there are some, whatever the profile says', async () => {
    profileSays(false);
    const view = await renderAppointments(() => Promise.resolve([appointment({ id: 'APT-9' })]));

    expect(await view.findByTestId('appointment-card-APT-9')).toBeTruthy();
    expect(view.queryByText(en['profile.unlinked.title'])).toBeNull();
  });

  it('keeps the ordinary empty state for a linked account', async () => {
    profileSays(true);
    const view = await renderAppointments(() => Promise.resolve([]));

    expect(await view.findByText(en['appointments.empty.upcoming.title'])).toBeTruthy();
    expect(view.queryByText(en['profile.unlinked.title'])).toBeNull();
  });
});
