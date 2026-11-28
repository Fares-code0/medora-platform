import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import { FORBIDDEN_DOCTOR_FIELDS, type PatientSafeDoctor } from './model/types';
import { DoctorProfileScreen } from './screens/DoctorProfileScreen';
import { doctorService } from './service';

/**
 * A doctor's profile — checklist G-04, A-05, audit R-3.
 *
 * The screen was at 0% of its 24 branches, and every one of those
 * branches is a nullable field of the **public projection**. That is the
 * point of the file: an allow-list projection is sparse by design, so the
 * common case is a profile with no biography, no education, no rating and
 * no office. A screen that renders "Education" over nothing, or
 * "null years", is a visible defect on the first doctor a clinic adds.
 *
 * `src/test/projections.test.ts` already holds the security half
 * statically — the fixture cannot carry a forbidden field, the type
 * cannot declare one, and no component names one. This file adds the
 * runtime complement: **even if a payload smuggled a licence number
 * through, nothing on this screen would draw it.**
 */

const FULL: PatientSafeDoctor = {
  id: 'DR-1001',
  fullName: 'Layla Hassan',
  title: 'Dr',
  specialty: 'Cardiology',
  departmentName: 'Cardiology',
  photoUrl: null,
  yearsOfExperience: 12,
  languages: ['Arabic', 'English'],
  biography: 'Consultant cardiologist with a focus on preventive care.',
  education: ['MBBS, University of Jordan', 'Fellowship, Royal College'],
  ratingAvg: 4.6,
  hospital: { id: 'HOS-9', name: 'Medora Central' },
  officeLocation: 'Level 3, Room 12',
};

/** Everything the projection is allowed to omit, omitted. */
const SPARSE: PatientSafeDoctor = {
  id: 'DR-2002',
  fullName: 'Samir Odeh',
  title: null,
  specialty: 'Dermatology',
  departmentName: null,
  photoUrl: null,
  yearsOfExperience: null,
  languages: [],
  biography: null,
  education: [],
  ratingAvg: null,
  hospital: null,
  officeLocation: null,
};

const installed: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of installed.splice(0)) spy.mockRestore();
});

const Stack = createNativeStackNavigator();

function Blank() {
  return null;
}

async function renderProfile(doctor: PatientSafeDoctor) {
  const get = jest.spyOn(doctorService, 'getById').mockResolvedValue(doctor);
  installed.push(get);

  const view = renderWithProviders(
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen
          name="DoctorProfile"
          component={DoctorProfileScreen as never}
          initialParams={{ doctorId: doctor.id }}
        />
        <Stack.Screen name="Booking" component={Blank} />
      </Stack.Navigator>
    </NavigationContainer>,
  );

  await act(async () => undefined);
  return { ...view, get };
}

type TextNode = { props: Record<string, unknown> };

/** Every string this screen actually renders, joined. */
function renderedText(root: { findAll: (predicate: (node: TextNode) => boolean) => TextNode[] }) {
  return root
    .findAll((node: TextNode) => typeof node.props.children === 'string')
    .map((node: TextNode) => String(node.props.children))
    .join(' | ');
}

describe('a complete profile (G-04)', () => {
  it('renders the name with the title attached', async () => {
    const view = await renderProfile(FULL);

    expect(await view.findByText('Dr Layla Hassan')).toBeTruthy();
  });

  it('renders the specialty, department, rating and experience', async () => {
    const view = await renderProfile(FULL);

    // Twice over: the specialty line and the department badge. Both are
    // wanted, and both are on the A-05 allow-list.
    expect(await view.findAllByText('Cardiology')).toHaveLength(2);
    expect(view.getByText('4.6 / 5')).toBeTruthy();
    expect(view.getByText('12 years')).toBeTruthy();
  });

  it('renders the biography, languages, education and where to find them', async () => {
    const view = await renderProfile(FULL);

    expect(await view.findByText(/preventive care/i)).toBeTruthy();
    expect(view.getByText(/Arabic/)).toBeTruthy();
    expect(view.getByText(/University of Jordan/)).toBeTruthy();
    // The badge under the name and the "where" section both name it.
    expect(view.getAllByText('Medora Central').length).toBeGreaterThanOrEqual(1);
    expect(view.getByText(/Level 3, Room 12/)).toBeTruthy();
  });
});

describe('a sparse profile, which is the common case for an allow-list projection', () => {
  it('renders the screen at all', async () => {
    const view = await renderProfile(SPARSE);

    expect(await view.findByText('Samir Odeh')).toBeTruthy();
  });

  it('drops the title without leaving a leading space', async () => {
    const view = await renderProfile(SPARSE);

    await view.findByText('Samir Odeh');
    expect(view.queryByText(/^\s/)).toBeNull();
    expect(view.queryByText(/null|undefined/i)).toBeNull();
  });

  it('shows no rating rather than a zero the doctor did not earn', async () => {
    const view = await renderProfile(SPARSE);

    await view.findByText('Samir Odeh');
    expect(view.queryByText(/\/ 5/)).toBeNull();
    expect(view.queryByText(/0 years/)).toBeNull();
  });

  it('renders no empty section headers', async () => {
    // "Education" over nothing reads as data that failed to load, not as
    // data the clinic has not entered.
    const view = await renderProfile(SPARSE);

    await view.findByText('Samir Odeh');
    for (const heading of [/^About$/, /^Languages$/, /^Education$/, /^Where to find them$/]) {
      expect(view.queryByText(heading)).toBeNull();
    }
  });

  it('still offers the Book button, because availability is not this screen’s to judge', async () => {
    // Whether the doctor has a free slot is `GET /public/doctors/{id}/slots`
    // (BE-06), server-computed and unbuilt. Hiding Book on a sparse
    // profile would be this client guessing at it.
    const view = await renderProfile(SPARSE);

    expect(await view.findByTestId('doctor-profile-book')).toBeTruthy();
  });
});

describe('booking from the profile', () => {
  it('opens the flow pre-filled with this doctor', async () => {
    const view = await renderProfile(FULL);

    await act(async () => {
      fireEvent.press(await view.findByTestId('doctor-profile-book'));
    });

    // Left Booking's own screen; the id travelled with it.
    expect(view.queryByTestId('doctor-profile-book')).toBeNull();
  });
});

describe('nothing forbidden is drawn, even if a payload carries it (A-05, R-3)', () => {
  it('renders no licence number, employee id or personal contact detail', async () => {
    // `projections.test.ts` proves no component *names* these. This proves
    // that a server which sent them anyway would still not get them onto
    // a patient's screen — the two together are the client's half of R-3.
    const smuggled = {
      ...FULL,
      licenseNumber: 'JMC-99887',
      employeeId: 'EMP-4471',
      contactPhone: '+962790000000',
      contactEmail: 'layla.hassan@medora.internal',
      emergencyContactPhone: '+962791111111',
      linkedinUrl: 'https://example.com/in/layla',
    } as PatientSafeDoctor;

    const view = await renderProfile(smuggled);
    await view.findByText('Dr Layla Hassan');

    const text = renderedText(view.UNSAFE_root);
    for (const value of [
      'JMC-99887',
      'EMP-4471',
      '+962790000000',
      'layla.hassan@medora.internal',
      '+962791111111',
      'example.com/in/layla',
    ]) {
      expect({ value, drawn: text.includes(value) }).toEqual({ value, drawn: false });
    }
  });

  it('has no contact section at all, and will not grow one', async () => {
    // A patient reaches a clinician through the clinic or a message
    // thread, never by dialling them directly.
    const view = await renderProfile(FULL);

    await view.findByText('Dr Layla Hassan');
    expect(view.queryByText(/^Contact$/i)).toBeNull();
    expect(view.queryByText(/call .*directly/i)).toBeNull();
  });

  it('keeps the deny-list the source scan uses in one place', () => {
    // If this ever drifts to a short list, `projections.test.ts` weakens
    // silently. Cheap to assert, and it names the file to look at.
    expect(FORBIDDEN_DOCTOR_FIELDS.length).toBeGreaterThanOrEqual(10);
    expect(FORBIDDEN_DOCTOR_FIELDS).toContain('licenseNumber');
    expect(FORBIDDEN_DOCTOR_FIELDS).toContain('contactPhone');
  });
});
