import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import type { BookableSlot } from '@/features/appointments/model/types';
import { appointmentService } from '@/features/appointments/service';
import { doctorService } from '@/features/doctors/service';
import type { DiscoverStackParamList, RootStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import type { PatientSafeDoctor } from './model/types';
import { DoctorProfileScreen } from './screens/DoctorProfileScreen';

/**
 * The availability preview on a doctor's profile — checklist G-09.
 *
 * The times are the server's (BE-06). What this file pins is everything
 * around them:
 *
 * - a **preview**, not the list: the first few, and nothing already past;
 * - a tap that opens the booking flow **on that time**, as a request the
 *   flow re-checks rather than as a selection it trusts;
 * - **empty is an answer, failure is an absence**, and the Book button
 *   survives both — asking is always allowed, whether or not this client
 *   can see a calendar.
 */

const DOCTOR: PatientSafeDoctor = {
  id: 'DR-1',
  fullName: 'Layla Haddad',
  title: 'Dr',
  specialty: 'Cardiology',
  departmentName: 'Cardiology',
  photoUrl: null,
  yearsOfExperience: 12,
  languages: ['English'],
  biography: null,
  education: [],
  ratingAvg: null,
  hospital: null,
  officeLocation: null,
};

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function slot(id: string, hours: number): BookableSlot {
  return {
    id,
    startsAt: hoursFromNow(hours),
    durationMin: 30,
    hospital: { id: 'HOS-1', name: 'Medora Central' },
  };
}

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

function stub(slots: BookableSlot[] | Error) {
  installed.push(jest.spyOn(doctorService, 'getById').mockResolvedValue(DOCTOR));
  const list = jest.spyOn(appointmentService, 'listSlots');
  if (slots instanceof Error) list.mockRejectedValue(slots);
  else list.mockResolvedValue(slots);
  installed.push(list);
  return list;
}

const Root = createNativeStackNavigator<RootStackParamList>();
const Discover = createNativeStackNavigator<DiscoverStackParamList>();

/**
 * The profile lives in the Discover stack and Booking is a root-level
 * modal, so the preview's navigation only means anything with both. The
 * Booking screen is a stub that renders its params — what is asserted is
 * what the profile ASKED for, not what the flow then did with it.
 */
function renderProfile() {
  return renderWithProviders(
    <NavigationContainer>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Tabs">
          {() => (
            <Discover.Navigator screenOptions={{ headerShown: false }}>
              <Discover.Screen
                name="DoctorProfile"
                component={DoctorProfileScreen}
                initialParams={{ doctorId: 'DR-1' }}
              />
            </Discover.Navigator>
          )}
        </Root.Screen>
        <Root.Screen name="Booking">
          {({ route }) => (
            <RNText testID="booking-stub">{JSON.stringify(route.params ?? {})}</RNText>
          )}
        </Root.Screen>
      </Root.Navigator>
    </NavigationContainer>,
  );
}

describe('the preview', () => {
  it('shows the next few times the server offered', async () => {
    stub([slot('SL-1', 24), slot('SL-2', 25), slot('SL-3', 26), slot('SL-4', 27)]);
    const view = renderProfile();

    expect(await view.findByTestId('doctor-availability-SL-1')).toBeTruthy();
    expect(view.getByTestId('doctor-availability-SL-3')).toBeTruthy();
    // Three, not four: a preview is a preview, and the whole list lives
    // in the booking flow.
    expect(view.queryByTestId('doctor-availability-SL-4')).toBeNull();
  });

  it('never offers a time that has already gone', async () => {
    stub([slot('SL-PAST', -2), slot('SL-NEXT', 20)]);
    const view = renderProfile();

    await view.findByTestId('doctor-availability-SL-NEXT');
    // A correct server never returns one, so this is a guard rather than
    // a rule — but a canned fixture does, and a past time rendered as
    // bookable is a broken promise rather than a stale one.
    expect(view.queryByTestId('doctor-availability-SL-PAST')).toBeNull();
  });

  it('opens the booking flow on the time that was tapped', async () => {
    const when = hoursFromNow(24);
    stub([{ ...slot('SL-1', 24), startsAt: when }]);
    const view = renderProfile();

    const chip = await view.findByTestId('doctor-availability-SL-1');
    await act(async () => {
      fireEvent.press(chip);
    });

    const params = JSON.parse((await view.findByTestId('booking-stub')).props.children as string);
    expect(params).toEqual({ doctorId: 'DR-1', startsAt: when });
  });

  it('opens the flow without a time from See all times', async () => {
    stub([slot('SL-1', 24)]);
    const view = renderProfile();

    const seeAll = await view.findByTestId('doctor-availability-see-all');
    await act(async () => {
      fireEvent.press(seeAll);
    });

    const params = JSON.parse((await view.findByTestId('booking-stub')).props.children as string);
    expect(params).toEqual({ doctorId: 'DR-1' });
  });
});

describe('when there is nothing to show', () => {
  it('says so when the week is empty, and keeps the Book button', async () => {
    stub([]);
    const view = renderProfile();

    expect(await view.findByTestId('doctor-availability-empty')).toBeTruthy();
    // The clinic can still offer a time; a patient may always ask.
    expect(view.getByTestId('doctor-profile-book')).toBeTruthy();
  });

  it('renders nothing at all when the slots cannot be read', async () => {
    stub(new EndpointNotImplementedError('ADR-033', 'capability.messages'));
    const view = renderProfile();

    // Waited on the profile first: the availability section renders
    // INSIDE the profile's boundary, so its skeleton is absent before
    // the profile loads too — a `waitFor` on the skeleton alone passes
    // instantly and asserts nothing.
    expect(await view.findByTestId('doctor-profile-book')).toBeTruthy();

    // What a production build does today. The profile is the screen; its
    // availability is an addition to it, so a failure is an absence
    // rather than an error card.
    await waitFor(() => {
      expect(view.queryByTestId('doctor-availability-loading')).toBeNull();
    });
    expect(view.queryByTestId('doctor-availability')).toBeNull();
    expect(view.queryByTestId('doctor-availability-empty')).toBeNull();
  });
});
