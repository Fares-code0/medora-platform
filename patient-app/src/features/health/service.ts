import { selectService } from '@/api/seam';

import { fixtureHealthService } from './fixtures/health-fixtures';
import { httpHealthService } from './http-health-service';
import type { HealthService } from './model/types';

/**
 * The patient-facing information layer: test status and insurance on file.
 *
 * ── The record is not behind this seam, and is not coming ────────────
 *
 * This service used to be the port for the whole clinical record
 * (allergies, conditions, medicines, history, prescriptions, visits,
 * documents, lab results) and was blocked on BE-09 and the results-release
 * policy (AD-5 / ADR-031). The owner's decision of 2026-11-26 settled the
 * first half differently: **a patient never sees the full record, the
 * physician's notes or the internal documentation.** Those methods were
 * deleted, not left refusing — a refusing port reads as "built next
 * sprint", and it is not.
 *
 * What is live: `listLabTests` (`GET /me/lab-orders`, status only) and
 * `getInsurance` (`GET /me/insurance`). What still refuses by name:
 * `listEmergencyContacts` (BE-09). Results stay unexposed until a release
 * policy is approved (ADR-031, open).
 */
export const healthService: HealthService = selectService({
  fixture: fixtureHealthService,
  http: httpHealthService,
});
