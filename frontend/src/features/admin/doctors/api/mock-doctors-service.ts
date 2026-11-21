import { inTab } from '../doctors';

import type { AdminDoctorsService } from './doctors-service';
import { doctorsApi } from './doctors.api';

/**
 * The demo adapter: the seeded doctors store, which models every action
 * the screens were designed with — including the four the live platform
 * does not serve (see `DoctorsCapabilities`).
 */
export const mockDoctorsService: AdminDoctorsService = {
  capabilities: {
    invite: true,
    resetAccess: true,
    returnToReview: true,
    administrativeFields: true,
  },
  list: () => doctorsApi.list(),
  detail: async (doctorId) =>
    (await doctorsApi.list()).doctors.find((doctor) => doctor.id === doctorId) ?? null,
  pendingVerifications: async () =>
    (await doctorsApi.list()).doctors.filter((doctor) => inTab(doctor, 'pending')).length,
  setCheck: (input) => doctorsApi.setCheck(input),
  approveDocument: (input) => doctorsApi.approveDocument(input),
  rejectDocument: (input) => doctorsApi.rejectDocument(input),
  completeVerification: (input) => doctorsApi.completeVerification(input),
  // The demo store keeps the note; which documents were named is the live
  // API's concern, where the doctor is told.
  requestDocuments: (input) => doctorsApi.requestDocuments(input),
  rejectApplication: (input) => doctorsApi.rejectApplication(input),
  returnToReview: (input) => doctorsApi.returnToReview(input),
  suspend: (input) => doctorsApi.suspend(input),
  reactivate: (input) => doctorsApi.reactivate(input),
  resetAccess: (input) => doctorsApi.resetAccess(input),
  updateAdministrative: (input) => doctorsApi.updateAdministrative(input),
  invite: (input) => doctorsApi.invite(input),
};
