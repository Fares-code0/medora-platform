import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import type { DiscoverStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import type { DoctorSearchParams, DoctorSearchResult, PatientSafeDoctor } from './model/types';
import { DiscoverScreen } from './screens/DiscoverScreen';
import { doctorService } from './service';

/**
 * Paging the doctor list — checklist G-02.
 *
 * The data layer has been able to ask for page two since BE-04 landed;
 * the screen could not. These are the four things that had to become
 * true for the row to close: a control exists, it accumulates rather
 * than replaces, it stops when the server says there is no more, and it
 * does not turn the whole list back into a skeleton while it works.
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

const PAGE_ONE = [doctor('DR-1', 'Layla Haddad'), doctor('DR-2', 'Omar Nasser')];
const PAGE_TWO = [doctor('DR-3', 'Sara Khoury')];

const installed: { mockRestore: () => void }[] = [];

function stubSearch(pages: readonly DoctorSearchResult[]) {
  const spy = jest
    .spyOn(doctorService, 'search')
    .mockImplementation((params: DoctorSearchParams) => {
      const page = pages[(params.page ?? 1) - 1];
      return Promise.resolve(page ?? { items: [], totalItems: 0, hasMore: false });
    });
  installed.push(spy);
  return spy;
}

function stubSpecialties() {
  const spy = jest.spyOn(doctorService, 'listSpecialties').mockResolvedValue([]);
  installed.push(spy);
  return spy;
}

/**
 * A real navigator, as `booking.test.tsx` does.
 *
 * `DiscoverScreen` reads "recently viewed" through `useFocusEffect`
 * (G-10), which needs a navigation context — a hand-rolled `navigation`
 * prop is not enough, and stubbing the hook would take the focus
 * behaviour out of the test along with it.
 */
const Stack = createNativeStackNavigator<DiscoverStackParamList>();

function DoctorProfileStub() {
  return <RNText testID="doctor-profile-stub">profile</RNText>;
}
function ClinicStub() {
  return <RNText testID="clinic-stub">clinic</RNText>;
}

function renderDiscover() {
  stubSpecialties();
  return renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="DiscoverRoot" component={DiscoverScreen} />
        <Stack.Screen name="DoctorProfile" component={DoctorProfileStub} />
        <Stack.Screen name="Clinic" component={ClinicStub} />
      </Stack.Navigator>
    </NavigationContainer>,
  );
}

afterEach(() => {
  while (installed.length > 0) installed.pop()?.mockRestore();
});

describe('asking for the second page', () => {
  it('offers the control only while the server says there is more', async () => {
    stubSearch([{ items: PAGE_ONE, totalItems: 3, hasMore: true }]);
    const { findByTestId } = renderDiscover();

    expect(await findByTestId('discover-load-more')).toBeTruthy();
  });

  it('offers nothing to press when the first page is the last one', async () => {
    stubSearch([{ items: PAGE_ONE, totalItems: 2, hasMore: false }]);
    const { findByTestId, queryByTestId } = renderDiscover();

    await findByTestId('doctor-card-DR-1');
    expect(queryByTestId('discover-load-more')).toBeNull();
    // And no end-of-list note either: on a single page it is noise.
    expect(queryByTestId('discover-doctors-end')).toBeNull();
  });

  it('adds the next page to the list rather than replacing it', async () => {
    // The failure this guards against is a page cursor in screen state:
    // a patient who scrolled twenty results and asked for more expects
    // twenty-one, not a fresh screen showing rows 21–40.
    stubSearch([
      { items: PAGE_ONE, totalItems: 3, hasMore: true },
      { items: PAGE_TWO, totalItems: 3, hasMore: false },
    ]);
    const { findByTestId, getByTestId } = renderDiscover();

    fireEvent.press(await findByTestId('discover-load-more'));

    expect(await findByTestId('doctor-card-DR-3')).toBeTruthy();
    expect(getByTestId('doctor-card-DR-1')).toBeTruthy();
    expect(getByTestId('doctor-card-DR-2')).toBeTruthy();
  });

  it('sends the page number the server asked to be sent next', async () => {
    const search = stubSearch([
      { items: PAGE_ONE, totalItems: 3, hasMore: true },
      { items: PAGE_TWO, totalItems: 3, hasMore: false },
    ]);
    const { findByTestId } = renderDiscover();

    fireEvent.press(await findByTestId('discover-load-more'));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ page: 2 }));
  });

  it('stops offering more, and says so, once the last page is in', async () => {
    stubSearch([
      { items: PAGE_ONE, totalItems: 3, hasMore: true },
      { items: PAGE_TWO, totalItems: 3, hasMore: false },
    ]);
    const { findByTestId, queryByTestId } = renderDiscover();

    fireEvent.press(await findByTestId('discover-load-more'));
    await findByTestId('doctor-card-DR-3');

    await waitFor(() => expect(queryByTestId('discover-load-more')).toBeNull());
    expect(await findByTestId('discover-doctors-end')).toBeTruthy();
  });

  it('keeps the results on screen while the next page loads', async () => {
    // `AsyncBoundary` replaces the list with a skeleton in the pending
    // state. Paging must not re-enter it — a patient reading row four
    // should not have it vanish because they asked for row twenty-one.
    let releasePageTwo!: (result: DoctorSearchResult) => void;
    jest.spyOn(doctorService, 'listSpecialties').mockResolvedValue([]);
    const search = jest
      .spyOn(doctorService, 'search')
      .mockImplementation((params: DoctorSearchParams) => {
        if ((params.page ?? 1) === 1) {
          return Promise.resolve({ items: PAGE_ONE, totalItems: 3, hasMore: true });
        }
        return new Promise<DoctorSearchResult>((resolve) => {
          releasePageTwo = resolve;
        });
      });
    installed.push(search);

    const { findByTestId, getByTestId } = renderDiscover();
    fireEvent.press(await findByTestId('discover-load-more'));

    // Still there, with a skeleton BELOW them rather than over them.
    //
    // `includeHiddenElements` because a skeleton is hidden from assistive
    // technology on purpose — announcing a placeholder is announcing
    // nothing. That it has to be asked for here is the evidence.
    expect(getByTestId('doctor-card-DR-1')).toBeTruthy();
    expect(
      await findByTestId('discover-doctors-loading-more', { includeHiddenElements: true }),
    ).toBeTruthy();

    releasePageTwo({ items: PAGE_TWO, totalItems: 3, hasMore: false });
    expect(await findByTestId('doctor-card-DR-3')).toBeTruthy();
  });

  it('does not repeat a doctor that shifted between pages', async () => {
    // Page-number paging is a window onto a list that can move. A doctor
    // added between the two requests pushes the last row of page one
    // into page two, and two children with the same key is a rendering
    // bug rather than a cosmetic one.
    stubSearch([
      { items: PAGE_ONE, totalItems: 3, hasMore: true },
      { items: [doctor('DR-2', 'Omar Nasser'), ...PAGE_TWO], totalItems: 3, hasMore: false },
    ]);
    const { findByTestId, getAllByTestId } = renderDiscover();

    fireEvent.press(await findByTestId('discover-load-more'));
    await findByTestId('doctor-card-DR-3');

    expect(getAllByTestId('doctor-card-DR-2')).toHaveLength(1);
  });

  it('starts over at page one when the search changes', async () => {
    // The query key carries the search terms, so a new search is a new
    // infinite query. A patient who filtered to Cardiology must not be
    // looking at page three of the unfiltered roster.
    const search = stubSearch([
      { items: PAGE_ONE, totalItems: 3, hasMore: true },
      { items: PAGE_TWO, totalItems: 3, hasMore: false },
    ]);
    const { findByTestId } = renderDiscover();

    fireEvent.press(await findByTestId('discover-load-more'));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));

    fireEvent.changeText(await findByTestId('discover-search'), 'khoury');

    await waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    expect(search.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ page: 1, q: 'khoury' }));
  });
});
