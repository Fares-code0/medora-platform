import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import type { DiscoverStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import type { DoctorSearchParams, PatientSafeDoctor, Specialty } from './model/types';
import { clearRecentDoctors, recordDoctorView } from './recent';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { doctorService } from './service';

/**
 * Searching and filtering on Discover — checklist G-01, G-05, G-06, G-10.
 *
 * `pagination.test.tsx` covers asking for page two. This covers getting
 * to page one: the debounce, the specialty chips, and the two rules that
 * are disclosure decisions rather than UX ones.
 *
 * **Search is server-side.** The tempting alternative — pull the roster,
 * filter in JS — puts every practitioner in the clinic on the phone. The
 * assertion for that is not "the right rows render"; it is that the
 * *query reaches the server*, which is why these tests read the params
 * `doctorService.search` was called with.
 *
 * **Recently viewed is hidden while searching or filtering.** Which
 * specialists this patient looked at is an inference about their health
 * (audit R-8), and showing it beside a search result is showing it to
 * whoever is looking over their shoulder at the answer they just asked
 * for.
 */

function doctor(id: string, name: string, specialty = 'Cardiology'): PatientSafeDoctor {
  return {
    id,
    fullName: name,
    title: 'Dr',
    specialty,
    departmentName: specialty,
    photoUrl: null,
    yearsOfExperience: 9,
    languages: ['English'],
    biography: null,
    education: [],
    ratingAvg: null,
    hospital: null,
    officeLocation: null,
  };
}

const SPECIALTIES: Specialty[] = [
  { id: 'SP-1', name: 'Cardiology' },
  { id: 'SP-2', name: 'Dermatology' },
];

const installed: { mockRestore: () => void }[] = [];

function stubService(specialties: Specialty[] = SPECIALTIES) {
  const search = jest.spyOn(doctorService, 'search').mockResolvedValue({
    items: [doctor('DR-1', 'Layla Haddad')],
    totalItems: 1,
    hasMore: false,
  });
  const list = jest.spyOn(doctorService, 'listSpecialties').mockResolvedValue(specialties);
  installed.push(search, list);
  return { search, list };
}

const Stack = createNativeStackNavigator<DiscoverStackParamList>();

function Stub({ testID }: { readonly testID: string }) {
  return <RNText testID={testID}>stub</RNText>;
}

function renderDiscover() {
  return renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="DiscoverRoot" component={DiscoverScreen} />
        <Stack.Screen name="DoctorProfile">
          {() => <Stub testID="doctor-profile-stub" />}
        </Stack.Screen>
        <Stack.Screen name="Clinic">{() => <Stub testID="clinic-stub" />}</Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

/** The last params the screen asked the server for. */
function lastParams(search: jest.SpyInstance): DoctorSearchParams {
  return (search.mock.calls.at(-1)?.[0] ?? {}) as DoctorSearchParams;
}

beforeEach(() => {
  jest.useFakeTimers();
  clearRecentDoctors();
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
  while (installed.length > 0) installed.pop()?.mockRestore();
  clearRecentDoctors();
});

describe('search reaches the server, and is debounced on the way (G-01, G-05)', () => {
  it('does not ask on every keystroke', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-search')).toBeTruthy());
    const before = search.mock.calls.length;

    fireEvent.changeText(view.getByTestId('discover-search'), 'l');
    fireEvent.changeText(view.getByTestId('discover-search'), 'la');
    fireEvent.changeText(view.getByTestId('discover-search'), 'lay');

    // Nothing yet: three keystrokes inside the debounce window are one
    // question, and asking three times is three round trips a patient on
    // a train pays for.
    expect(search.mock.calls.length).toBe(before);
  });

  it('asks once the typing stops, with the query the patient finished on', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-search')).toBeTruthy());

    fireEvent.changeText(view.getByTestId('discover-search'), 'l');
    fireEvent.changeText(view.getByTestId('discover-search'), 'layla');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    await waitFor(() => expect(lastParams(search).q).toBe('layla'));
  });

  it('trims the query, and sends no `q` at all for whitespace', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-search')).toBeTruthy());

    fireEvent.changeText(view.getByTestId('discover-search'), '   ');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    // An absent `q` is "show me everyone", which is what an empty box
    // means. `q: ''` would be a search for nothing.
    expect(lastParams(search)).not.toHaveProperty('q');
  });
});

describe('the specialty chips come from the server (G-06)', () => {
  it('renders one chip per specialty, plus All', async () => {
    stubService();
    const view = renderDiscover();

    await waitFor(() => expect(view.getByTestId('discover-specialty-SP-1')).toBeTruthy());
    expect(view.getByTestId('discover-specialty-SP-2')).toBeTruthy();
    expect(view.getByTestId('discover-specialty-all')).toBeTruthy();
    expect(view.getByTestId('discover-specialty-SP-2').props.accessibilityLabel).toBe(
      'Dermatology',
    );
    // A hardcoded list goes stale the first time the clinic hires into a
    // new specialty, so nothing renders before the server answers. Read
    // off the chip rather than by text: since G-07 there are two chip
    // rows and `Dermatology` is a specialty AND a department, so
    // `getByText` finds two and this assertion stopped being about the
    // specialty row at all.
  });

  it('renders no chip row at all before the specialties arrive', async () => {
    const search = jest.spyOn(doctorService, 'search').mockResolvedValue({
      items: [],
      totalItems: 0,
      hasMore: false,
    });
    const list = jest
      .spyOn(doctorService, 'listSpecialties')
      .mockImplementation(() => new Promise<Specialty[]>(() => {}));
    installed.push(search, list);

    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-search')).toBeTruthy());

    expect(view.queryByTestId('discover-specialty-all')).toBeNull();
  });

  it('sends the chosen specialty to the server', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-specialty-SP-2')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-specialty-SP-2'));
    });

    await waitFor(() => expect(lastParams(search).specialtyId).toBe('SP-2'));
  });

  it('un-selects on a second tap, rather than needing All', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-specialty-SP-2')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-specialty-SP-2'));
    });
    await waitFor(() => expect(lastParams(search).specialtyId).toBe('SP-2'));

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-specialty-SP-2'));
    });

    await waitFor(() => expect(lastParams(search)).not.toHaveProperty('specialtyId'));
  });

  it('clears the filter from All', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-specialty-SP-1')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-specialty-SP-1'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('discover-specialty-all'));
    });

    await waitFor(() => expect(lastParams(search)).not.toHaveProperty('specialtyId'));
  });
});

describe('recently viewed shows only while browsing (G-10, audit R-8)', () => {
  it('does not appear when nothing has been viewed', async () => {
    stubService();
    const view = renderDiscover();

    await waitFor(() => expect(view.getByTestId('discover-search')).toBeTruthy());
    expect(view.queryByTestId('discover-recent')).toBeNull();
  });

  it('appears once a doctor has been viewed', async () => {
    recordDoctorView(doctor('DR-9', 'Nadia Fahmy', 'Neurology'));
    stubService();
    const view = renderDiscover();

    await waitFor(() => expect(view.getByTestId('discover-recent')).toBeTruthy());
    expect(view.getByTestId('discover-recent-DR-9')).toBeTruthy();
    expect(view.getByText('Dr Nadia Fahmy')).toBeTruthy();
  });

  it('hides while a search is running', async () => {
    // Which specialists this patient looked at is an inference about
    // their health, and it must not sit beside the answer they just
    // asked for.
    recordDoctorView(doctor('DR-9', 'Nadia Fahmy'));
    stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-recent')).toBeTruthy());

    fireEvent.changeText(view.getByTestId('discover-search'), 'nadia');
    await act(async () => {
      jest.advanceTimersByTime(400);
    });

    expect(view.queryByTestId('discover-recent')).toBeNull();
  });

  it('hides while a specialty filter is on', async () => {
    recordDoctorView(doctor('DR-9', 'Nadia Fahmy'));
    stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-recent')).toBeTruthy());
    // The chips arrive on their own query, after the recent list.
    await waitFor(() => expect(view.getByTestId('discover-specialty-SP-1')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-specialty-SP-1'));
    });

    expect(view.queryByTestId('discover-recent')).toBeNull();
  });

  it('opens a recently viewed doctor by id', async () => {
    recordDoctorView(doctor('DR-9', 'Nadia Fahmy'));
    stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-recent-DR-9')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-recent-DR-9'));
    });

    await waitFor(() => expect(view.getByTestId('doctor-profile-stub')).toBeTruthy());
  });
});
