import { describe, expect, it } from 'vitest';

import { PATIENT_LAB_STATUS, toView } from './patient-lab-status.service';

const FORBIDDEN = [
  'clinicalIndication',
  'clinical_indication',
  'interpretation',
  'flags',
  'flag',
  'hasCriticalResult',
  'has_critical_result',
  'reviewer',
  'reviewedBy',
  'reviewedAt',
];

describe('patient lab status projection (contract §4)', () => {
  it('maps the five lab states onto the four patient states exactly', () => {
    expect(PATIENT_LAB_STATUS).toEqual({
      ORDERED: 'awaiting_collection',
      COLLECTED: 'in_progress',
      PROCESSING: 'in_progress',
      COMPLETED: 'completed',
      CANCELLED: 'cancelled',
    });
  });

  it('never carries a clinician-only key, even when the row has one', () => {
    const row = {
      publicId: 'LAB-1',
      status: 'COMPLETED',
      requestedAt: new Date('2026-11-01T08:00:00Z'),
      collectedAt: new Date('2026-11-01T09:00:00Z'),
      completedAt: new Date('2026-11-02T09:00:00Z'),
      hospitalId: 'h1',
      test: { name: 'CBC', category: 'HEMATOLOGY', specimenType: 'WHOLE_BLOOD' },
      // Smuggled columns must not reach the view.
      clinicalIndication: 'secret',
      interpretation: 'secret',
      hasCriticalResult: true,
    } as never;
    const view = toView(row, new Map([['h1', 'General']]));
    const json = JSON.stringify(view);
    for (const key of FORBIDDEN) expect(Object.keys(view)).not.toContain(key);
    expect(json).not.toContain('secret');
    expect(view.results).toEqual({ available: false, reason: 'release_policy_pending' });
    expect(view.hospital).toEqual({ id: 'h1', name: 'General' });
  });
});
