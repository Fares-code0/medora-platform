import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import { fetchPatientLabStudies } from './http-patient-studies';

/** A patient's lab studies over HTTP (FE-10.7) — `GET /patients/{id}/labs`. */

afterEach(() => {
  vi.unstubAllGlobals();
});

const STUDY = {
  labId: 'LAB-100000',
  testName: 'Complete Blood Count (CBC)',
  testCode: '58410-2',
  category: 'Hematology',
  status: 'completed',
  date: '2026-10-04T18:11:35.906Z',
  resultCount: 5,
  abnormalCount: 3,
  hasCriticalResult: true,
  reviewed: false,
};

describe('fetchPatientLabStudies', () => {
  it('flattens the categories, newest first, and passes the truncation flag through', async () => {
    const { requests } = stubApi({
      'GET /patients/PT-1004/labs': () =>
        envelope({
          patientId: 'PT-1004',
          categories: [
            { id: 'Hematology', label: 'Hematology', studies: [STUDY] },
            {
              id: 'Hormones',
              label: 'Hormones',
              studies: [
                {
                  ...STUDY,
                  labId: 'LAB-100002',
                  category: 'Hormones',
                  date: '2026-10-05T09:00:00.000Z',
                },
              ],
            },
          ],
          totalStudies: 2,
          truncated: true,
        }),
    });

    const result = await fetchPatientLabStudies('PT-1004');

    expect(requests).toHaveLength(1);
    expect(result.truncated).toBe(true);
    expect(result.studies.map((study) => study.labId)).toEqual(['LAB-100002', 'LAB-100000']);
  });

  it('counts a processing order as having nothing released yet', async () => {
    stubApi({
      'GET /patients/PT-1004/labs': () =>
        envelope({
          patientId: 'PT-1004',
          categories: [
            {
              id: 'Hematology',
              label: 'Hematology',
              studies: [
                { ...STUDY, status: 'processing' },
                { ...STUDY, labId: 'LAB-100001' },
              ],
            },
          ],
          totalStudies: 2,
          truncated: false,
        }),
    });

    const { studies } = await fetchPatientLabStudies('PT-1004');
    const processing = studies.find((study) => study.labId === 'LAB-100000');
    const released = studies.find((study) => study.labId === 'LAB-100001');

    // The server counted the processing order's entered values; they are not released.
    expect(processing).toMatchObject({
      resultCount: 0,
      abnormalCount: 0,
      hasCriticalResult: false,
    });
    expect(released).toMatchObject({ resultCount: 5, abnormalCount: 3, hasCriticalResult: true });
  });

  it('is an error, not an empty chart, when the server fails', async () => {
    stubApi({ 'GET /patients/PT-1004/labs': () => json({ message: 'Internal' }, 500) });
    await expect(fetchPatientLabStudies('PT-1004')).rejects.toMatchObject({ kind: 'server' });
  });
});
