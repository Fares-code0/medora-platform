import type { EmergencyContact, HealthService, InsuranceView, LabTest } from '../model/types';

/**
 * The mock-build adapter — selected only when `EXPO_PUBLIC_ENABLE_MOCKS`
 * is on (`api/seam.ts`). A production build never reaches this file's
 * data: `service.ts` passes the HTTP adapter as `http`.
 *
 * It carries status-only rows, which is all the real routes carry. There
 * is deliberately no result, value or flag in it: a fixture that had one
 * would let a screen be built that works in development and has nothing
 * to show in production.
 */
const LAB_TESTS: readonly LabTest[] = [
  {
    id: 'LAB-1',
    testName: 'Full blood count',
    category: 'Haematology',
    specimenType: 'Blood',
    status: 'completed',
    requestedAt: '2026-10-12T08:00:00Z',
    collectedAt: '2026-10-12T09:10:00Z',
    completedAt: '2026-10-13T11:00:00Z',
    hospitalName: 'Medora City Hospital',
  },
  {
    id: 'LAB-2',
    testName: 'Lipid panel',
    category: 'Chemistry',
    specimenType: 'Blood',
    status: 'in_progress',
    requestedAt: '2026-11-20T08:00:00Z',
    collectedAt: '2026-11-20T09:00:00Z',
    completedAt: null,
    hospitalName: 'Medora City Hospital',
  },
  {
    id: 'LAB-3',
    testName: 'Urinalysis',
    category: 'Chemistry',
    specimenType: 'Urine',
    status: 'awaiting_collection',
    requestedAt: '2026-11-25T08:00:00Z',
    collectedAt: null,
    completedAt: null,
    hospitalName: null,
  },
];

const INSURANCE: InsuranceView = {
  insurance: {
    providerName: 'Example Health Cover',
    plan: 'Standard',
    policyNumberLast4: '4821',
    validUntil: '2027-06-30',
    isActive: true,
  },
};

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
  async listLabTests() {
    return { items: LAB_TESTS, totalItems: LAB_TESTS.length, hasMore: false };
  },
  async getInsurance() {
    return INSURANCE;
  },
  async listEmergencyContacts() {
    return EMERGENCY_CONTACTS;
  },
};
