import type {
  Allergy,
  ChronicCondition,
  EmergencyContact,
  HealthService,
  HistoryEvent,
  LabOrder,
  LabOrderDetail,
  Medication,
  PatientDocument,
  Prescription,
  VisitSummary,
} from '../model/types';

/**
 * Development fixtures for health records.
 *
 * The set deliberately includes **every release state**, not just
 * `released`, because the states that are easy to forget are the ones
 * that matter: an unreviewed critical result, a record the clinic has not
 * shared, a document still being scanned. A fixture set where everything
 * is visible produces screens that only work when everything is visible.
 *
 * All of it is invented. `env.ts` refuses a production build with mocks
 * enabled, and nothing here resembles a real person.
 */

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

const ALLERGIES: readonly Allergy[] = [
  {
    id: 'AL-1',
    allergen: 'Penicillin',
    severity: 'severe',
    reaction: 'Swelling and difficulty breathing',
    release: 'released',
  },
  { id: 'AL-2', allergen: 'Pollen', severity: 'mild', reaction: 'Sneezing', release: 'released' },
];

const CONDITIONS: readonly ChronicCondition[] = [
  { id: 'CC-1', name: 'Hypertension', diagnosedOn: daysAgo(900), release: 'released' },
  // A condition a clinician has recorded but not yet signed off. The hub
  // renders the notice rather than the name — see `ReleaseNotice`.
  { id: 'CC-2', name: 'Asthma', diagnosedOn: daysAgo(60), release: 'pending-review' },
];

const MEDICATIONS: readonly Medication[] = [
  {
    id: 'MD-1',
    name: 'Amlodipine',
    dosage: '5 mg',
    frequency: 'Once daily',
    status: 'active',
    startedOn: daysAgo(400),
    release: 'released',
  },
  {
    id: 'MD-2',
    name: 'Amoxicillin',
    dosage: '500 mg',
    frequency: 'Three times daily',
    status: 'completed',
    startedOn: daysAgo(120),
    release: 'released',
  },
  {
    id: 'MD-3',
    name: 'Ibuprofen',
    dosage: '400 mg',
    frequency: 'As needed',
    status: 'discontinued',
    startedOn: daysAgo(300),
    release: 'released',
  },
  // A medicine the clinic has not shared through the app. Visible as a
  // held row rather than filtered out, so the list is not silently short.
  {
    id: 'MD-4',
    name: 'Sertraline',
    dosage: '50 mg',
    frequency: 'Once daily',
    status: 'active',
    startedOn: null,
    release: 'not-released',
  },
];

const HISTORY: readonly HistoryEvent[] = [
  {
    id: 'HE-1',
    kind: 'diagnosis',
    title: 'Hypertension',
    occurredOn: daysAgo(900),
    detail: null,
    release: 'released',
  },
  {
    id: 'HE-2',
    kind: 'vaccination',
    title: 'Influenza vaccine',
    occurredOn: daysAgo(210),
    detail: null,
    release: 'released',
  },
  {
    id: 'HE-3',
    kind: 'procedure',
    title: 'Echocardiogram',
    occurredOn: daysAgo(180),
    detail: 'Outpatient, no follow-up scheduled',
    release: 'released',
  },
  {
    id: 'HE-4',
    kind: 'surgery',
    title: 'Appendicectomy',
    occurredOn: daysAgo(2400),
    detail: null,
    release: 'released',
  },
  {
    id: 'HE-5',
    kind: 'hospitalization',
    title: 'Overnight observation',
    occurredOn: daysAgo(2395),
    detail: null,
    release: 'released',
  },
  // Recorded but not yet released. It is also the NEWEST row, so it is
  // the one that proves the hub sorts rather than trusting the order the
  // seam happened to hand it (J-05).
  {
    id: 'HE-6',
    kind: 'diagnosis',
    title: 'Seasonal allergic rhinitis',
    occurredOn: daysAgo(10),
    detail: null,
    release: 'pending-review',
  },
];

const LAB_ORDERS: readonly LabOrder[] = [
  {
    id: 'LB-1',
    panelName: 'Full blood count',
    orderedOn: daysAgo(12),
    status: 'completed',
    release: 'released',
    resultCount: 3,
  },
  {
    // The AD-5 case: results exist, a clinician has not reviewed them.
    id: 'LB-2',
    panelName: 'Lipid profile',
    orderedOn: daysAgo(4),
    status: 'completed',
    release: 'pending-review',
    resultCount: 4,
  },
  {
    id: 'LB-3',
    panelName: 'Thyroid function',
    orderedOn: daysAgo(1),
    status: 'processing',
    release: 'unavailable',
    resultCount: 0,
  },
];

const LAB_DETAILS: Record<string, LabOrderDetail> = {
  'LB-1': {
    ...LAB_ORDERS[0]!,
    results: [
      {
        id: 'LR-1',
        analyteName: 'Haemoglobin',
        value: '13.8',
        unit: 'g/dL',
        referenceRange: '12.0 – 15.5',
        flag: 'normal',
        release: 'released',
      },
      {
        id: 'LR-2',
        analyteName: 'White cell count',
        value: '10.9',
        unit: '10⁹/L',
        referenceRange: '4.0 – 11.0',
        flag: 'normal',
        release: 'released',
      },
      {
        id: 'LR-3',
        analyteName: 'Platelets',
        value: '132',
        unit: '10⁹/L',
        referenceRange: '150 – 400',
        flag: 'low',
        release: 'released',
      },
    ],
  },
  'LB-2': {
    ...LAB_ORDERS[1]!,
    // Held: the order is `pending-review`, so its results are too. The
    // screen shows why, not a blank.
    results: [],
  },
  'LB-3': { ...LAB_ORDERS[2]!, results: [] },
};

const PRESCRIPTIONS: readonly Prescription[] = [
  {
    id: 'PR-1',
    medicationName: 'Amlodipine',
    dosage: '5 mg',
    frequency: 'Once daily',
    status: 'active',
    issuedOn: daysAgo(30),
    refillsRemaining: 2,
    release: 'released',
  },
  {
    id: 'PR-2',
    medicationName: 'Amoxicillin',
    dosage: '500 mg',
    frequency: 'Three times daily',
    status: 'completed',
    issuedOn: daysAgo(120),
    refillsRemaining: 0,
    release: 'released',
  },
];

const VISITS: readonly VisitSummary[] = [
  {
    id: 'VS-1',
    title: 'Cardiology follow-up',
    visitedOn: daysAgo(21),
    doctorName: 'Dr Layla Haddad',
    summary: 'Blood pressure reviewed. Medication continued at the same dose.',
    release: 'released',
  },
  {
    // Not every visit note is shared with the patient by default.
    id: 'VS-2',
    title: 'Dermatology consultation',
    visitedOn: daysAgo(63),
    doctorName: 'Dr Samir Nasser',
    summary: null,
    release: 'not-released',
  },
];

const DOCUMENTS: readonly PatientDocument[] = [
  {
    id: 'DOC-1',
    title: 'Referral letter',
    category: 'referral',
    uploadedOn: daysAgo(40),
    scanState: 'clean',
    release: 'released',
  },
  {
    id: 'DOC-2',
    title: 'Consent form',
    category: 'consent',
    uploadedOn: daysAgo(2),
    scanState: 'pending',
    release: 'released',
  },
];

/**
 * N-08. Two rows, one primary — the shape the screen has to handle: the
 * clinic calls one person first, and a patient may have recorded a
 * second with no relationship written down.
 */
const EMERGENCY_CONTACTS: readonly EmergencyContact[] = [
  {
    id: 'EC-1',
    name: 'Huda Ahmed',
    relationship: 'Sister',
    phone: '+962 79 111 2222',
    primary: true,
  },
  {
    id: 'EC-2',
    name: 'Kareem Ahmed',
    relationship: null,
    phone: '+962 79 333 4444',
    primary: false,
  },
];

export const fixtureHealthService: HealthService = {
  async listAllergies() {
    return ALLERGIES;
  },
  async listConditions() {
    return CONDITIONS;
  },
  async listMedications() {
    return MEDICATIONS;
  },
  async listHistory() {
    return [...HISTORY].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  },
  async listLabOrders() {
    return LAB_ORDERS;
  },
  async getLabOrder(id) {
    const order = LAB_DETAILS[id];
    if (order === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    return order;
  },
  async listPrescriptions() {
    return PRESCRIPTIONS;
  },
  async listVisits() {
    return VISITS;
  },
  async listDocuments() {
    return DOCUMENTS;
  },
  async listEmergencyContacts() {
    return EMERGENCY_CONTACTS;
  },
};
