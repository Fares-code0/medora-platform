import { useQuery } from '@tanstack/react-query';

import { usePagedQuery } from '@/api/paged';
import { createKeyFactory } from '@/api/query-keys';

import type { LabTest } from './model/types';
import { healthService } from './service';

/**
 * Queries for the patient-facing information layer.
 *
 * The key domains — `health-records` and `lab-results` — are both listed
 * in `PHI_QUERY_DOMAINS`, so `clearPhiCache` removes them on logout, on
 * session loss and after a background timeout (checklist J-10, T-03).
 * Insurance lives under `health-records`; test status under
 * `lab-results`. A new PHI query here must use one of those domains or
 * add its own to that list.
 */
export const healthKeys = createKeyFactory('health-records');
export const labKeys = createKeyFactory('lab-results');

/** Test status, a page at a time. */
export function useLabTests() {
  return usePagedQuery<LabTest>({
    queryKey: labKeys.lists(),
    queryFn: (page) => healthService.listLabTests(page),
  });
}

/** The insurance on file; `insurance: null` is "none on file", not a failure. */
export function useInsurance() {
  return useQuery({
    queryKey: [...healthKeys.all, 'insurance'],
    queryFn: () => healthService.getInsurance(),
  });
}

/**
 * The patient's emergency contacts (N-08).
 *
 * `enabled` because the only screen that renders them also renders
 * signed out, where there is no `/me` to read: the Emergency screen
 * passes `false` and no request is made. It sits under `healthKeys`, so
 * `clearPhiCache` sweeps it — a family member's name and phone number is
 * exactly the kind of value that must not survive a logout.
 */
export function useEmergencyContacts(enabled: boolean) {
  return useQuery({
    queryKey: [...healthKeys.all, 'emergency-contacts'],
    queryFn: () => healthService.listEmergencyContacts(),
    enabled,
  });
}
