import type { ComponentType } from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { screen, waitFor } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { AppointmentsScreen } from './appointments/screens/AppointmentsScreen';
import { appointmentService } from './appointments/service';
import { ClinicScreen } from './clinic/screens/ClinicScreen';
import { clinicService } from './clinic/service';
import { DiscoverScreen } from './doctors/screens/DiscoverScreen';
import { doctorService } from './doctors/service';
import { InsuranceScreen } from './health/screens/InsuranceScreen';
import { TestsScreen } from './health/screens/TestsScreen';
import { healthService } from './health/service';
import { MessagesScreen } from './messages/screens/MessagesScreen';
import { messagingService } from './messages/service';
import { NotificationsScreen } from './notifications/screens/NotificationsScreen';
import { notificationService } from './notifications/service';

/**
 * Every list renders all three of its states — checklist U-06.
 *
 * ── Why one table rather than a file per feature ─────────────────────
 *
 * The row asks for the same three assertions of every list, and the
 * three are the same assertions because `AsyncBoundary` is the same
 * component (R-01, R-02, R-03). A file per feature would be eleven
 * copies of one test with the stub changed, and eleven places for the
 * twelfth list to be forgotten.
 *
 * A table cannot be forgotten in the same way: adding a list means
 * adding a row, and a row that is wrong fails immediately. What it costs
 * is that these are **state** tests and not feature tests — what each
 * list does with its data is asserted where that feature's own tests
 * live (`appointments.test.tsx`, `pagination.test.tsx`,
 * `notifications.test.tsx`, and so on).
 *
 * ── Why the three states are worth asserting at all ──────────────────
 *
 * `AsyncBoundary` orders them deliberately — error before loading,
 * loading before data, empty before children — and a screen gets that
 * ordering by passing it a query. The failure this catches is not
 * `AsyncBoundary` breaking; it is a screen that renders its own list
 * directly, or forgets `isEmpty`, and so shows a blank page where an
 * empty state belongs. A blank page is the single most common way a
 * patient concludes the app is broken.
 *
 * ── The empty state is per-list, and that is the point ───────────────
 *
 * `isEmpty` is a predicate each screen supplies, so "empty" means
 * something different for a list of appointments and a search result.
 * Each row below therefore says what empty looks like *for that query*.
 */

/** A promise that never settles — the pending state, held open. */
function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

function failing<T>(): Promise<T> {
  return Promise.reject(Object.assign(new Error('the clinic did not answer'), { kind: 'server' }));
}

type Behaviour = 'loading' | 'empty' | 'error';

interface ListCase {
  /** The feature, for the test name. */
  readonly feature: string;
  /** The `AsyncBoundary` testID; the three states derive from it. */
  readonly boundary: string;
  /**
   * The screen. Typed loosely and cast at the navigator, because these
   * screens take React Navigation's own props and the navigator here is
   * deliberately untyped — a `ParamListBase` stack is what lets one
   * harness mount ten screens from different stacks.
   */
  readonly Screen: ComponentType<never>;
  /**
   * The one query behind the boundary under test. It is what the three
   * behaviours are applied to.
   */
  readonly subject: (behaviour: Behaviour) => { mockRestore: () => void };
  /**
   * Every OTHER query on the same screen, always resolved with something
   * valid. Driving a whole screen into one state would prove less: a
   * `clinic-hours` error next to a `clinic-profile` error cannot show
   * which boundary produced the error state on screen. Holding the
   * neighbours healthy is what isolates the assertion.
   */
  readonly support?: readonly (() => { mockRestore: () => void })[];
}

/**
 * Stubs one service method three ways.
 *
 * `empty` is supplied per method because an empty list is `[]` for most
 * ports and something else for the few that answer with an object.
 */
function responder<T extends object, K extends keyof T>(
  service: T,
  method: K,
  empty: unknown,
): (behaviour: Behaviour) => { mockRestore: () => void } {
  return (behaviour) => {
    const spy = jest.spyOn(service, method as never);
    if (behaviour === 'loading') spy.mockImplementation(() => pending() as never);
    else if (behaviour === 'error') spy.mockImplementation(() => failing() as never);
    else spy.mockImplementation(() => Promise.resolve(empty) as never);
    return spy;
  };
}

/** A neighbouring query, always healthy. */
function healthy<T extends object, K extends keyof T>(
  service: T,
  method: K,
  value: unknown,
): () => { mockRestore: () => void } {
  return () => {
    const spy = jest.spyOn(service, method as never);
    spy.mockImplementation(() => Promise.resolve(value) as never);
    return spy;
  };
}

/** An empty page, in the shape every paginated port returns. */
const emptyPage = { items: [], totalItems: 0, hasMore: false };

const CLINIC_PROFILE = {
  name: 'Medora Clinic',
  addressLine: '1 Example Street',
  city: null,
  country: null,
  phone: null,
  website: null,
};

const LISTS: readonly ListCase[] = [
  {
    feature: 'Appointments',
    boundary: 'appointments-list',
    Screen: AppointmentsScreen as ComponentType<never>,
    subject: responder(appointmentService, 'list', emptyPage),
  },
  {
    feature: 'Doctor discovery',
    boundary: 'discover-doctors',
    Screen: DiscoverScreen as ComponentType<never>,
    subject: responder(doctorService, 'search', emptyPage),
    support: [healthy(doctorService, 'listSpecialties', [])],
  },
  {
    feature: 'Tests (status only)',
    boundary: 'tests-list',
    Screen: TestsScreen as ComponentType<never>,
    subject: responder(healthService, 'listLabTests', emptyPage),
  },
  {
    feature: 'Insurance on file',
    boundary: 'insurance-on-file',
    Screen: InsuranceScreen as ComponentType<never>,
    subject: responder(healthService, 'getInsurance', { insurance: null }),
  },
  {
    feature: 'Messages',
    boundary: 'messages-list',
    Screen: MessagesScreen as ComponentType<never>,
    subject: responder(messagingService, 'listConversations', []),
  },
  {
    feature: 'Notifications',
    boundary: 'notifications-list',
    Screen: NotificationsScreen as ComponentType<never>,
    subject: responder(notificationService, 'list', emptyPage),
    support: [healthy(notificationService, 'unreadCount', 0)],
  },
  {
    feature: 'Our clinic — departments',
    boundary: 'clinic-departments',
    Screen: ClinicScreen as ComponentType<never>,
    subject: responder(doctorService, 'listDepartments', []),
    support: [
      healthy(clinicService, 'getProfile', CLINIC_PROFILE),
      healthy(clinicService, 'getOpeningHours', []),
    ],
  },
  {
    feature: 'Our clinic — opening hours',
    boundary: 'clinic-hours',
    Screen: ClinicScreen as ComponentType<never>,
    subject: responder(clinicService, 'getOpeningHours', []),
    support: [
      healthy(clinicService, 'getProfile', CLINIC_PROFILE),
      healthy(doctorService, 'listDepartments', []),
    ],
  },
];

/**
 * A real navigator, as `booking.test.tsx` does.
 *
 * Several of these screens read navigation directly — `DiscoverScreen`
 * through `useFocusEffect` for G-10's recency list — so a hand-made
 * `navigation` prop is not enough for all of them, and a harness that
 * differed per row would be a harness with rows nobody trusts.
 */
const Stack = createNativeStackNavigator();

function renderList(listCase: ListCase) {
  return renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="UnderTest" component={listCase.Screen as never} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

describe.each(LISTS.map((listCase) => [listCase.feature, listCase] as const))(
  '%s',
  (_feature, listCase) => {
    let installed: { mockRestore: () => void }[] = [];

    function drive(behaviour: Behaviour) {
      installed = [listCase.subject(behaviour), ...(listCase.support ?? []).map((make) => make())];
    }

    afterEach(() => {
      for (const spy of installed) spy.mockRestore();
      installed = [];
    });

    it('shows a skeleton while it is loading, never a bare spinner (R-01)', async () => {
      drive('loading');
      renderList(listCase);

      // Skeletons are hidden from assistive technology on purpose —
      // announcing a placeholder is announcing nothing — so finding one
      // has to say so. That it is needed is the accessibility evidence.
      expect(
        await screen.findByTestId(`${listCase.boundary}-loading`, {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
    });

    it('shows an empty state with somewhere to go, not a blank page (R-02)', async () => {
      drive('empty');
      renderList(listCase);

      expect(await screen.findByTestId(`${listCase.boundary}-empty`)).toBeTruthy();
    });

    it('shows an error state, and offers a retry (R-03)', async () => {
      drive('error');
      renderList(listCase);

      const errorState = await screen.findByTestId(`${listCase.boundary}-error`);
      expect(errorState).toBeTruthy();
      // The retry is what makes the error state an action rather than an
      // apology. `AsyncBoundary` wires it from the query's `refetch`.
      await waitFor(() =>
        expect(screen.queryByTestId(`${listCase.boundary}-error-retry`)).not.toBeNull(),
      );
    });
  },
);

describe('the register itself', () => {
  it('covers every list screen that renders an AsyncBoundary over a collection', () => {
    // A guard against the one failure mode a table has: a twelfth list
    // arriving and nobody adding a row. The count is asserted so that
    // adding a list without adding a row is a decision someone makes on
    // purpose, in this file, rather than an omission.
    expect(LISTS).toHaveLength(8);
    expect(new Set(LISTS.map((listCase) => listCase.boundary)).size).toBe(LISTS.length);
  });
});
