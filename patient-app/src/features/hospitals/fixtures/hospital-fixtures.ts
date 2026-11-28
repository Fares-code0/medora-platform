import { MEDORA_HOSPITAL } from '@/features/doctors/fixtures/doctor-fixtures';

import type { HospitalDetail, HospitalService, HospitalSummary } from '../model/types';

/**
 * Development fixtures for hospital discovery. Invented for development;
 * `env.ts` refuses to build production with mocks enabled.
 */
const DETAILS: readonly HospitalDetail[] = [
  {
    id: MEDORA_HOSPITAL.id,
    name: MEDORA_HOSPITAL.name,
    description: 'A general hospital with outpatient clinics and diagnostics.',
    phone: '+962 6 555 0100',
    clinics: [
      { id: 'CL-1', name: 'Outpatient clinic' },
      { id: 'CL-2', name: 'Women’s health clinic' },
    ],
    locations: [
      {
        id: 'LOC-1',
        name: 'Main building',
        addressLine: '12 Example Street',
        city: 'Amman',
        timezone: 'Asia/Amman',
      },
    ],
    departments: [
      { id: 'DEP-1', name: 'Cardiology' },
      { id: 'DEP-2', name: 'Dermatology' },
    ],
    specialties: [
      { id: 'SP-1', name: 'Cardiology' },
      { id: 'SP-2', name: 'Dermatology' },
    ],
  },
  {
    id: 'HOS-2',
    name: 'Medora North Hospital',
    description: null,
    phone: null,
    clinics: [{ id: 'CL-3', name: 'Family medicine clinic' }],
    locations: [],
    departments: [{ id: 'DEP-3', name: 'Family Medicine' }],
    specialties: [],
  },
];

function summaryOf(detail: HospitalDetail): HospitalSummary {
  return {
    id: detail.id,
    name: detail.name,
    city: detail.locations[0]?.city ?? null,
    clinicCount: detail.clinics.length,
    departmentCount: detail.departments.length,
  };
}

export const fixtureHospitalService: HospitalService = {
  async list(params) {
    const query = params.q?.trim().toLowerCase() ?? '';
    const items = DETAILS.map(summaryOf).filter(
      (item) => query === '' || item.name.toLowerCase().includes(query),
    );
    return { items, totalItems: items.length, hasMore: false };
  },

  async getById(id) {
    const found = DETAILS.find((item) => item.id === id);
    if (found === undefined) {
      throw Object.assign(new Error('API error: not_found'), { kind: 'not_found' as const });
    }
    return found;
  },
};
