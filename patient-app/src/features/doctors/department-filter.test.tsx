import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { EndpointNotImplementedError } from '@/api/seam';
import type { DiscoverStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import type { Department, DoctorSearchParams, PatientSafeDoctor, Specialty } from './model/types';
import { clearRecentDoctors, recordDoctorView } from './recent';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { doctorService } from './service';

/**
 * Filtering by department — checklist G-07.
 *
 * Two claims, and the second is the one worth having tests for.
 *
 * **The filter reaches the server.** `departmentId` goes on the request
 * beside `q` and `specialtyId`; nothing is narrowed on the phone (G-05).
 *
 * **Its absence breaks nothing.** `GET /patient/departments` is not
 * built (M23), so the list refuses in every production build today. The
 * screen it sits on is a working search, and a filter that cannot load
 * must not take that down with it — no error card, no empty row, and
 * `search` still called.
 */

function doctor(id: string, name: string): PatientSafeDoctor {
  return {
    id,
    fullName: name,
    title: 'Dr',
    specialty: 'Cardiology',
    departmentName: 'Cardiology',
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

const SPECIALTIES: Specialty[] = [{ id: 'SP-1', name: 'Cardiology' }];
const DEPARTMENTS: Department[] = [
  { id: 'DP-1', name: 'Cardiology', description: 'Heart and circulation.' },
  { id: 'DP-2', name: 'Paediatrics', description: null },
];

const installed: { mockRestore: () => void }[] = [];

function stubService(departments: Department[] | Error = DEPARTMENTS) {
  const search = jest.spyOn(doctorService, 'search').mockResolvedValue({
    items: [doctor('DR-1', 'Layla Haddad')],
    totalItems: 1,
    hasMore: false,
  });
  const specialties = jest.spyOn(doctorService, 'listSpecialties').mockResolvedValue(SPECIALTIES);
  const list = jest.spyOn(doctorService, 'listDepartments');
  if (departments instanceof Error) list.mockRejectedValue(departments);
  else list.mockResolvedValue(departments);
  installed.push(search, specialties, list);
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

function lastParams(search: jest.SpyInstance): DoctorSearchParams {
  return (search.mock.calls.at(-1)?.[0] ?? {}) as DoctorSearchParams;
}

beforeEach(() => {
  clearRecentDoctors();
});

afterEach(() => {
  while (installed.length > 0) installed.pop()?.mockRestore();
  clearRecentDoctors();
});

describe('the department chips come from the server (G-07)', () => {
  it('renders one chip per department, plus Any department', async () => {
    stubService();
    const view = renderDiscover();

    await waitFor(() => expect(view.getByTestId('discover-department-DP-1')).toBeTruthy());
    expect(view.getByTestId('discover-department-DP-2')).toBeTruthy();
    expect(view.getByTestId('discover-department-all')).toBeTruthy();
  });

  it('labels both chip rows, because two unlabelled rows are ambiguous', async () => {
    stubService();
    const view = renderDiscover();

    // `Cardiology` is a specialty AND a department in this fixture,
    // which is the ordinary case rather than a contrived one.
    await waitFor(() => expect(view.getByText('Department')).toBeTruthy());
    expect(view.getByText('Specialty')).toBeTruthy();
  });

  it('sends the chosen department to the server', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-department-DP-2')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-department-DP-2'));
    });

    await waitFor(() => expect(lastParams(search).departmentId).toBe('DP-2'));
  });

  it('combines with the specialty filter on one request', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-department-DP-1')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-specialty-SP-1'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('discover-department-DP-1'));
    });

    // Both on the same request. Narrowing the first result set in JS
    // would be the client-side filtering G-05 refuses.
    await waitFor(() => {
      expect(lastParams(search)).toMatchObject({ specialtyId: 'SP-1', departmentId: 'DP-1' });
    });
  });

  it('un-selects on a second tap, rather than needing Any department', async () => {
    const { search } = stubService();
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-department-DP-2')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-department-DP-2'));
    });
    await waitFor(() => expect(lastParams(search).departmentId).toBe('DP-2'));

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-department-DP-2'));
    });

    await waitFor(() => expect(lastParams(search)).not.toHaveProperty('departmentId'));
  });

  it('hides Recently viewed while a department filter is on', async () => {
    stubService();
    recordDoctorView(doctor('DR-9', 'Omar Nasser'));
    const view = renderDiscover();
    await waitFor(() => expect(view.getByTestId('discover-department-DP-1')).toBeTruthy());
    expect(view.getByTestId('discover-recent')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId('discover-department-DP-1'));
    });

    // Which specialists this patient looked at is an inference about
    // their health, and a filtered result is an answer someone may be
    // reading over their shoulder.
    await waitFor(() => expect(view.queryByTestId('discover-recent')).toBeNull());
  });
});

describe('when the list cannot be read (M23, today)', () => {
  it('renders nothing at all, rather than an error on a working search', async () => {
    const { search } = stubService(
      new EndpointNotImplementedError('BE-11 / M23', 'capability.departments'),
    );
    const view = renderDiscover();

    await waitFor(() => expect(view.getByTestId('doctor-card-DR-1')).toBeTruthy());

    expect(view.queryByTestId('discover-department-filter')).toBeNull();
    expect(view.queryByText('Department')).toBeNull();
    // The claim that matters: the search the patient came for still ran,
    // and ran unfiltered.
    expect(search).toHaveBeenCalled();
    expect(lastParams(search)).not.toHaveProperty('departmentId');
  });

  it('renders nothing for an empty list either', async () => {
    stubService([]);
    const view = renderDiscover();

    await waitFor(() => expect(view.getByTestId('doctor-card-DR-1')).toBeTruthy());

    // A clinic with no departments has nothing to filter by, and a row
    // holding only "Any department" is a control that does nothing.
    expect(view.queryByTestId('discover-department-filter')).toBeNull();
  });
});
