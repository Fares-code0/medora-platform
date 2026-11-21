import { beforeEach, describe, expect, it } from 'vitest';

import {
  ATTACH_BLOCKED_META,
  NotAttachableError,
  assertAttachable,
  assessAttachability,
  type AttachableReport,
} from './attachability';
import { __resetRecordAttachments, attachLabReport, listAttachmentsForRecord } from './store';
import type { AttachmentTarget, LabReportRef } from './types';

/**
 * The identity check in front of attach-to-record (D-14, UX §2.6).
 *
 * The failure this guards against — a result filed onto the wrong patient's
 * chart — is one of the few in the product that reading the screen again does
 * not undo, so the tests assert that no value is produced rather than that a
 * button is disabled.
 */

const REPORT: LabReportRef = {
  labId: 'LAB-100004',
  testName: 'Basic metabolic panel',
  testCode: 'BMP',
  collectedAt: '2026-08-01T10:00:00.000Z',
  completedAt: '2026-08-01T12:00:00.000Z',
  resultCount: 6,
  abnormalCount: 2,
  hasCriticalResult: true,
};

const PATIENT = { patientId: 'PT-1004', patientMrn: '4482-19' };

const TARGET: AttachmentTarget = {
  recordId: 'MR-2091',
  label: 'Follow-up — Cardiology',
  visitDate: '2026-08-01T09:00:00.000Z',
  patientId: 'PT-1004',
  patientName: 'Omar Farouk',
  patientMrn: '4482-19',
};

const base = {
  report: REPORT,
  reportPatient: PATIENT,
  target: TARGET,
  confirmed: { patientId: 'PT-1004', patientMrn: '4482-19' },
  confirmedBy: 'Dr. Amelia Chen',
  existingLabIds: [] as readonly string[],
  now: () => new Date('2026-08-02T08:00:00.000Z'),
};

beforeEach(() => {
  __resetRecordAttachments();
});

describe('assessAttachability', () => {
  it('produces an attachable report when identity, target and confirmation agree', () => {
    const outcome = assessAttachability(base);
    expect(outcome.blockedBy).toBeNull();
    expect(outcome.attachable).not.toBeNull();
  });

  it('produces NOTHING when the record belongs to another patient', () => {
    const outcome = assessAttachability({
      ...base,
      target: { ...TARGET, patientId: 'PT-1001', patientName: 'Khaled Nassar' },
      confirmed: { patientId: 'PT-1001', patientMrn: '4482-19' },
    });
    expect(outcome.attachable).toBeNull();
    expect(outcome.blockedBy).toBe('patient-mismatch');
  });

  it('refuses a matching id with a differing MRN — one of the two records is wrong about who this is', () => {
    const outcome = assessAttachability({
      ...base,
      target: { ...TARGET, patientMrn: '9999-99' },
      confirmed: { patientId: 'PT-1004', patientMrn: '9999-99' },
    });
    expect(outcome.attachable).toBeNull();
    expect(outcome.blockedBy).toBe('patient-mismatch');
  });

  it('refuses an unconfirmed attach', () => {
    const outcome = assessAttachability({ ...base, confirmed: null });
    expect(outcome.attachable).toBeNull();
    expect(outcome.blockedBy).toBe('unconfirmed');
  });

  it('voids a confirmation that names a different identity than the target', () => {
    // This is the "ticked the box, then changed the encounter" case. The
    // confirmation carries an identity rather than a boolean precisely so it
    // cannot survive the change.
    const outcome = assessAttachability({
      ...base,
      confirmed: { patientId: 'PT-1001', patientMrn: '1111-11' },
    });
    expect(outcome.attachable).toBeNull();
    expect(outcome.blockedBy).toBe('unconfirmed');
  });

  it('refuses an order with nothing released, a missing target, and a duplicate', () => {
    expect(
      assessAttachability({ ...base, report: { ...REPORT, resultCount: 0 } }).blockedBy,
    ).toBe('no-results');
    expect(assessAttachability({ ...base, target: null }).blockedBy).toBe('no-target');
    expect(assessAttachability({ ...base, existingLabIds: [REPORT.labId] }).blockedBy).toBe(
      'already-attached',
    );
  });

  it('names every blocked reason in words', () => {
    for (const message of Object.values(ATTACH_BLOCKED_META)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('attachLabReport', () => {
  it('files the report against the record and nowhere else', async () => {
    const { attachable } = assessAttachability(base);
    const stored = await attachLabReport(attachable!);

    expect(stored.recordId).toBe('MR-2091');
    expect(stored.labId).toBe('LAB-100004');
    expect(stored.patientName).toBe('Omar Farouk');
    expect(stored.attachedBy).toBe('Dr. Amelia Chen');
    expect(stored.hasCriticalResult).toBe(true);
    expect(listAttachmentsForRecord('MR-2091')).toEqual([stored]);
    expect(listAttachmentsForRecord('MR-OTHER')).toEqual([]);
  });

  it('states in the stored record itself that nothing was transmitted', async () => {
    const { attachable } = assessAttachability(base);
    const stored = await attachLabReport(attachable!);
    // The wording is data, so the UI cannot render a claim the store does not
    // make — and it disappears by itself when a real service answers.
    expect(stored.note).toMatch(/no document service is connected/i);
  });

  it('refuses a forged value at runtime, not merely at compile time', async () => {
    const forged = {
      report: REPORT,
      target: TARGET,
      confirmedBy: 'Dr. Amelia Chen',
      confirmedAt: '2026-08-02T08:00:00.000Z',
    } as unknown as AttachableReport;

    expect(() => {
      assertAttachable(forged);
    }).toThrow(NotAttachableError);
    await expect(attachLabReport(forged)).rejects.toThrow(NotAttachableError);
    expect(listAttachmentsForRecord('MR-2091')).toEqual([]);
  });
});
