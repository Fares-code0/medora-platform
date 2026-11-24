import { describe, expect, it } from 'vitest';

import {
  blockingWarnings,
  LEGACY_MARK,
  screenPrescription,
  warningsNeedingAcknowledgment,
  type CurrentMedication,
  type InteractionFinding,
  type PatientAllergy,
  type ScreenSubject,
} from './safety-screen';

/**
 * The safety screen, exhaustively (RM M13.2, and the M13 exit gate's
 * "safety service coverage report = 100%").
 *
 * The screen is pure, so every branch is reachable from a table of
 * inputs — which is the whole reason it is pure. What follows drives
 * each of the three rules through its positive case, its negative case
 * and every grading boundary, plus the ordering and the two selectors
 * M13.3 signs against.
 *
 * **Nothing here is relaxed to make a case pass.** Where a rule
 * surprised me while writing these, the assertion records the rule and
 * the comment records where it came from — `safety-check.ts` in the
 * frontend for the clinical grading, RM M13.2 for the interaction
 * source, API §7.5 for `blocking`.
 */

const NO_ALLERGIES: readonly PatientAllergy[] = [];
const NO_MEDICATIONS: readonly CurrentMedication[] = [];
const NO_INTERACTIONS: readonly InteractionFinding[] = [];

function subject(overrides: Partial<ScreenSubject> = {}): ScreenSubject {
  return {
    patientName: 'Layla Morsi',
    allergies: NO_ALLERGIES,
    medicationId: 'med-amoxil',
    brandName: 'Amoxil',
    genericName: 'Amoxicillin',
    category: 'Antibiotics',
    allergyClass: 'Penicillin',
    currentMedications: NO_MEDICATIONS,
    interactions: NO_INTERACTIONS,
    ...overrides,
  };
}

function medication(overrides: Partial<CurrentMedication> = {}): CurrentMedication {
  return {
    prescriptionId: 'RX-200001',
    medicationId: 'med-warfarin',
    name: 'Coumadin',
    genericName: 'Warfarin',
    category: 'Anticoagulants',
    isHighRisk: true,
    ...overrides,
  };
}

describe('a clear prescription', () => {
  it('returns no warnings and does not block', () => {
    const result = screenPrescription(subject());

    expect(result.warnings).toEqual([]);
    expect(result.blocking).toBe(false);
  });
});

describe('rule 1 — allergy', () => {
  it('blocks on an allergy-class match, and grades it critical when severe', () => {
    // RM M13.2's verify step, as a unit: a penicillin-allergic patient
    // and Amoxil must produce a blocking critical allergy warning.
    const result = screenPrescription(
      subject({
        allergies: [{ allergen: 'Penicillin', severity: 'severe' }],
      }),
    );

    expect(result.blocking).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.kind).toBe('allergy');
    expect(result.warnings[0]?.severity).toBe('critical');
    expect(result.warnings[0]?.blocking).toBe(true);
    expect(result.warnings[0]?.title).toBe('Allergy conflict — Penicillin');
    expect(result.warnings[0]?.detail).toContain('flagged severe');
    expect(result.warnings[0]?.detail).toContain('cannot be overridden');
    expect(result.warnings[0]?.against).toEqual(['Recorded allergy: Penicillin']);
  });

  it('still blocks when the recorded allergy is not severe', () => {
    // The frontend's coded screen grades *severity* by `hasSevereAllergy`
    // but marks the warning `blocking: true` unconditionally, and §7.5
    // says an allergy match blocks without qualifying it. A moderate
    // allergy therefore stops the prescription too.
    const result = screenPrescription(
      subject({ allergies: [{ allergen: 'Penicillin', severity: 'moderate' }] }),
    );

    expect(result.blocking).toBe(true);
    expect(result.warnings[0]?.severity).toBe('warning');
    expect(result.warnings[0]?.blocking).toBe(true);
    expect(result.warnings[0]?.detail).not.toContain('flagged severe');
  });

  it('grades critical from any severe allergy on file, not only the matched one', () => {
    // `hasSevereAllergy` is a property of the patient (the frontend
    // computes it across every row), so a patient with a severe latex
    // allergy and a mild penicillin one is still flagged severe. One
    // patient must not get two answers from two surfaces.
    const result = screenPrescription(
      subject({
        allergies: [
          { allergen: 'Penicillin', severity: 'mild' },
          { allergen: 'Latex', severity: 'severe' },
        ],
      }),
    );

    expect(result.warnings[0]?.severity).toBe('critical');
  });

  it('matches case- and whitespace-insensitively', () => {
    const result = screenPrescription(
      subject({ allergies: [{ allergen: '  penicillin ', severity: 'severe' }] }),
    );

    expect(result.blocking).toBe(true);
  });

  it('matches a recorded allergy to the generic name', () => {
    // Identity, not a clinical rule: a patient allergic to "Amoxicillin"
    // is allergic to the drug called Amoxicillin. Without this, a
    // catalogue row with a null `allergy_class` — which is four of the
    // five seeded medications — would let the allergy pass unremarked.
    const result = screenPrescription(
      subject({
        allergyClass: null,
        allergies: [{ allergen: 'Amoxicillin', severity: 'severe' }],
      }),
    );

    expect(result.blocking).toBe(true);
    expect(result.warnings[0]?.title).toBe('Allergy conflict — Amoxicillin');
  });

  it('matches a recorded allergy to the brand name', () => {
    const result = screenPrescription(
      subject({
        allergyClass: null,
        allergies: [{ allergen: 'Amoxil', severity: 'mild' }],
      }),
    );

    expect(result.blocking).toBe(true);
  });

  it('does not match a different allergen', () => {
    const result = screenPrescription(
      subject({ allergies: [{ allergen: 'Sulfa', severity: 'severe' }] }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.blocking).toBe(false);
  });

  it('does not substring-match one allergen inside another', () => {
    // `includes` here would be a false allergy block, and an allergy
    // block has no override — it is a refusal to treat.
    const result = screenPrescription(
      subject({
        allergyClass: 'Penicillin',
        allergies: [{ allergen: 'Semi-synthetic penicillins', severity: 'severe' }],
      }),
    );

    expect(result.warnings).toEqual([]);
  });

  it('reports every matching allergen when more than one matches', () => {
    const result = screenPrescription(
      subject({
        allergyClass: 'Penicillin',
        allergies: [
          { allergen: 'Penicillin', severity: 'severe' },
          { allergen: 'Amoxicillin', severity: 'moderate' },
        ],
      }),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.against).toEqual([
      'Recorded allergy: Penicillin',
      'Recorded allergy: Amoxicillin',
    ]);
  });

  it('ignores a null allergy class with no name match', () => {
    const result = screenPrescription(
      subject({ allergyClass: null, allergies: [{ allergen: 'Iodine', severity: 'mild' }] }),
    );

    expect(result.warnings).toEqual([]);
  });

  it('ignores a blank allergy class rather than matching a blank allergen', () => {
    const result = screenPrescription(
      subject({
        allergyClass: '   ',
        brandName: 'Amoxil',
        genericName: 'Amoxicillin',
        allergies: [{ allergen: '', severity: 'mild' }],
      }),
    );

    expect(result.warnings).toEqual([]);
  });
});

describe('rule 2 — drug–drug interaction', () => {
  const warfarin = medication();

  it('reports a finding graded by the pair, not by the drug', () => {
    // RM M13.2: "severity-graded from `drug_interactions`". The row's own
    // severity is used — a canned per-drug note cannot grade a pair.
    const result = screenPrescription(
      subject({
        currentMedications: [warfarin],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'critical',
            title: 'Warfarin × Amoxicillin',
            detail: 'Broad-spectrum antibiotics raise INR.',
            management: 'Check INR within 3–5 days.',
          },
        ],
      }),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.kind).toBe('interaction');
    expect(result.warnings[0]?.severity).toBe('critical');
    expect(result.warnings[0]?.title).toBe('Warfarin × Amoxicillin');
    expect(result.warnings[0]?.against).toEqual(['Coumadin (Warfarin)']);
    // Never blocking: only an allergy has no override (§7.5, UX §2.7).
    expect(result.warnings[0]?.blocking).toBe(false);
    expect(result.blocking).toBe(false);
  });

  it('appends the management advice and flags a high-alert partner', () => {
    const result = screenPrescription(
      subject({
        currentMedications: [warfarin],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'warning',
            title: 'Pair',
            detail: 'Mechanism.',
            management: 'Recheck INR.',
          },
        ],
      }),
    );

    expect(result.warnings[0]?.detail).toBe(
      'Mechanism. The patient is currently taking Coumadin (Warfarin), a high-alert medication. Recheck INR.',
    );
  });

  it('omits the management clause when the row has none', () => {
    const result = screenPrescription(
      subject({
        currentMedications: [medication({ isHighRisk: false })],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'info',
            title: 'Pair',
            detail: 'Mechanism.',
            management: null,
          },
        ],
      }),
    );

    expect(result.warnings[0]?.detail).toBe(
      'Mechanism. The patient is currently taking Coumadin (Warfarin).',
    );
  });

  it('raises one warning per interacting pair', () => {
    const levothyroxine = medication({
      prescriptionId: 'RX-200002',
      medicationId: 'med-eltroxin',
      name: 'Eltroxin',
      genericName: 'Levothyroxine',
      category: 'Thyroid',
      isHighRisk: false,
    });

    const result = screenPrescription(
      subject({
        currentMedications: [warfarin, levothyroxine],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'critical',
            title: 'A',
            detail: 'a.',
            management: null,
          },
          {
            partnerMedicationId: 'med-eltroxin',
            severity: 'info',
            title: 'B',
            detail: 'b.',
            management: null,
          },
        ],
      }),
    );

    // Collapsing them would have to pick one severity for both and lose
    // the per-pair management advice.
    expect(result.warnings.map((warning) => warning.title)).toEqual(['A', 'B']);
    expect(result.warnings.map((warning) => warning.id)).toEqual([
      'safety-interaction-med-warfarin',
      'safety-interaction-med-eltroxin',
    ]);
  });

  it('drops a finding whose partner is not on the current list', () => {
    // Guard, not a path: the repository only returns pairs drawn from
    // that list. Rendering it would produce "interacts with — ?".
    const result = screenPrescription(
      subject({
        currentMedications: [warfarin],
        interactions: [
          {
            partnerMedicationId: 'med-not-listed',
            severity: 'critical',
            title: 'Orphan',
            detail: 'x.',
            management: null,
          },
        ],
      }),
    );

    expect(result.warnings.filter((warning) => warning.kind === 'interaction')).toEqual([]);
  });

  it('reports nothing when the source found no pairs', () => {
    const result = screenPrescription(
      subject({ currentMedications: [warfarin], interactions: [] }),
    );

    expect(result.warnings.filter((warning) => warning.kind === 'interaction')).toEqual([]);
  });
});

describe('rule 3 — duplicate therapy', () => {
  it('grades an exact generic match critical, and does not block', () => {
    const result = screenPrescription(
      subject({
        currentMedications: [
          medication({
            prescriptionId: 'RX-200007',
            medicationId: 'med-other-amox',
            name: 'Trimox',
            genericName: 'Amoxicillin',
            category: 'Antibiotics',
            isHighRisk: false,
          }),
        ],
      }),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.kind).toBe('duplicate');
    expect(result.warnings[0]?.severity).toBe('critical');
    expect(result.warnings[0]?.blocking).toBe(false);
    expect(result.warnings[0]?.title).toBe('Duplicate therapy — Amoxicillin is already active');
    expect(result.warnings[0]?.detail).toContain('doubles the dose');
    expect(result.warnings[0]?.against).toEqual(['Trimox · RX-200007']);
    expect(result.blocking).toBe(false);
  });

  it('grades a same-class match warning', () => {
    const result = screenPrescription(
      subject({
        currentMedications: [
          medication({
            medicationId: 'med-other-antibiotic',
            name: 'Zithromax',
            genericName: 'Azithromycin',
            category: 'Antibiotics',
            isHighRisk: false,
          }),
        ],
      }),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.severity).toBe('warning');
    expect(result.warnings[0]?.title).toBe('Duplicate therapy — another antibiotics is active');
    expect(result.warnings[0]?.against).toEqual(['Zithromax (Azithromycin)']);
  });

  it('suppresses the class warning when the exact drug already matched', () => {
    // The specific finding wins; reporting both would put one
    // prescription in two warnings.
    const result = screenPrescription(
      subject({
        currentMedications: [
          medication({
            name: 'Trimox',
            genericName: 'Amoxicillin',
            category: 'Antibiotics',
            isHighRisk: false,
          }),
          medication({
            prescriptionId: 'RX-200008',
            medicationId: 'med-zith',
            name: 'Zithromax',
            genericName: 'Azithromycin',
            category: 'Antibiotics',
            isHighRisk: false,
          }),
        ],
      }),
    );

    const duplicates = result.warnings.filter((warning) => warning.kind === 'duplicate');
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.severity).toBe('critical');
  });

  it('lists every same-drug prescription in one warning', () => {
    const result = screenPrescription(
      subject({
        currentMedications: [
          medication({
            prescriptionId: 'RX-1',
            medicationId: 'a',
            name: 'Trimox',
            genericName: 'Amoxicillin',
            category: 'Antibiotics',
            isHighRisk: false,
          }),
          medication({
            prescriptionId: 'RX-2',
            medicationId: 'b',
            name: 'Amoxil',
            genericName: 'Amoxicillin',
            category: 'Antibiotics',
            isHighRisk: false,
          }),
        ],
      }),
    );

    expect(result.warnings[0]?.against).toEqual(['Trimox · RX-1', 'Amoxil · RX-2']);
  });

  it('reports nothing when nothing overlaps', () => {
    const result = screenPrescription(
      subject({
        currentMedications: [medication({ genericName: 'Warfarin', category: 'Anticoagulants' })],
      }),
    );

    expect(result.warnings.filter((warning) => warning.kind === 'duplicate')).toEqual([]);
  });

  it('reports nothing for an empty current list', () => {
    const result = screenPrescription(subject({ currentMedications: [] }));

    expect(result.warnings).toEqual([]);
  });
});

describe('composition and ordering', () => {
  it('announces the most severe finding first', () => {
    const result = screenPrescription(
      subject({
        allergies: [{ allergen: 'Penicillin', severity: 'mild' }],
        currentMedications: [
          medication({
            medicationId: 'med-zith',
            name: 'Zithromax',
            genericName: 'Azithromycin',
            category: 'Antibiotics',
            isHighRisk: false,
          }),
        ],
        interactions: [
          {
            partnerMedicationId: 'med-zith',
            severity: 'critical',
            title: 'Pair',
            detail: 'x.',
            management: null,
          },
        ],
      }),
    );

    // allergy is `warning` here (no severe allergy on file), the
    // interaction is `critical`, the class duplicate is `warning`.
    expect(result.warnings.map((warning) => warning.severity)).toEqual([
      'critical',
      'warning',
      'warning',
    ]);
    expect(result.warnings[0]?.kind).toBe('interaction');
    // Ties keep the source order — allergy before duplicate.
    expect(result.warnings[1]?.kind).toBe('allergy');
    expect(result.warnings[2]?.kind).toBe('duplicate');
  });

  it('blocks whenever an allergy is present, whatever else is found', () => {
    const result = screenPrescription(
      subject({
        allergies: [{ allergen: 'Penicillin', severity: 'severe' }],
        currentMedications: [medication()],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'info',
            title: 'Pair',
            detail: 'x.',
            management: null,
          },
        ],
      }),
    );

    expect(result.blocking).toBe(true);
  });

  it('never raises a dosage warning — no source states a dosing rule', () => {
    // The enum has a fourth kind and API §7.5 lists it. Implementing it
    // would mean inventing a threshold nobody clinically approved. See
    // the "what is NOT screened" note in `safety-screen.ts` and PD-13.2.
    const result = screenPrescription(
      subject({
        allergies: [{ allergen: 'Penicillin', severity: 'severe' }],
        currentMedications: [medication()],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'critical',
            title: 'Pair',
            detail: 'x.',
            management: null,
          },
        ],
      }),
    );

    expect(result.warnings.some((warning) => warning.kind === 'dosage')).toBe(false);
  });
});

describe('the selectors M13.3 signs against', () => {
  it('requires acknowledgment for everything above info that is not blocking', () => {
    const warnings = screenPrescription(
      subject({
        currentMedications: [medication()],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'critical',
            title: 'Pair',
            detail: 'x.',
            management: null,
          },
        ],
      }),
    ).warnings;

    expect(warningsNeedingAcknowledgment(warnings).map((warning) => warning.id)).toEqual([
      'safety-interaction-med-warfarin',
    ]);
  });

  it('excludes an `info` finding from the tick list', () => {
    const warnings = screenPrescription(
      subject({
        currentMedications: [medication({ isHighRisk: false })],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'info',
            title: 'Pair',
            detail: 'x.',
            management: null,
          },
        ],
      }),
    ).warnings;

    expect(warningsNeedingAcknowledgment(warnings)).toEqual([]);
  });

  it('excludes a blocking warning from the tick list', () => {
    // A tick box for an allergy would suggest the prescription becomes
    // signable. It never does.
    const warnings = screenPrescription(
      subject({ allergies: [{ allergen: 'Penicillin', severity: 'severe' }] }),
    ).warnings;

    expect(warningsNeedingAcknowledgment(warnings)).toEqual([]);
    expect(blockingWarnings(warnings).map((warning) => warning.id)).toEqual(['safety-allergy']);
  });

  it('reports no blocking warnings on a clear screen', () => {
    expect(blockingWarnings(screenPrescription(subject()).warnings)).toEqual([]);
  });
});

describe('legacy rows — the prescription-safety exception (owner decision 2026-11-24)', () => {
  const MARK = `(${LEGACY_MARK})`;

  it('blocks on a legacy allergy exactly as on any other, and names it as legacy', () => {
    const result = screenPrescription(
      subject({ allergies: [{ allergen: 'Penicillin', severity: 'severe', legacy: true }] }),
    );

    expect(result.blocking).toBe(true);
    expect(result.warnings[0]?.kind).toBe('allergy');
    expect(result.warnings[0]?.severity).toBe('critical');
    expect(result.warnings[0]?.against).toEqual([`Recorded allergy: Penicillin ${MARK}`]);
    expect(result.warnings[0]?.detail).toContain(`Penicillin ${MARK}`);
  });

  it('marks only the legacy allergy when an owned one matches too', () => {
    const result = screenPrescription(
      subject({
        allergies: [
          { allergen: 'Penicillin', severity: 'moderate' },
          { allergen: 'Amoxicillin', severity: 'mild', legacy: true },
        ],
      }),
    );

    expect(result.warnings[0]?.against).toEqual([
      'Recorded allergy: Penicillin',
      `Recorded allergy: Amoxicillin ${MARK}`,
    ]);
  });

  it('names a legacy interaction partner as legacy', () => {
    const result = screenPrescription(
      subject({
        currentMedications: [medication({ legacy: true })],
        interactions: [
          {
            partnerMedicationId: 'med-warfarin',
            severity: 'critical',
            title: 'Warfarin × Amoxicillin',
            detail: 'Broad-spectrum antibiotics raise INR.',
            management: null,
          },
        ],
      }),
    );

    expect(result.warnings[0]?.against).toEqual([`Coumadin (Warfarin) ${MARK}`]);
    expect(result.warnings[0]?.detail).toContain(MARK);
  });

  it('names a legacy duplicate — exact and same-class — as legacy', () => {
    const exact = screenPrescription(
      subject({
        currentMedications: [
          medication({
            medicationId: 'med-amoxil-2',
            name: 'Amoxil',
            genericName: 'Amoxicillin',
            legacy: true,
          }),
        ],
      }),
    );
    expect(exact.warnings[0]?.against).toEqual([`Amoxil · RX-200001 ${MARK}`]);

    const sameClass = screenPrescription(
      subject({
        currentMedications: [
          medication({
            medicationId: 'med-augmentin',
            name: 'Augmentin',
            genericName: 'Co-amoxiclav',
            category: 'Antibiotics',
            legacy: true,
          }),
        ],
      }),
    );
    expect(sameClass.warnings[0]?.against).toEqual([`Augmentin (Co-amoxiclav) ${MARK}`]);
  });
});
