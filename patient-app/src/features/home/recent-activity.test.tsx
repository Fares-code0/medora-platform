import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import { renderWithProviders } from '@/test/render';

import { RecentActivity } from './components/RecentActivity';
import { ACTIVITY_KINDS, type ActivityEvent } from './model/types';
import { activityService } from './service';

/**
 * Recent activity on Home — checklist F-06.
 *
 * Three things are worth a test, and only one of them is the list.
 *
 * **No server string reaches Home.** The sentence a patient reads is
 * looked up from the `kind`, so the assertion is that a kind renders its
 * catalogue copy — and the type is what makes any other outcome
 * impossible.
 *
 * **Empty is an answer; failed is an absence.** A new account with no
 * history gets an empty state. A feed that could not load renders
 * nothing at all, because Home's job is the emergency card, the next
 * appointment and the four actions, and a section that failed must not
 * put an error on top of them. In production today every load fails the
 * same way (BE-10).
 *
 * **Only appointments are linkable.** An event with no id is read-only
 * rather than a row that highlights and does nothing.
 */

const EVENTS: ActivityEvent[] = [
  {
    id: 'AC-1',
    kind: 'appointment-confirmed',
    occurredAt: new Date().toISOString(),
    appointmentId: 'APT-7',
  },
  {
    id: 'AC-2',
    kind: 'result-available',
    occurredAt: new Date().toISOString(),
    appointmentId: null,
  },
];

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub(result: ActivityEvent[] | Error) {
  const spy = jest.spyOn(activityService, 'listRecentActivity');
  if (result instanceof Error) spy.mockRejectedValue(result);
  else spy.mockResolvedValue(result);
  installed.push(spy);
  return spy;
}

const Stack = createNativeStackNavigator<{ Root: undefined; Opened: { id: string } }>();

function renderActivity() {
  const opened: string[] = [];
  const view = renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Root">
          {() => (
            <RecentActivity
              onOpenAppointment={(id) => {
                opened.push(id);
              }}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Opened">{() => <RNText>opened</RNText>}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>,
  );
  return { ...view, opened };
}

describe('the feed', () => {
  it('renders the client-side sentence for each kind, never a server string', async () => {
    stub(EVENTS);
    const view = renderActivity();

    expect(await view.findByText('An appointment was confirmed')).toBeTruthy();
    expect(view.getByText('A new test result is available')).toBeTruthy();
  });

  it('gives every kind the port can send its own sentence', async () => {
    stub(
      ACTIVITY_KINDS.map((kind, index) => ({
        id: `AC-${index}`,
        kind,
        occurredAt: new Date().toISOString(),
        appointmentId: null,
      })),
    );
    const view = renderActivity();

    await view.findByTestId('home-activity-AC-0');

    // The compile-time half is `Record<ActivityKind, MessageKey>`. This
    // is the half that catches two kinds pointing at the same key: a
    // patient cannot tell a cancellation from a reschedule if both rows
    // read the same, and the typechecker is happy either way.
    const rendered = ACTIVITY_KINDS.map(
      (_, index) => view.getByTestId(`home-activity-AC-${index}`).props.accessibilityLabel,
    );
    expect(new Set(rendered).size).toBe(ACTIVITY_KINDS.length);
    for (const label of rendered) expect(label).toBeTruthy();
  });

  it('opens the appointment an event points at', async () => {
    stub(EVENTS);
    const view = renderActivity();

    await act(async () => {
      fireEvent.press(await view.findByTestId('home-activity-AC-1'));
    });

    expect(view.opened).toEqual(['APT-7']);
  });

  it('leaves an event with nowhere to go read-only', async () => {
    stub(EVENTS);
    const view = renderActivity();

    const row = await view.findByTestId('home-activity-AC-2');
    // A row that highlights and does nothing is worse than a row that
    // never offered. Only `/me/appointments/{id}` enforces its own
    // authorization; the record routes are AD-5's to decide.
    expect(row.props.accessibilityRole).not.toBe('button');
    fireEvent.press(row);
    expect(view.opened).toEqual([]);
  });
});

describe('the two ways it can have no rows', () => {
  it('says nothing has happened yet when the feed is empty', async () => {
    stub([]);
    const view = renderActivity();

    expect(await view.findByTestId('home-activity-empty')).toBeTruthy();
  });

  it('renders nothing at all when the feed cannot be read', async () => {
    stub(new EndpointNotImplementedError('BE-10', 'capability.recentActivity'));
    const view = renderActivity();

    // What a production build does today. Nothing — not an error card,
    // not an empty state that would read as "nothing has happened", not
    // even the section heading.
    await waitFor(() => {
      expect(view.queryByText('Recent activity')).toBeNull();
    });
    expect(view.queryByTestId('home-activity-empty')).toBeNull();
    expect(view.queryByTestId('home-activity')).toBeNull();
  });

  it('is equally silent about a network failure', async () => {
    stub(Object.assign(new Error('offline'), { kind: 'network' }));
    const view = renderActivity();

    await waitFor(() => {
      expect(view.queryByText('Recent activity')).toBeNull();
    });
  });
});
