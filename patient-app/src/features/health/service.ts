import { selectService, unavailableService } from '@/api/seam';

import { fixtureHealthService } from './fixtures/health-fixtures';
import type { HealthService } from './model/types';

/**
 * Health records.
 *
 * Blocked twice over: `GET /me/health/*` does not exist (BE-09, spanning
 * modules M10/M12/M13/M14, all unbuilt), and the results-release policy
 * is undecided (AD-5). The second is the more important of the two — an
 * endpoint could be written this week; deciding whether a patient sees an
 * unreviewed critical result needs a clinical owner.
 */
export const healthService: HealthService = selectService({
  fixture: fixtureHealthService,
  http: unavailableService<HealthService>('BE-09 / AD-5', 'capability.healthRecords', [
    'listAllergies',
    'listConditions',
    'listMedications',
    'listHistory',
    'listLabOrders',
    'getLabOrder',
    'listPrescriptions',
    'listVisits',
    'listDocuments',
    'listEmergencyContacts',
  ]),
});
