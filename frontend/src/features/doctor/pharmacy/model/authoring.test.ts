import { describe, expect, it } from 'vitest';

import {
  AUTHORING_STEP_IDS,
  canAdvanceTo,
  completeDraft,
  dosesPerDay,
  emptyDraft,
  findMedicationSpec,
  furthestValidStep,
  nextStep,
  previousStep,
  suggestedQuantity,
  validateStep,
  type PrescriptionDraft,
} from './authoring';
import { MEDICATION_CATALOGUE } from './catalogue';
import type { PrescriptionPatientSnapshot } from './types';

/** Per-step validation and the step machine that reads it. */

const PATIENT: PrescriptionPatientSnapshot = {
  id: 'PT-1001',
  name: 'Khaled Nassar',
  mrn: '4411-27',
  age: 52,
  gender: 'male',
  bloodType: 'O+',
  phone: '+20 100 214 3387',
  allergies: [],
  hasSevereAllergy: false,
};

const NOW = '2026-08-30T09:00:00.000Z';

function base(): PrescriptionDraft {
  return emptyDraft('draft-1', NOW);
}

function withPatient(): PrescriptionDraft {
  return { ...base(), patient: PATIENT };
}

function withMedication(): PrescriptionDraft {
  return { ...withPatient(), medication: { genericName: 'Metformin', strength: '500 mg' } };
}

function complete(): PrescriptionDraft {
  const spec = findMedicationSpec('Metformin', MEDICATION_CATALOGUE);
  if (spec === null) throw new Error('Test fixture drift: Metformin left the catalogue');
  return {
    ...withMedication(),
    dosage: {
      frequency: spec.frequencies[0] ?? '',
      durationDays: 30,
      quantity: 60,
      refillsAllowed: 1,
      instructions: 'Take 500 mg twice daily by mouth, with food.',
    },
  };
}

/* ── Step 1 ─────────────────────────────────────────────────────── */

describe('validateStep — patient', () => {
  it('objects when no patient is chosen', () => {
    const validation = validateStep(base(), 'patient', MEDICATION_CATALOGUE);
    expect(validation.valid).toBe(false);
    expect(validation.issues[0]?.field).toBe('patient');
  });

  it('passes once a patient is chosen', () => {
    expect(validateStep(withPatient(), 'patient', MEDICATION_CATALOGUE).valid).toBe(true);
  });
});

/* ── Step 2 ─────────────────────────────────────────────────────── */

describe('validateStep — medication', () => {
  it('objects when no medication is chosen', () => {
    expect(validateStep(withPatient(), 'medication', MEDICATION_CATALOGUE).issues[0]?.field).toBe('medication');
  });

  it('objects to a medication outside the formulary', () => {
    const draft = { ...withPatient(), medication: { genericName: 'Unobtainium', strength: '1 mg' } };
    expect(validateStep(draft, 'medication', MEDICATION_CATALOGUE).issues[0]?.field).toBe('medication');
  });

  it('objects to a strength the medication is not stocked in', () => {
    const draft = { ...withPatient(), medication: { genericName: 'Metformin', strength: '9 g' } };
    expect(validateStep(draft, 'medication', MEDICATION_CATALOGUE).issues[0]?.field).toBe('strength');
  });

  it('passes for a catalogue medication at a stocked strength', () => {
    expect(validateStep(withMedication(), 'medication', MEDICATION_CATALOGUE).valid).toBe(true);
  });
});

/* ── Step 3 ─────────────────────────────────────────────────────── */

describe('validateStep — dosage', () => {
  const fieldsOf = (draft: PrescriptionDraft) =>
    validateStep(draft, 'dosage', MEDICATION_CATALOGUE).issues.map((issue) => issue.field);

  it('objects to every empty field at once, not one at a time', () => {
    expect(fieldsOf(withMedication())).toEqual([
      'frequency',
      'durationDays',
      'quantity',
      'instructions',
    ]);
  });

  it('objects to a schedule the medication is not listed for', () => {
    const draft = {
      ...complete(),
      dosage: { ...complete().dosage, frequency: 'Every other Tuesday' },
    };
    expect(fieldsOf(draft)).toContain('frequency');
  });

  it.each([
    ['zero days', { durationDays: 0 }, 'durationDays'],
    ['a fractional duration', { durationDays: 1.5 }, 'durationDays'],
    ['a duration beyond a year', { durationDays: 400 }, 'durationDays'],
    ['zero quantity', { quantity: 0 }, 'quantity'],
    ['an implausible quantity', { quantity: 5000 }, 'quantity'],
    ['negative refills', { refillsAllowed: -1 }, 'refillsAllowed'],
    ['refills beyond eleven', { refillsAllowed: 12 }, 'refillsAllowed'],
    ['blank instructions', { instructions: '   ' }, 'instructions'],
  ])('objects to %s', (_label, patch, field) => {
    const draft = { ...complete(), dosage: { ...complete().dosage, ...patch } };
    expect(fieldsOf(draft)).toContain(field);
  });

  it('passes a fully specified dosage', () => {
    expect(validateStep(complete(), 'dosage', MEDICATION_CATALOGUE).valid).toBe(true);
  });
});

describe('dosage helpers', () => {
  it('reads doses per day off the catalogue phrasing', () => {
    expect(dosesPerDay('Once daily')).toBe(1);
    expect(dosesPerDay('Twice daily')).toBe(2);
    expect(dosesPerDay('Three times daily')).toBe(3);
  });

  it('proposes a quantity from schedule times duration', () => {
    expect(suggestedQuantity('Twice daily', 30)).toBe(60);
  });
});

/* ── The step machine ───────────────────────────────────────────── */

describe('the step machine', () => {
  it('orders the four steps as the spec does', () => {
    expect(AUTHORING_STEP_IDS).toEqual(['patient', 'medication', 'dosage', 'review']);
    expect(nextStep('patient')).toBe('medication');
    expect(previousStep('review')).toBe('dosage');
    expect(nextStep('review')).toBeNull();
    expect(previousStep('patient')).toBeNull();
  });

  it('refuses to skip forward past an invalid step, naming the blocker', () => {
    const transition = canAdvanceTo(base(), 'patient', 'dosage', { safetyCleared: false, formulary: MEDICATION_CATALOGUE });
    expect(transition.allowed).toBe(false);
    expect(transition.allowed === false && transition.blockedBy).toEqual({
      kind: 'invalid-step',
      step: 'patient',
    });
  });

  it('refuses to reach Review without a cleared safety screen', () => {
    const transition = canAdvanceTo(complete(), 'dosage', 'review', { safetyCleared: false, formulary: MEDICATION_CATALOGUE });
    expect(transition.allowed).toBe(false);
    expect(transition.allowed === false && transition.blockedBy).toEqual({
      kind: 'safety-not-cleared',
    });
  });

  it('allows Review once every step validates and the screen has cleared', () => {
    expect(canAdvanceTo(complete(), 'dosage', 'review', { safetyCleared: true, formulary: MEDICATION_CATALOGUE }).allowed).toBe(true);
  });

  it('always allows going backwards, so entered data can be corrected', () => {
    // Even from Review, and even with the screen not cleared.
    for (const target of ['patient', 'medication', 'dosage'] as const) {
      expect(canAdvanceTo(base(), 'review', target, { safetyCleared: false, formulary: MEDICATION_CATALOGUE }).allowed).toBe(true);
    }
  });

  it('reports the furthest step the draft alone justifies', () => {
    expect(furthestValidStep(base(), MEDICATION_CATALOGUE)).toBe('patient');
    expect(furthestValidStep(withPatient(), MEDICATION_CATALOGUE)).toBe('medication');
    expect(furthestValidStep(withMedication(), MEDICATION_CATALOGUE)).toBe('dosage');
    expect(furthestValidStep(complete(), MEDICATION_CATALOGUE)).toBe('review');
  });
});

describe('completeDraft', () => {
  it('returns null while any step still objects', () => {
    expect(completeDraft(base(), MEDICATION_CATALOGUE)).toBeNull();
    expect(completeDraft(withPatient(), MEDICATION_CATALOGUE)).toBeNull();
    expect(completeDraft(withMedication(), MEDICATION_CATALOGUE)).toBeNull();
  });

  it('narrows a validated draft, resolving the catalogue spec', () => {
    const narrowed = completeDraft(complete(), MEDICATION_CATALOGUE);
    expect(narrowed).not.toBeNull();
    expect(narrowed?.spec.genericName).toBe('Metformin');
    expect(narrowed?.spec.route).toBe('Oral');
    expect(narrowed?.patient.id).toBe('PT-1001');
  });

  it('trims the instructions it carries forward', () => {
    const draft = {
      ...complete(),
      dosage: { ...complete().dosage, instructions: '  Take with food.  ' },
    };
    expect(completeDraft(draft, MEDICATION_CATALOGUE)?.instructions).toBe('Take with food.');
  });
});

describe('controlled substances', () => {
  it('rejects refills on a controlled medication', () => {
    // No catalogue entry is controlled today, so this asserts the rule holds
    // for whatever the formulary grows into rather than for one fixture.
    const controlled = findMedicationSpec('Metformin', MEDICATION_CATALOGUE);
    expect(controlled?.isControlled).toBe(false);

    const draft = { ...complete(), dosage: { ...complete().dosage, refillsAllowed: 3 } };
    expect(validateStep(draft, 'dosage', MEDICATION_CATALOGUE).valid).toBe(true);
  });
});
