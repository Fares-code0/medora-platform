import { apiClient } from '@/api/client';
import {
  asRecord,
  readArray,
  readBoolean,
  readData,
  readEnum,
  readNumber,
  readString,
} from '@/api/http';

import type { PatientLabStudiesResult, PatientLabStudy } from './patient-studies';
import { LAB_CATEGORIES, LAB_STATUSES } from './types';

/**
 * A patient's lab studies over HTTP (FE-10.7) — `GET /patients/{id}/labs`
 * (API §8.12), which serves exactly the profile tab's shape, grouped by
 * category. The grouping is flattened here and redone by
 * `groupPatientLabStudies`, so both sources group the same way.
 *
 * The server keeps the 500 most recent and says when it did; that flag is
 * passed through rather than dropped, so a truncated list is never shown
 * as the whole record.
 */

function toStudy(value: unknown): PatientLabStudy {
  const what = 'lab study';
  const dto = asRecord(value, what);
  const status = readEnum(dto, 'status', LAB_STATUSES, what);
  // The server counts every entered value, a processing order's included.
  // The chart counts released ones only, as the Labs screen does
  // (`hasReleasedResults`): provisional values are not awaiting review.
  const released = status === 'completed';
  const resultCount = readNumber(dto, 'resultCount', what);
  const abnormalCount = readNumber(dto, 'abnormalCount', what);
  const hasCriticalResult = readBoolean(dto, 'hasCriticalResult', what);
  return {
    labId: readString(dto, 'labId', what),
    testName: readString(dto, 'testName', what),
    testCode: readString(dto, 'testCode', what),
    category: readEnum(dto, 'category', LAB_CATEGORIES, what),
    status,
    date: readString(dto, 'date', what),
    resultCount: released ? resultCount : 0,
    abnormalCount: released ? abnormalCount : 0,
    hasCriticalResult: released && hasCriticalResult,
    reviewed: readBoolean(dto, 'reviewed', what),
  };
}

export async function fetchPatientLabStudies(patientId: string): Promise<PatientLabStudiesResult> {
  const data = asRecord(
    readData(
      await apiClient.get(`/patients/${encodeURIComponent(patientId)}/labs`),
      'patient labs',
    ),
    'patient labs',
  );
  const studies = readArray(data, 'categories', 'patient labs')
    .flatMap((category) => readArray(asRecord(category, 'lab category'), 'studies', 'lab category'))
    .map(toStudy)
    .sort((a, b) => b.date.localeCompare(a.date));
  return { studies, truncated: readBoolean(data, 'truncated', 'patient labs') };
}
