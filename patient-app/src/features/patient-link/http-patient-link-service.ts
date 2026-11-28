import { patientLinkEndpoints } from '@/api/endpoints/patient-link';

import type { PatientLinkService } from './model/types';

/**
 * The HTTP adapter. The wire shapes ARE the port's shapes, so this only
 * unwraps the envelope — and normalises one inconsistency defensively: a
 * `linked: false` answer never carries a patient onto a screen.
 */
export const httpPatientLinkService: PatientLinkService = {
  async getState() {
    const { data } = await patientLinkEndpoints.getState();
    return data.linked && data.patient !== null
      ? { linked: true, patient: { id: data.patient.id, fullName: data.patient.fullName } }
      : { linked: false, patient: null };
  },

  async issueCode() {
    const { data } = await patientLinkEndpoints.issueCode();
    return { code: data.code, expiresAt: data.expiresAt };
  },
};
