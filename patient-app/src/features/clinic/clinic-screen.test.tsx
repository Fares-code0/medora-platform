import fs from 'node:fs';
import path from 'node:path';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking, Text as RNText } from 'react-native';

import { doctorService } from '@/features/doctors/service';
import type { DiscoverStackParamList } from '@/navigation/routes';
import { renderWithProviders } from '@/test/render';

import type { ClinicProfile, Holiday, OpeningDay } from './model/types';
import { ClinicScreen } from './screens/ClinicScreen';
import { clinicService } from './service';

/**
 * Our Clinic — checklist H-01, H-02, H-03, H-04, Q-02, Q-03.
 *
 * `features/clinic` was the fourth-thinnest area in `docs/COVERAGE.md`
 * §2 at 26.9%, and three of its four rows wait on BE-11. But the two
 * hand-offs on this screen are **frontend only** and always were, and
 * they are the parts that leave the app:
 *
 * - **`tel:`** goes through the same `dial()` every other number in this
 *   app goes through, and `dial()` refuses a value that is not a phone
 *   number. The clinic phone is operator configuration, so it is
 *   untrusted input: a settings row that arrived as `sms:` or a deep link
 *   must not become a tap target.
 * - **maps** is built from the address STRING, not from coordinates.
 *   There are no geo columns anywhere in the schema, and no location
 *   permission is involved — which is what makes Q-02's "denying location
 *   degrades nothing" true by construction rather than by hope.
 */

const CLINIC: ClinicProfile = {
  name: 'Medora Central',
  addressLine: '22 Rainbow Street',
  city: 'Amman',
  country: 'Jordan',
  phone: '+962 6 400 0000',
  website: 'https://example.org',
};

const day = (overrides: Partial<OpeningDay> & Pick<OpeningDay, 'weekday'>): OpeningDay => ({
  opensAt: '08:00',
  closesAt: '17:00',
  closed: false,
  ...overrides,
});

const holiday = (overrides: Partial<Holiday> & Pick<Holiday, 'id'>): Holiday => ({
  name: 'Eid al-Fitr',
  date: '2027-03-20',
  ...overrides,
});

const Stack = createNativeStackNavigator<DiscoverStackParamList>();

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

async function renderClinic(
  options: {
    profile?: ClinicProfile;
    hours?: readonly OpeningDay[];
    departments?: readonly { id: string; name: string; description: string | null }[];
    holidays?: readonly Holiday[];
  } = {},
) {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const spies = [
    openURL,
    jest.spyOn(clinicService, 'getProfile').mockResolvedValue(options.profile ?? CLINIC),
    jest.spyOn(clinicService, 'getOpeningHours').mockResolvedValue(options.hours ?? []),
    // Stubbed even when a test does not care: without it the real fixture
    // adapter answers, and a test asserting "no closures published" would
    // be reading the fixture's two rows instead of its own empty list.
    jest.spyOn(clinicService, 'getHolidays').mockResolvedValue(options.holidays ?? []),
    jest.spyOn(doctorService, 'listDepartments').mockResolvedValue(options.departments ?? []),
  ];
  installed.push(...spies);

  const view = renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Clinic">
        <Stack.Screen name="Clinic" component={ClinicScreen} />
        {/*
          A real navigator rather than a bare render since H-05: the
          department rows push a route, and a stub screen is how this
          file asserts they pushed the right one without pulling the
          department screen's own tests in here.
        */}
        <Stack.Screen name="Department">
          {({ route }) => <RNText testID="department-stub">{route.params.departmentId}</RNText>}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>,
  );
  await act(async () => undefined);
  // The three boundaries settle independently. Waiting on the clinic name
  // waits on the one that gates the address and both hand-offs; the
  // assertions below use `findBy*` for the other two.
  await waitFor(() => expect(view.getByText((options.profile ?? CLINIC).name)).toBeTruthy());
  return { ...view, openURL };
}

describe('the address and the two hand-offs (H-01, H-02, Q-03)', () => {
  it('joins the address parts it was given and skips the ones it was not', async () => {
    const view = await renderClinic();

    expect(await view.findByText('22 Rainbow Street, Amman, Jordan')).toBeTruthy();
  });

  it('leaves out a missing city or country rather than showing a stray comma', async () => {
    const view = await renderClinic({
      profile: { ...CLINIC, city: null, country: null },
    });

    expect(await view.findByText('22 Rainbow Street')).toBeTruthy();
    expect(view.queryByText(/, ,|,\s*$/)).toBeNull();
  });

  it('dials through `tel:`, with the spaces stripped', async () => {
    const view = await renderClinic();

    await act(async () => {
      fireEvent.press(view.getByTestId('clinic-call'));
    });

    expect(view.openURL).toHaveBeenCalledWith('tel:+96264000000');
  });

  it('refuses a configured "phone" that is not a phone number', async () => {
    // The number is operator configuration and therefore untrusted.
    // `Linking.openURL` will happily open whatever scheme it is handed,
    // so a settings row containing a deep link must not become one.
    const view = await renderClinic({
      profile: { ...CLINIC, phone: 'sms:+962790000000?body=hi' },
    });

    await act(async () => {
      fireEvent.press(view.getByTestId('clinic-call'));
    });

    expect(view.openURL).not.toHaveBeenCalled();
  });

  it('offers no Call button at all when the clinic published no number', async () => {
    // BE-11 has not landed, so an unconfigured clinic is the current
    // state of the world. A button that dialled nothing would be worse
    // than no button.
    const view = await renderClinic({ profile: { ...CLINIC, phone: null } });

    expect(view.queryByTestId('clinic-call')).toBeNull();
  });

  it('opens maps from the address string, never from coordinates', async () => {
    const view = await renderClinic();

    await act(async () => {
      fireEvent.press(view.getByTestId('clinic-map'));
    });

    const url = String(view.openURL.mock.calls[0]?.[0]);
    expect(url).toContain(encodeURIComponent('22 Rainbow Street'));
    // No geo columns exist anywhere in the schema; a lat/long here would
    // be invented data.
    expect(url).not.toMatch(/geo:-?\d+\.\d+,-?\d+\.\d+/);
    expect(url).not.toMatch(/\bll=|\blatitude=|\blongitude=/);
  });

  it('never asks for a location permission to do it (Q-02, Q-04)', () => {
    // The whole point: this screen works identically with location
    // denied, because it never involves location at all. Asserted at the
    // source, because "no permission was requested" is an absence and a
    // render cannot show one.
    const source = fs.readFileSync(path.join(__dirname, 'screens', 'ClinicScreen.tsx'), 'utf8');

    expect(source).not.toMatch(/expo-location|requestForegroundPermissions|getCurrentPosition/);
  });
});

describe('opening hours (H-04)', () => {
  it('renders a day the clinic is open with its window', async () => {
    const view = await renderClinic({
      hours: [day({ weekday: 'monday', opensAt: '08:00', closesAt: '17:00' })],
    });

    expect(await view.findByText('Monday')).toBeTruthy();
    expect(view.getByText('08:00 – 17:00')).toBeTruthy();
  });

  it('says Closed rather than a blank window', async () => {
    const view = await renderClinic({
      hours: [day({ weekday: 'friday', closed: true, opensAt: null, closesAt: null })],
    });

    expect(await view.findByText('Friday')).toBeTruthy();
    expect(view.getByText('Closed')).toBeTruthy();
  });

  it('says Closed for a day with no times, even if the flag was not set', async () => {
    // A half-configured row is more likely than a well-formed one while
    // BE-11 is unbuilt, and "08:00 – null" is the wrong answer to it.
    const view = await renderClinic({
      hours: [day({ weekday: 'saturday', closed: false, opensAt: null, closesAt: null })],
    });

    expect(await view.findByText('Closed')).toBeTruthy();
    expect(view.queryByText(/null|undefined/i)).toBeNull();
  });

  it('falls back to the server’s own word for a weekday it has no translation for', async () => {
    // `OpeningDay.weekday` is typed `string` because it is the backend's
    // enum value and this client does not redeclare it. An unrecognised
    // one — a locale-specific day, a renamed enum member, a
    // half-configured row while BE-11 is unbuilt — renders capitalised
    // rather than blank or guessed. Blank is the failure: a row with a
    // time window and no day is worse than a day nobody translated.
    const view = await renderClinic({
      hours: [day({ weekday: 'yawm-al-jumua', opensAt: '08:00', closesAt: '12:00' })],
    });

    expect(await view.findByText('Yawm-al-jumua')).toBeTruthy();
    expect(view.getByText('08:00 – 12:00')).toBeTruthy();
  });

  it('answers an unpublished schedule with words rather than an empty box', async () => {
    const view = await renderClinic({ hours: [] });

    expect(await view.findByText('Opening hours are not published')).toBeTruthy();
    expect(view.getByText(/Call the clinic to check/i)).toBeTruthy();
  });
});

describe('departments (H-03)', () => {
  it('lists them with their descriptions', async () => {
    const view = await renderClinic({
      departments: [{ id: 'DP-1', name: 'Cardiology', description: 'Heart and vascular care' }],
    });

    expect(await view.findByText('Cardiology')).toBeTruthy();
    expect(view.getByText('Heart and vascular care')).toBeTruthy();
  });

  it('renders a department with no description without a blank subtitle', async () => {
    const view = await renderClinic({
      departments: [{ id: 'DP-1', name: 'Cardiology', description: null }],
    });

    expect(await view.findByText('Cardiology')).toBeTruthy();
    expect(view.queryByText(/null|undefined/i)).toBeNull();
  });

  it('opens the department it names, carrying the name with the id (H-05)', async () => {
    const view = await renderClinic({
      departments: [{ id: 'DP-9', name: 'Cardiology', description: 'Heart and circulation.' }],
    });

    await act(async () => {
      fireEvent.press(await view.findByTestId('clinic-department-DP-9'));
    });

    // The id is what the doctor search is filtered by; the name is what
    // the header says, and there is no endpoint to look it up with.
    expect(await view.findByTestId('department-stub')).toBeTruthy();
    expect(view.getByTestId('department-stub').props.children).toBe('DP-9');
  });

  it('says none are listed rather than showing an empty card', async () => {
    const view = await renderClinic({ departments: [] });

    expect(await view.findByText('No departments listed')).toBeTruthy();
  });
});

describe('what this screen says it is not', () => {
  it('states that Medora serves one clinic, so a patient stops looking for a switcher', async () => {
    const view = await renderClinic();

    expect(view.getByText(/Medora serves one clinic/i)).toBeTruthy();
    expect(view.getByText(/showing distance to them, is not part of this version/i)).toBeTruthy();
  });
});

/**
 * The website — checklist H-01, which names it.
 *
 * The row is "**Our Clinic** screen — name, address, phone, website" and
 * it was ✅-adjacent with three of the four: `ClinicProfile.website` was
 * fetched, typed, and dropped on the floor. The threat model is the phone
 * number's — operator configuration arriving over the network — so the
 * guard is the same one, and it is asserted the same way.
 */
describe('the website hand-off (H-01)', () => {
  it('opens the published website', async () => {
    const view = await renderClinic();

    await act(async () => {
      fireEvent.press(view.getByTestId('clinic-website'));
    });

    expect(view.openURL).toHaveBeenCalledWith('https://example.org');
  });

  it('offers no button when the clinic published no website', async () => {
    const view = await renderClinic({ profile: { ...CLINIC, website: null } });

    expect(view.queryByTestId('clinic-website')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'medora://profile',
    'intent://scan#Intent;scheme=zxing;end',
    'file:///etc/passwd',
    'not a url at all',
  ])('offers no button for a configured "website" of %s', async (website) => {
    // `Linking.openURL` opens whatever scheme it is handed. A settings row
    // that arrived as a deep link must not become a tap target, and the
    // honest response is no button rather than a button that refuses.
    const view = await renderClinic({ profile: { ...CLINIC, website } });

    expect(view.queryByTestId('clinic-website')).toBeNull();
    expect(view.openURL).not.toHaveBeenCalled();
  });

  it('refuses plain http, which a healthcare link should not be', async () => {
    const view = await renderClinic({
      profile: { ...CLINIC, website: 'http://example.org' },
    });

    expect(view.queryByTestId('clinic-website')).toBeNull();
  });
});

type Node = { props: Record<string, unknown> };

/**
 * The closure rows in reading order, each id once.
 *
 * `findAll` sees a `testID` on every host node carrying it and `ListItem`
 * forwards its own down a nesting of views, so a three-row list comes
 * back tripled. A `Set` keeps first occurrence, which is the position on
 * the screen — and keeps this test about sort order rather than about how
 * deeply `ListItem` nests.
 */
function holidayOrder(view: {
  UNSAFE_root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
}): string[] {
  return [
    ...new Set(
      view.UNSAFE_root
        .findAll((node: Node) => typeof node.props.testID === 'string')
        .map((node: Node) => String(node.props.testID))
        .filter((id: string) => id.startsWith('clinic-holiday-')),
    ),
  ];
}

/**
 * Closures — the "& holidays" half of H-04.
 *
 * `clinicService.getHolidays()` was in the port, had a fixture, and no
 * screen called it, so this was missing rather than blocked on BE-11.
 *
 * What is still blocked is the row's other clause — "renders 'closed
 * today' correctly in the clinic timezone". `datetime.ts` records the
 * rule it would break (the client formats, it never computes) and
 * `ClinicProfile` has no timezone to compute it in. The test at the
 * bottom of this block asserts the absence, so the day someone adds the
 * arithmetic they have to argue with a test rather than with a comment.
 */
describe('published closures (H-04)', () => {
  it('lists a closure with its date', async () => {
    const view = await renderClinic({
      holidays: [holiday({ id: 'H-1', name: 'Eid al-Fitr', date: '2027-03-20' })],
    });

    expect(await view.findByText('Eid al-Fitr')).toBeTruthy();
    expect(view.getByText(/2027/)).toBeTruthy();
  });

  it('puts the soonest first whatever order the server sent', async () => {
    const view = await renderClinic({
      holidays: [
        holiday({ id: 'LATE', name: 'Late closure', date: '2027-12-25' }),
        holiday({ id: 'SOON', name: 'Soon closure', date: '2027-01-02' }),
        holiday({ id: 'MID', name: 'Mid closure', date: '2027-06-10' }),
      ],
    });

    await view.findByText('Soon closure');
    const ids = holidayOrder(view);
    expect(ids).toEqual(['clinic-holiday-SOON', 'clinic-holiday-MID', 'clinic-holiday-LATE']);
  });

  it('does not scramble the list when a date cannot be read', async () => {
    const view = await renderClinic({
      holidays: [
        holiday({ id: 'OK2', name: 'Second', date: '2027-06-01' }),
        holiday({ id: 'BAD', name: 'Unreadable', date: 'soon' }),
        holiday({ id: 'OK1', name: 'First', date: '2027-02-01' }),
      ],
    });

    await view.findByText('First');
    const ids = holidayOrder(view);
    // The readable dates keep their order; the unreadable one sorts last
    // rather than making the comparator return NaN, which would let
    // `sort` emit any permutation at all.
    expect(ids).toEqual(['clinic-holiday-OK1', 'clinic-holiday-OK2', 'clinic-holiday-BAD']);
  });

  it('says nothing is published without implying the clinic never closes', async () => {
    // BE-11 has not landed, so this is the current state of the world for
    // every patient. "No closures" would be a promise this client cannot
    // make; the body says so and points at the phone.
    const view = await renderClinic({ holidays: [] });

    expect(await view.findByText('No closures published')).toBeTruthy();
    expect(view.getByText(/does not mean there are none/i)).toBeTruthy();
  });

  it('never decides whether the clinic is closed today (R-12)', () => {
    // "Closed today" is the clinic's timezone applied server-side, and
    // `ClinicProfile` carries no timezone. Computing it from the device
    // clock would give a travelling patient a confident wrong answer, so
    // the absence is asserted at the source: a render cannot show one.
    const source = fs.readFileSync(path.join(__dirname, 'screens', 'ClinicScreen.tsx'), 'utf8');

    expect(source).not.toMatch(/getDay\(\)|getDate\(\)|closedToday|isOpenNow|todayIs/);
  });
});
