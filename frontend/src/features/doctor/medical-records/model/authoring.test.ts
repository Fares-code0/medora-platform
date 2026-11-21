import { describe, expect, it } from 'vitest';

import {
  EMPTY_VITALS,
  bmiFor,
  canAdvanceTo,
  emptyDraft,
  implausibleVitals,
  isClinicalStepComplete,
  isDraftComplete,
  isValidBloodPressure,
  isVisitStepComplete,
  nextRecordStep,
  previousRecordStep,
  withDiagnosisAdded,
  withDiagnosisRemoved,
  withPrimaryDiagnosis,
  type MedicalRecordDraft,
} from './authoring';
import type { RecordPatientSnapshot } from './types';

/**
 * The authoring rules (D-21). The step machine is a function of the draft, so
 * every "can I reach Review?" question is answered here rather than in
 * component state.
 */

const PATIENT: RecordPatientSnapshot = {
  id: 'PT-1001',
  name: 'Khaled Nassar',
  mrn: 'MRN-1',
  age: 52,
  gender: 'male',
  bloodType: 'O+',
  phone: '01000000000',
};

const NOW = '2026-08-01T09:00:00.000Z';

function draftWith(overrides: Partial<MedicalRecordDraft> = {}): MedicalRecordDraft {
  return { ...emptyDraft('draft-1', NOW), ...overrides };
}

/** A draft that satisfies every step, as the shortest path to Review. */
function completeDraft(): MedicalRecordDraft {
  return draftWith({
    patient: PATIENT,
    visit: { visitDate: '2026-08-01', visitType: 'Follow-up', department: 'General Medicine' },
    chiefComplaint: 'Routine review',
    historyOfPresentIllness: 'Stable since the last visit.',
    physicalExamination: 'No new findings.',
    diagnoses: withDiagnosisAdded([], 'I10'),
    note: { title: 'Consultation note', body: 'Reviewed; plan unchanged.' },
  });
}

describe('step order', () => {
  it('walks patient → visit → clinical → review and stops at both ends', () => {
    expect(previousRecordStep('patient')).toBeNull();
    expect(nextRecordStep('patient')).toBe('visit');
    expect(nextRecordStep('visit')).toBe('clinical');
    expect(nextRecordStep('clinical')).toBe('review');
    expect(nextRecordStep('review')).toBeNull();
  });
});

describe('blood pressure', () => {
  it('accepts a systolic-over-diastolic pair and rejects the rest', () => {
    expect(isValidBloodPressure('120/80')).toBe(true);
    expect(isValidBloodPressure(' 138 / 88 ')).toBe(true);
    // Inverted — a typo that would otherwise store a nonsense reading.
    expect(isValidBloodPressure('80/120')).toBe(false);
    expect(isValidBloodPressure('120')).toBe(false);
    expect(isValidBloodPressure('120/')).toBe(false);
    expect(isValidBloodPressure('abc')).toBe(false);
  });
});

describe('vitals plausibility', () => {
  it('passes anything a body can actually do, including alarming values', () => {
    // The bounds catch typos, not abnormality: a record must be able to hold
    // a genuinely dangerous observation.
    expect(
      implausibleVitals({ ...EMPTY_VITALS, heartRateBpm: 190, oxygenSaturation: 78 }),
    ).toEqual([]);
  });

  it('names the fields that could only be a typo', () => {
    expect(
      implausibleVitals({ ...EMPTY_VITALS, heartRateBpm: 720, temperatureC: 98.6 }),
    ).toEqual(['heartRateBpm', 'temperatureC']);
  });

  it('ignores fields that were simply not recorded', () => {
    expect(implausibleVitals(EMPTY_VITALS)).toEqual([]);
  });
});

describe('bmi', () => {
  it('is derived from height and weight, never entered', () => {
    expect(bmiFor({ heightCm: 175, weightKg: 80 })).toBe(26.1);
  });

  it('is null until both are present, and safe at zero height', () => {
    expect(bmiFor({ heightCm: null, weightKg: 80 })).toBeNull();
    expect(bmiFor({ heightCm: 175, weightKg: null })).toBeNull();
    expect(bmiFor({ heightCm: 0, weightKg: 80 })).toBeNull();
  });
});

describe('step completeness', () => {
  it('needs every encounter field and a chief complaint', () => {
    expect(isVisitStepComplete(completeDraft())).toBe(true);
    expect(
      isVisitStepComplete(draftWith({ ...completeDraft(), chiefComplaint: '  ' })),
    ).toBe(false);
    // API §6.3 requires all three narrative fields; blank is not an answer.
    expect(
      isVisitStepComplete(draftWith({ ...completeDraft(), historyOfPresentIllness: ' ' })),
    ).toBe(false);
    expect(
      isVisitStepComplete(draftWith({ ...completeDraft(), physicalExamination: '' })),
    ).toBe(false);
    expect(
      isVisitStepComplete(
        draftWith({ ...completeDraft(), visit: { visitDate: null, visitType: 'Follow-up', department: 'X' } }),
      ),
    ).toBe(false);
  });

  it('needs a primary diagnosis and a note with content', () => {
    expect(isClinicalStepComplete(completeDraft())).toBe(true);
    expect(isClinicalStepComplete(draftWith({ ...completeDraft(), diagnoses: [] }))).toBe(false);
    expect(
      isClinicalStepComplete(
        draftWith({ ...completeDraft(), note: { title: 'Note', body: '   ' } }),
      ),
    ).toBe(false);
  });

  it('treats vitals as optional but refuses ones that cannot be real', () => {
    const noVitals = completeDraft();
    expect(isClinicalStepComplete(noVitals)).toBe(true);

    const typo = draftWith({
      ...completeDraft(),
      vitals: { ...EMPTY_VITALS, heartRateBpm: 720 },
    });
    expect(isClinicalStepComplete(typo)).toBe(false);

    const badBp = draftWith({
      ...completeDraft(),
      vitals: { ...EMPTY_VITALS, bloodPressure: '80/120' },
    });
    expect(isClinicalStepComplete(badBp)).toBe(false);
  });
});

describe('canAdvanceTo', () => {
  it('gates each step on the ones before it', () => {
    const empty = draftWith();
    expect(canAdvanceTo(empty, 'patient')).toBe(true);
    expect(canAdvanceTo(empty, 'visit')).toBe(false);
    expect(canAdvanceTo(empty, 'clinical')).toBe(false);
    expect(canAdvanceTo(empty, 'review')).toBe(false);

    const withPatient = draftWith({ patient: PATIENT });
    expect(canAdvanceTo(withPatient, 'visit')).toBe(true);
    expect(canAdvanceTo(withPatient, 'clinical')).toBe(false);

    const full = completeDraft();
    expect(canAdvanceTo(full, 'review')).toBe(true);
    expect(isDraftComplete(full)).toBe(true);
  });

  it('closes Review the moment the draft stops being complete', () => {
    const broken = draftWith({ ...completeDraft(), note: { title: '', body: '' } });
    expect(canAdvanceTo(broken, 'review')).toBe(false);
    expect(isDraftComplete(broken)).toBe(false);
  });
});

describe('diagnoses — exactly one primary, always', () => {
  it('makes the first one primary and leaves later ones secondary', () => {
    const one = withDiagnosisAdded([], 'I10');
    expect(one).toEqual([{ code: 'I10', label: 'Essential hypertension', isPrimary: true }]);

    const two = withDiagnosisAdded(one, 'E11.9');
    expect(two.filter((entry) => entry.isPrimary)).toHaveLength(1);
    expect(two[1]?.isPrimary).toBe(false);
  });

  it('ignores a duplicate and an unknown code', () => {
    const one = withDiagnosisAdded([], 'I10');
    expect(withDiagnosisAdded(one, 'I10')).toBe(one);
    expect(withDiagnosisAdded(one, 'NOT-A-CODE')).toBe(one);
  });

  it('promotes exactly one when the primary is removed', () => {
    const two = withDiagnosisAdded(withDiagnosisAdded([], 'I10'), 'E11.9');
    const left = withDiagnosisRemoved(two, 'I10');
    expect(left).toHaveLength(1);
    expect(left[0]?.isPrimary).toBe(true);
  });

  it('demotes the rest when another is promoted', () => {
    const two = withDiagnosisAdded(withDiagnosisAdded([], 'I10'), 'E11.9');
    const promoted = withPrimaryDiagnosis(two, 'E11.9');
    expect(promoted.filter((entry) => entry.isPrimary).map((entry) => entry.code)).toEqual([
      'E11.9',
    ]);
  });

  it('leaves an empty list empty rather than inventing a primary', () => {
    expect(withDiagnosisRemoved(withDiagnosisAdded([], 'I10'), 'I10')).toEqual([]);
  });
});
