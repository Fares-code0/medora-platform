import { patientInfoEndpoints, type WireLabOrder } from '@/api/endpoints/patient-info';
import { EndpointNotImplementedError } from '@/api/seam';

import type { HealthService, LabTest } from './model/types';

/**
 * The HTTP adapter for the patient-facing information layer.
 *
 * Two methods are live (`GET /me/lab-orders`, `GET /me/insurance`); the
 * third, `listEmergencyContacts`, still refuses by name because no route
 * serves a patient's emergency contacts (BE-09). It is the same partial
 * shape `doctors` and `appointments` take.
 *
 * `results` on a wire lab order (`{ available: false, reason }`) is
 * dropped here rather than mapped: the domain `LabTest` has no result
 * slot, and the endpoint schema is strict, so a server that began to send
 * one would be refused before it got this far.
 */
function toLabTest(wire: WireLabOrder): LabTest {
  return {
    id: wire.id,
    testName: wire.testName,
    category: wire.category,
    specimenType: wire.specimenType,
    status: wire.status,
    requestedAt: wire.requestedAt,
    collectedAt: wire.collectedAt,
    completedAt: wire.completedAt,
    hospitalName: wire.hospital?.name ?? null,
  };
}

export const httpHealthService: HealthService = {
  async listLabTests(page) {
    const response = await patientInfoEndpoints.labOrders({ page });
    const { data } = response;
    return {
      items: data.items.map(toLabTest),
      totalItems: data.totalItems,
      hasMore: data.page < data.totalPages,
    };
  },

  async getInsurance() {
    const { data } = await patientInfoEndpoints.insurance();
    return { insurance: data.insurance };
  },

  listEmergencyContacts() {
    return Promise.reject(new EndpointNotImplementedError('BE-09', 'capability.healthRecords'));
  },
};
