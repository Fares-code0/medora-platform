import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import { assessAttachability } from './attachability';
import { attachLabReportHttp } from './http-attachments';

/** Filing a lab report onto a record over HTTP (FE-10.7) — API §8.9. */

afterEach(() => {
  vi.unstubAllGlobals();
});

function attachable() {
  const { attachable: value } = assessAttachability({
    report: {
      labId: 'LAB-100000',
      testName: 'Complete Blood Count (CBC)',
      testCode: '58410-2',
      collectedAt: '2026-10-04T18:11:30.605Z',
      completedAt: '2026-10-04T18:11:35.906Z',
      resultCount: 5,
      abnormalCount: 3,
      hasCriticalResult: true,
    },
    reportPatient: { patientId: 'PT-1004', patientMrn: '4472-90' },
    target: {
      recordId: 'MR-10002',
      patientId: 'PT-1004',
      patientName: 'Omar Farouk',
      patientMrn: '4472-90',
      label: 'Follow-up — Cardiology',
      visitDate: '2026-10-04T00:00:00',
    },
    confirmed: { patientId: 'PT-1004', patientMrn: '4472-90' },
    confirmedBy: 'Dr. Amelia Chen',
    existingLabIds: [],
    now: () => new Date('2026-10-04T19:00:00.000Z'),
  });
  if (value === null) throw new Error('fixture is not attachable');
  return value;
}

describe('attachLabReportHttp', () => {
  it('sends the record and the identity the doctor confirmed', async () => {
    const { requests } = stubApi({
      'POST /lab-orders/LAB-100000/attach-to-record': () =>
        json(
          envelope({ recordId: 'MR-10002', labOrderId: 'LAB-100000', attachmentIds: ['att-1'] }),
          201,
        ),
    });

    const attachment = await attachLabReportHttp(attachable());

    expect(requests[0]?.body).toEqual({
      recordId: 'MR-10002',
      confirmedPatient: { name: 'Omar Farouk', mrn: '4472-90' },
    });
    expect(attachment).toMatchObject({ id: 'att-1', recordId: 'MR-10002', labId: 'LAB-100000' });
  });

  it('passes the server’s refusal through — nothing is filed locally in its place', async () => {
    stubApi({
      'POST /lab-orders/LAB-100000/attach-to-record': () =>
        json(
          {
            message: 'No report document',
            code: 'validation_failed',
            fieldErrors: { labOrderId: ['This order carries no report document yet.'] },
          },
          422,
        ),
    });
    await expect(attachLabReportHttp(attachable())).rejects.toMatchObject({ kind: 'validation' });
  });
});
