import type {
  Department,
  DoctorSearchParams,
  DoctorSearchResult,
  DoctorService,
  PatientSafeDoctor,
  Specialty,
} from '../model/types';

/**
 * Development fixtures for doctor discovery.
 *
 * Every record here is shaped as a **patient-safe projection** (BE-04) —
 * no licence number, no employee id, no personal contact details. That is
 * not decoration: a fixture that carried them would teach a component to
 * expect them, and the component would then render them the day a real
 * endpoint returned a fuller payload by mistake.
 *
 * The names, biographies and clinics are invented for development. None
 * of it is production data and none of it may reach a patient — `env.ts`
 * refuses to build production with mocks enabled.
 */

const DOCTORS: readonly PatientSafeDoctor[] = [
  {
    id: 'DR-1001',
    fullName: 'Layla Haddad',
    title: 'Dr',
    specialty: 'Cardiology',
    departmentName: 'Cardiology',
    photoUrl: null,
    yearsOfExperience: 14,
    languages: ['English', 'Arabic'],
    biography:
      'Consultant cardiologist with an interest in preventative care and heart-rhythm disorders.',
    education: ['MBBS, University of Jordan', 'MRCP (UK)'],
    ratingAvg: 4.8,
    hospital: 'Medora Clinic',
    officeLocation: 'Level 3, Room 12',
  },
  {
    id: 'DR-1002',
    fullName: 'Samir Nasser',
    title: 'Dr',
    specialty: 'Dermatology',
    departmentName: 'Dermatology',
    photoUrl: null,
    yearsOfExperience: 9,
    languages: ['English', 'Arabic', 'French'],
    biography: 'Dermatologist working across general skin health and chronic skin conditions.',
    education: ['MD, Cairo University'],
    ratingAvg: 4.6,
    hospital: 'Medora Clinic',
    officeLocation: 'Level 2, Room 4',
  },
  {
    id: 'DR-1003',
    fullName: 'Hana Yilmaz',
    title: 'Dr',
    specialty: 'General Practice',
    departmentName: 'Family Medicine',
    photoUrl: null,
    yearsOfExperience: 6,
    languages: ['English', 'Turkish'],
    biography: 'Family doctor seeing adults and children for everyday health concerns.',
    education: ['MD, Hacettepe University'],
    ratingAvg: 4.9,
    hospital: 'Medora Clinic',
    officeLocation: 'Level 1, Room 8',
  },
  {
    id: 'DR-1004',
    fullName: 'Peter Osei',
    title: 'Dr',
    specialty: 'Orthopaedics',
    departmentName: 'Orthopaedics',
    photoUrl: null,
    yearsOfExperience: 18,
    languages: ['English'],
    biography: 'Orthopaedic surgeon focusing on knee and shoulder injuries.',
    education: ['MBChB, University of Ghana', 'FRCS (Tr & Orth)'],
    ratingAvg: 4.5,
    hospital: 'Medora Clinic',
    officeLocation: 'Level 3, Room 2',
  },
  {
    id: 'DR-1005',
    fullName: 'Mariam Zaki',
    title: 'Dr',
    specialty: 'Paediatrics',
    departmentName: 'Paediatrics',
    photoUrl: null,
    yearsOfExperience: 11,
    languages: ['English', 'Arabic'],
    biography: 'Paediatrician seeing newborns through to adolescents.',
    education: ['MBBCh, Alexandria University'],
    ratingAvg: 4.7,
    hospital: 'Medora Clinic',
    officeLocation: 'Level 1, Room 2',
  },
];

const SPECIALTIES: readonly Specialty[] = [
  { id: 'SP-01', name: 'Cardiology' },
  { id: 'SP-02', name: 'Dermatology' },
  { id: 'SP-03', name: 'General Practice' },
  { id: 'SP-04', name: 'Orthopaedics' },
  { id: 'SP-05', name: 'Paediatrics' },
];

const DEPARTMENTS: readonly Department[] = [
  { id: 'DP-01', name: 'Cardiology', description: 'Heart and circulation.' },
  { id: 'DP-02', name: 'Dermatology', description: 'Skin, hair and nails.' },
  { id: 'DP-03', name: 'Family Medicine', description: 'Everyday health for all ages.' },
  { id: 'DP-04', name: 'Orthopaedics', description: 'Bones, joints and injuries.' },
  { id: 'DP-05', name: 'Paediatrics', description: 'Care for children.' },
];

const PAGE_SIZE = 4;

function matches(doctor: PatientSafeDoctor, params: DoctorSearchParams): boolean {
  const query = params.q?.trim().toLowerCase() ?? '';
  const byQuery =
    query.length === 0 ||
    doctor.fullName.toLowerCase().includes(query) ||
    doctor.specialty.toLowerCase().includes(query);
  const bySpecialty =
    params.specialtyId === undefined ||
    SPECIALTIES.find((item) => item.id === params.specialtyId)?.name === doctor.specialty;
  const byDepartment =
    params.departmentId === undefined ||
    DEPARTMENTS.find((item) => item.id === params.departmentId)?.name === doctor.departmentName;
  return byQuery && bySpecialty && byDepartment;
}

export const fixtureDoctorService: DoctorService = {
  async search(params): Promise<DoctorSearchResult> {
    const filtered = DOCTORS.filter((doctor) => matches(doctor, params));
    const page = params.page ?? 1;
    const items = filtered.slice(0, page * PAGE_SIZE);
    return { items, totalItems: filtered.length, hasMore: items.length < filtered.length };
  },

  async getById(id) {
    const doctor = DOCTORS.find((item) => item.id === id);
    if (doctor === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    return doctor;
  },

  async listSpecialties() {
    return SPECIALTIES;
  },

  async listDepartments() {
    return DEPARTMENTS;
  },
};

/** Exported so appointment fixtures can reference the same practitioners. */
export const FIXTURE_DOCTORS = DOCTORS;
