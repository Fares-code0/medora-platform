import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import type { DoctorSearchParams, PatientSafeDoctor } from '@/features/doctors/model/types';
import { doctorService } from '@/features/doctors/service';
import type { DiscoverStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import { DepartmentScreen } from './screens/DepartmentScreen';

/**
 * The doctors in one department — checklist H-05.
 *
 * The list is **live**: `GET /patient/doctors?departmentId=…` is BE-04
 * and has been served since the patient-facing projection landed. So the
 * assertion that matters is the same one Discover's is — that the filter
 * reaches the SERVER — plus the two states a patient actually meets: a
 * department with nobody in it, and one with more doctors than a page.
 */

function doctor(id: string, name: string): PatientSafeDoctor {
  return {
    id,
    fullName: name,
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
}

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

const Stack = createNativeStackNavigator<DiscoverStackParamList>();

function renderDepartment(params: DiscoverStackParamList['Department']) {
  return renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Department">
        <Stack.Screen name="Department" component={DepartmentScreen} initialParams={params} />
        <Stack.Screen name="DoctorProfile">
          {({ route }) => <RNText testID="doctor-profile-stub">{route.params.doctorId}</RNText>}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

const PARAMS = {
  departmentId: 'DP-1',
  departmentName: 'Cardiology',
  description: 'Heart and circulation.',
};

function lastParams(search: jest.SpyInstance): DoctorSearchParams {
  return (search.mock.calls.at(-1)?.[0] ?? {}) as DoctorSearchParams;
}

describe('the department screen', () => {
  it('asks the server for that department, and renders what comes back', async () => {
    const search = jest.spyOn(doctorService, 'search').mockResolvedValue({
      items: [doctor('DR-1', 'Layla Haddad')],
      totalItems: 1,
      hasMore: false,
    });
    installed.push(search);

    const view = renderDepartment(PARAMS);

    expect(await view.findByTestId('doctor-card-DR-1')).toBeTruthy();
    // Filtered on the server. Pulling the roster and narrowing it here
    // is the client-side filtering G-05 refuses.
    expect(lastParams(search).departmentId).toBe('DP-1');
  });

  it('names the department and shows the description it was given', async () => {
    installed.push(
      jest.spyOn(doctorService, 'search').mockResolvedValue({
        items: [doctor('DR-1', 'Layla Haddad')],
        totalItems: 1,
        hasMore: false,
      }),
    );

    const view = renderDepartment(PARAMS);

    expect(await view.findByText('Cardiology')).toBeTruthy();
    expect(view.getByTestId('department-description')).toBeTruthy();
  });

  it('renders no description block when the department has none', async () => {
    installed.push(
      jest.spyOn(doctorService, 'search').mockResolvedValue({
        items: [doctor('DR-1', 'Layla Haddad')],
        totalItems: 1,
        hasMore: false,
      }),
    );

    const view = renderDepartment({ ...PARAMS, description: null });

    await view.findByTestId('doctor-card-DR-1');
    // A blank card is a bug on screen; no card is an answer.
    expect(view.queryByTestId('department-description')).toBeNull();
  });

  it('says the department is empty rather than implying a failed search', async () => {
    installed.push(
      jest
        .spyOn(doctorService, 'search')
        .mockResolvedValue({ items: [], totalItems: 0, hasMore: false }),
    );

    const view = renderDepartment(PARAMS);

    // Nothing was searched for, so "try a different name" would be
    // advice about a mistake the patient did not make.
    expect(await view.findByText('No doctors listed here yet')).toBeTruthy();
  });

  it('pages with a button, and keeps the results on screen while page two loads', async () => {
    const search = jest
      .spyOn(doctorService, 'search')
      .mockImplementation(async (params: DoctorSearchParams) =>
        (params.page ?? 1) === 1
          ? { items: [doctor('DR-1', 'Layla Haddad')], totalItems: 2, hasMore: true }
          : { items: [doctor('DR-2', 'Omar Nasser')], totalItems: 2, hasMore: false },
      );
    installed.push(search);

    const view = renderDepartment(PARAMS);
    const more = await view.findByTestId('department-load-more');

    await act(async () => {
      fireEvent.press(more);
    });

    await waitFor(() => expect(view.getByTestId('doctor-card-DR-2')).toBeTruthy());
    // The first page is still there: paging must not re-enter the
    // boundary's pending state and replace what is being read.
    expect(view.getByTestId('doctor-card-DR-1')).toBeTruthy();
  });

  it('opens a doctor from the list', async () => {
    installed.push(
      jest.spyOn(doctorService, 'search').mockResolvedValue({
        items: [doctor('DR-7', 'Nadia Karim')],
        totalItems: 1,
        hasMore: false,
      }),
    );

    const view = renderDepartment(PARAMS);

    await act(async () => {
      fireEvent.press(await view.findByTestId('doctor-card-DR-7'));
    });

    expect(await view.findByTestId('doctor-profile-stub')).toBeTruthy();
    expect(view.getByTestId('doctor-profile-stub').props.children).toBe('DR-7');
  });

  it('offers a retry when the list fails', async () => {
    installed.push(
      jest
        .spyOn(doctorService, 'search')
        .mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' })),
    );

    const view = renderDepartment(PARAMS);

    expect(await view.findByText("You're offline")).toBeTruthy();
    // Retryable, and offered: a network failure is the one kind a
    // patient can do something about.
    expect(view.getByTestId('department-doctors-error-retry')).toBeTruthy();
  });
});
