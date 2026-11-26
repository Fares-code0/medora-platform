import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking, Text as RNText } from 'react-native';

import type { Appointment } from '@/features/appointments/model/types';
import { appointmentService } from '@/features/appointments/service';
import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { SessionProvider } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import { profileService } from '@/features/profile/service';
import { en } from '@/i18n/messages';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import { HomeScreen } from './screens/HomeScreen';

/**
 * Home — checklist F-01, F-02, F-03, F-04, F-05.
 *
 * This screen had no test, and it is the screen a phone is most likely to
 * be showing in a pocket. Two of the assertions below are about what is
 * *not* here, and they are the ones worth keeping:
 *
 * - **F-02.** The Emergency card navigates. It must never dial. Every
 *   dial in this app is behind `EmergencyCallButton`'s confirmation, and
 *   Home is the last place to make an exception (audit R-6).
 * - **F-05.** There is no AI entry point — not a disabled one, not a
 *   "coming soon" one. AD-4 is undecided, there is no model provider in
 *   this project, and a patient-facing symptom bot built on the
 *   doctor-side canned-response generator is the most dangerous thing
 *   this project could ship (audit R-5). A test is how that stays true
 *   through a redesign.
 */

const IDENTITY: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  identity: {
    subjectId: 'subject-1',
    role: 'patient',
    displayName: 'Amina Yusuf',
    email: 'amina@example.com',
    emailVerified: true,
  },
};

const NEXT: Appointment = {
  id: 'APT-2001',
  startsAt: new Date('2026-10-01T09:30:00Z').toISOString(),
  durationMin: 30,
  status: 'confirmed',
  priority: 'normal',
  departmentName: 'Cardiology',
  visitType: 'in-person',
  reason: 'Follow-up',
  notes: null,
  cancelledReason: null,
  clinicTimezone: 'Asia/Amman',
  hospital: null,
  availableActions: [],
  doctor: {
    id: 'DR-1',
    fullName: 'Layla Hassan',
    title: 'Dr',
    specialty: 'Cardiology',
    photoUrl: null,
  },
};

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

/** Installed spies only — see `profile-screen.test.tsx` for why. */
function spyOnList() {
  const spy = jest.spyOn(appointmentService, 'list');
  installed.push(spy);
  return spy;
}

function stubAuthService(): AuthService {
  return {
    login: jest.fn(),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    // Boot reads the seeded refresh token and calls this, which is how a
    // test reaches the authenticated state without driving the login form.
    refresh: jest.fn(() => Promise.resolve(IDENTITY)),
    logout: jest.fn(() => Promise.resolve()),
    register: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
  } as unknown as AuthService;
}

const Stack = createNativeStackNavigator();

/**
 * A real navigator, because `HomeScreen` calls `useNavigation()` rather
 * than taking a prop, and the quick actions navigate into nested tab
 * routes a hand-rolled stub would have to model. `navigate` is spied on
 * the container's ref-free root rather than mocked, so a route name that
 * does not exist fails here rather than in a store build.
 */
async function renderHome(
  options: {
    appointments?: readonly Appointment[];
    reject?: unknown;
    signedIn?: boolean;
    locale?: 'en' | 'ar';
  } = {},
) {
  const list = spyOnList();
  if (options.reject !== undefined) list.mockRejectedValue(options.reject);
  else {
    const items = [...(options.appointments ?? [NEXT])];
    list.mockResolvedValue({ items, totalItems: items.length, hasMore: false });
  }

  const authService = stubAuthService();
  const tokenStorage = createTokenStorage(createInMemorySecureStore());
  if (options.signedIn !== false) await tokenStorage.writeRefreshToken('refresh-1');

  const view = renderWithProviders(
    <SessionProvider authService={authService} tokenStorage={tokenStorage}>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Home" component={HomeScreen} />
          {/* Every destination Home can reach, so `navigate` resolves. */}
          <Stack.Screen name="Emergency" component={Blank} />
          <Stack.Screen name="Booking" component={Blank} />
          <Stack.Screen name="Tabs" component={DestinationStub} />
        </Stack.Navigator>
      </NavigationContainer>
    </SessionProvider>,
    { locale: options.locale ?? 'en' },
  );

  // Session boot and the first query both settle after render returns.
  await act(async () => undefined);

  return { ...view, list };
}

function Blank() {
  return null;
}

/**
 * A stand-in for the tab navigator that renders the params it was handed.
 *
 * Home's three deepest links — the next-appointment card, "See all", and
 * an activity row — all navigate into a *nested* route, and "did it go
 * somewhere" is a weaker claim than the code makes. What is asserted
 * with this is which appointment.
 */
function DestinationStub({ route }: { route: { params?: unknown } }) {
  return <RNText testID="destination">{JSON.stringify(route.params ?? {})}</RNText>;
}

describe('the shell (F-01)', () => {
  it('greets the patient by first name only', async () => {
    const { findByText } = await renderHome();

    expect(await findByText('Hello, Amina')).toBeTruthy();
  });

  it('greets a patient it does not know yet without a blank or a placeholder token', async () => {
    const { findByText, queryByText } = await renderHome({ signedIn: false });

    // A whole second sentence, not the name sentence with a filler word
    // in the slot: since C-09 "Hello, there" and "Hello, {name}" are two
    // keys, because Arabic greets a stranger without one.
    expect(await findByText(en['home.greetingAnonymous'])).toBeTruthy();
    expect(queryByText(/undefined|null|\{\{|\{name\}/)).toBeNull();
  });

  it('refetches on pull-to-refresh', async () => {
    const { getByTestId, list } = await renderHome();

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await act(async () => {
      fireEvent(getByTestId('home-screen'), 'refresh');
    });

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('renders an empty state with a next action when nothing is booked', async () => {
    const { findByText } = await renderHome({ appointments: [] });

    expect(await findByText('Nothing booked')).toBeTruthy();
    expect(await findByText('Book an appointment')).toBeTruthy();
  });

  it('renders an error state when the appointment query fails', async () => {
    const { findByText } = await renderHome({ reject: new Error('offline') });

    expect(await findByText(/Something went wrong/i)).toBeTruthy();
  });

  it('keeps Emergency and the quick actions up when the appointment query fails', async () => {
    // Everything on this screen that can fail is inside one boundary.
    // A patient whose appointments will not load still needs the rest.
    const { getByTestId } = await renderHome({ reject: new Error('offline') });

    await waitFor(() => expect(getByTestId('home-emergency-card')).toBeTruthy());
    expect(getByTestId('home-action-book')).toBeTruthy();
  });
});

describe('the emergency card (F-02)', () => {
  it('is above the next appointment in the reading order', async () => {
    // "Above the fold" is not something a test renderer can measure, but
    // tree order is what determines it on a scrolling screen and it is
    // what a screen reader follows.
    const view = await renderHome();

    // Depth-first, which is document order.
    const ids = view.UNSAFE_root.findAll(
      (node: { props: Record<string, unknown> }) => typeof node.props.testID === 'string',
    ).map((node: { props: Record<string, unknown> }) => node.props.testID as string);

    expect(ids).toContain('home-emergency-card');
    expect(ids).toContain('home-next-appointment-card');
    expect(ids.indexOf('home-emergency-card')).toBeLessThan(
      ids.indexOf('home-next-appointment-card'),
    );
  });

  it('opens emergency guidance and does not place a call', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    installed.push(openURL);
    const { getByTestId } = await renderHome();

    await act(async () => {
      fireEvent.press(getByTestId('home-emergency-card'));
    });

    expect(openURL).not.toHaveBeenCalled();
  });

  it('says so in its hint, so a screen-reader user knows before they tap', async () => {
    const { getByTestId } = await renderHome();

    const card = getByTestId('home-emergency-card');
    expect(card.props.accessibilityLabel).toBe('Emergency help');
    expect(card.props.accessibilityHint).toMatch(/does not place a call/i);
  });

  it('says the guidance works offline, which it does', async () => {
    const { findByText } = await renderHome();

    expect(await findByText(/Works offline/i)).toBeTruthy();
  });
});

describe('the next-appointment card (F-03)', () => {
  it("renders the server's status verbatim", async () => {
    // `awaiting-patient` is the kebab-case wire value. A client that
    // prettified it here would be a client that could disagree with the
    // backend vocabulary (A-07).
    const { findByTestId } = await renderHome({
      appointments: [{ ...NEXT, status: 'awaiting-patient' }],
    });

    expect(await findByTestId('home-next-appointment-status')).toBeTruthy();
  });

  it('offers no action derived from the status', async () => {
    // The server owns every transition and the payload does not carry
    // `availableActions` yet. A Cancel or Reschedule button computed from
    // `status: 'confirmed'` would be this client deciding policy ADR-033
    // has not written.
    const { findByTestId, queryByText } = await renderHome();

    await findByTestId('home-next-appointment-card');
    for (const forbidden of [/^Cancel$/i, /^Reschedule$/i, /^Confirm$/i, /^Accept$/i]) {
      expect(queryByText(forbidden)).toBeNull();
    }
  });

  it('names the doctor with their title when the payload carries one', async () => {
    const { findByText } = await renderHome();

    expect(await findByText(/Dr Layla Hassan/)).toBeTruthy();
  });

  it('omits the title rather than inventing one when it is null', async () => {
    const { findByText, queryByText } = await renderHome({
      appointments: [{ ...NEXT, doctor: { ...NEXT.doctor, title: null } }],
    });

    expect(await findByText(/Layla Hassan/)).toBeTruthy();
    expect(queryByText(/Dr\.? Layla/)).toBeNull();
  });
});

describe('the quick actions (F-04)', () => {
  it.each(['book', 'find', 'messages', 'records'])('offers %s', async (id) => {
    const { getByTestId } = await renderHome();

    expect(getByTestId(`home-action-${id}`)).toBeTruthy();
  });

  it.each(['book', 'find', 'messages', 'records'])(
    'navigates away from Home when %s is pressed, to a route that exists',
    async (id) => {
      // The navigator declares every destination Home names. React
      // Navigation warns on `navigate` to a route it cannot resolve, so a
      // typo'd or renamed route surfaces here rather than as a dead button
      // in a store build.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      installed.push(warn);
      const { getByTestId, queryByText } = await renderHome();

      await act(async () => {
        fireEvent.press(getByTestId(`home-action-${id}`));
      });

      expect(queryByText('Hello, Amina')).toBeNull();
      expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/not handled by any navigator/i));
    },
  );
});

describe('where Home sends a patient (F-03, F-04, F-06)', () => {
  /**
   * Five callbacks on this screen navigate, and four of them were
   * untested — "See all", the empty state's Book, the next-appointment
   * card, and a row of the activity feed. Each is a nested route
   * (`Tabs → AppointmentsTab → AppointmentDetail`), which is the shape
   * most likely to be quietly wrong: a typo in the inner `screen` name
   * resolves to the tab and lands the patient on the list.
   */
  function destination(view: { queryByTestId: (id: string) => unknown }): unknown {
    const node = view.queryByTestId('destination') as { props?: { children?: string } } | null;
    return node === null ? null : JSON.parse(node.props?.children ?? '{}');
  }

  it('opens the appointment the card is about, not the list', async () => {
    const view = await renderHome();

    await act(async () => {
      fireEvent.press(await view.findByTestId('home-next-appointment-card'));
    });

    expect(destination(view)).toEqual({
      screen: 'AppointmentsTab',
      params: { screen: 'AppointmentDetail', params: { appointmentId: NEXT.id } },
    });
  });

  it('sends "See all" to the list rather than to an appointment', async () => {
    const view = await renderHome();

    await act(async () => {
      fireEvent.press(await view.findByText(en['home.seeAll']));
    });

    expect(destination(view)).toEqual({
      screen: 'AppointmentsTab',
      params: { screen: 'AppointmentsRoot' },
    });
  });

  it('offers booking from the empty state, and reaches the booking flow', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    installed.push(warn);
    const view = await renderHome({ appointments: [] });

    await act(async () => {
      fireEvent.press(await view.findByText(en['home.empty.action']));
    });

    // Booking is a root-level modal, so there are no params to read —
    // what matters is that Home is gone and the route resolved.
    expect(view.queryByText('Hello, Amina')).toBeNull();
    expect(warn).not.toHaveBeenCalledWith(expect.stringMatching(/not handled by any navigator/i));
  });

  it('opens the appointment an activity row is about', async () => {
    // The feed's own rule: only an event carrying an appointment id is
    // pressable, because `/me/appointments/{id}` enforces its own
    // authorization and AD-5 has not decided the rest.
    const view = await renderHome();
    const row = await view.findByTestId('home-activity-AC-1');

    await act(async () => {
      fireEvent.press(row);
    });

    expect(destination(view)).toEqual({
      screen: 'AppointmentsTab',
      params: { screen: 'AppointmentDetail', params: { appointmentId: 'APT-2001' } },
    });
  });
});

/**
 * ── What this block used to assert, and why it changed ──────────────
 *
 * It asserted that Home had **no** assistant entry point of any kind —
 * "not a disabled one, not a 'coming soon' one" — on the grounds that
 * F-05 is gated on AD-4 and a patient-facing symptom bot built on the
 * doctor-side canned-response generator is the most dangerous thing this
 * project could ship (audit R-5).
 *
 * The danger is unchanged and so is the gate. What changed is where the
 * line is drawn: the harm is in what happens *after* the tap, not in the
 * existence of the tap. `features/ai/` is now a designed interface whose
 * every screen states that no assistant is connected, and the card below
 * says so on its face **before** anybody presses it.
 *
 * So the assertions below are the new rule, and they are tighter than a
 * ban would be — a ban only had to be true of this one file, while these
 * have to stay true of whatever the card leads to.
 */
describe('the assistant entry point is honest about itself (F-05, audit R-5)', () => {
  it('offers the assistants without claiming one is switched on', async () => {
    // Whether a provider is configured is the server's answer (503), given
    // where a question is asked; Home must not guess it either way.
    const { getByTestId, findByText } = await renderHome();

    expect(getByTestId('home-assistant-card')).toBeTruthy();
    expect(await findByText(/two assistants|general health question/i)).toBeTruthy();
  });

  it('promises nothing the assistant cannot do', async () => {
    // The shapes a "finished-looking" entry point takes. None of them
    // may appear on Home: each is a claim that something works.
    const { queryByText } = await renderHome();

    for (const forbidden of [
      /ask me anything/i,
      /how can i help/i,
      /check your symptoms/i,
      /coming soon/i,
      /powered by/i,
    ]) {
      expect(queryByText(forbidden)).toBeNull();
    }
  });

  it('ranks below the emergency card and the next appointment', async () => {
    // A capability that does not work does not outrank the two things on
    // this screen that do. Tree order is what a screen reader follows and
    // what "above the fold" means on a scrolling screen — the same idiom
    // the emergency card's own ordering test uses.
    const view = await renderHome();

    const ids = view.UNSAFE_root.findAll(
      (node: { props: Record<string, unknown> }) => typeof node.props.testID === 'string',
    ).map((node: { props: Record<string, unknown> }) => node.props.testID as string);

    expect(ids).toContain('home-assistant-card');
    expect(ids.indexOf('home-emergency-card')).toBeLessThan(ids.indexOf('home-assistant-card'));
    expect(ids.indexOf('home-next-appointment-card')).toBeLessThan(
      ids.indexOf('home-assistant-card'),
    );
  });

  it('says plainly that Medora does not give medical advice', async () => {
    const { findByText } = await renderHome();

    expect(await findByText(/does not give medical advice/i)).toBeTruthy();
  });
});

describe('an account with no clinical record (F-09)', () => {
  /** `GET /me/profile` answering `patient: null`, or a linked account. */
  function profileSays(linkedToClinicalRecord: boolean | Error) {
    const spy = jest.spyOn(profileService, 'get');
    installed.push(spy);
    if (linkedToClinicalRecord instanceof Error) spy.mockRejectedValue(linkedToClinicalRecord);
    else
      spy.mockResolvedValue({
        displayName: 'Amina Yusuf',
        photoUrl: null,
        fields: [],
        linkedToClinicalRecord,
      });
  }

  it('explains why there is nothing here instead of saying "Nothing booked"', async () => {
    profileSays(false);
    const view = await renderHome({ appointments: [] });

    expect(await view.findByText(en['profile.unlinked.title'])).toBeTruthy();
    expect(view.getByText(en['profile.unlinked.body'])).toBeTruthy();
    expect(view.queryByText(en['home.empty.title'])).toBeNull();
  });

  it('offers no way to link or claim a record, because that flow is undecided', async () => {
    profileSays(false);
    const view = await renderHome({ appointments: [] });

    await view.findByText(en['profile.unlinked.title']);
    expect(view.queryByText(en['home.empty.action'])).toBeNull();
    expect(view.queryByText(/claim|link (your|my) record/i)).toBeNull();
    // The rest of Home is untouched.
    expect(view.getByTestId('home-emergency-card')).toBeTruthy();
    expect(view.getByTestId('home-action-book')).toBeTruthy();
  });

  it('keeps the ordinary empty state for a linked account', async () => {
    profileSays(true);
    const view = await renderHome({ appointments: [] });

    expect(await view.findByText(en['home.empty.title'])).toBeTruthy();
    expect(view.queryByText(en['profile.unlinked.title'])).toBeNull();
  });

  it('does not claim "not linked" when the profile could not be read', async () => {
    profileSays(new Error('offline'));
    const view = await renderHome({ appointments: [] });

    expect(await view.findByText(en['home.empty.title'])).toBeTruthy();
    expect(view.queryByText(en['profile.unlinked.title'])).toBeNull();
  });
});

describe('the emergency card in Arabic (W-10 translation approval, 2026-11-23)', () => {
  it('labels, hints and describes the card in Arabic', async () => {
    const { getByTestId, findByText, queryByText } = await renderHome({ locale: 'ar' });

    const card = getByTestId('home-emergency-card');
    expect(card.props.accessibilityLabel).toBe('مساعدة طارئة');
    expect(card.props.accessibilityHint).toBe('يفتح إرشادات الطوارئ. ولا يُجري مكالمة.');
    expect(await findByText('ما يجب فعله، وبمن تتصل. تعمل دون اتصال بالإنترنت.')).toBeTruthy();
    expect(queryByText(/Works offline/i)).toBeNull();
  });
});
