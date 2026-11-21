/**
 * The clinical catalogues (RM M5.5).
 *
 * Transcribed from the two frontend catalogue modules, both of which
 * carry the same comment: "Replaced by the catalogue/formulary endpoint
 * when the API lands." This is that endpoint's data.
 *
 * Sources:
 *   · `frontend/src/features/doctor/labs/model/catalogue.ts` (`TEST_CATALOGUE`)
 *   · `frontend/src/features/doctor/pharmacy/model/catalogue.ts` (`MEDICATION_CATALOGUE`)
 *   · `frontend/src/features/doctor/ai/model/prompts.ts` (`AI_PROMPTS`)
 *
 * Transcribed rather than imported, for the reason the permission seed
 * gives: the backend does not depend on the frontend package, and a seed
 * reading its expectations from the thing it seeds cannot fail.
 */

export interface AnalyteSeed {
  readonly analyte: string;
  readonly unit: string;
  readonly refLow: number | null;
  readonly refHigh: number | null;
  readonly decimals?: number;
  readonly criticalLow?: number;
  readonly criticalHigh?: number;
  readonly qualitativeOptions?: readonly string[];
}

export interface LabTestSeed {
  readonly name: string;
  readonly code: string;
  readonly category: string;
  readonly specimenType: string;
  readonly container: string;
  readonly analytes: readonly AnalyteSeed[];
}

/** DB §5 — the five seed tests, with their LOINC codes. */
export const LAB_TESTS: readonly LabTestSeed[] = [
  {
    name: 'Complete Blood Count (CBC)',
    code: '58410-2',
    category: 'HEMATOLOGY',
    specimenType: 'WHOLE_BLOOD',
    container: 'EDTA (lavender top)',
    analytes: [
      { analyte: 'WBC', unit: '10³/µL', refLow: 4, refHigh: 11, decimals: 1, criticalLow: 2, criticalHigh: 30 },
      { analyte: 'RBC', unit: '10⁶/µL', refLow: 4.2, refHigh: 5.9, decimals: 2 },
      { analyte: 'Hemoglobin', unit: 'g/dL', refLow: 12, refHigh: 17, decimals: 1, criticalLow: 7, criticalHigh: 20 },
      { analyte: 'Hematocrit', unit: '%', refLow: 36, refHigh: 50, decimals: 1 },
      { analyte: 'Platelets', unit: '10³/µL', refLow: 150, refHigh: 400, decimals: 0, criticalLow: 50, criticalHigh: 1000 },
    ],
  },
  {
    name: 'Hemoglobin A1c',
    code: '4548-4',
    category: 'HEMATOLOGY',
    specimenType: 'WHOLE_BLOOD',
    container: 'EDTA (lavender top)',
    analytes: [{ analyte: 'HbA1c', unit: '%', refLow: 4, refHigh: 5.6, decimals: 1, criticalHigh: 10 }],
  },
  {
    name: 'Basic Metabolic Panel',
    code: '51990-0',
    category: 'CHEMISTRY',
    specimenType: 'SERUM',
    container: 'SST (gold top)',
    analytes: [
      { analyte: 'Sodium', unit: 'mmol/L', refLow: 135, refHigh: 145, decimals: 0, criticalLow: 120, criticalHigh: 160 },
      { analyte: 'Potassium', unit: 'mmol/L', refLow: 3.5, refHigh: 5.1, decimals: 1, criticalLow: 2.5, criticalHigh: 6.0 },
      { analyte: 'Chloride', unit: 'mmol/L', refLow: 98, refHigh: 107, decimals: 0 },
      { analyte: 'Glucose', unit: 'mg/dL', refLow: 70, refHigh: 99, decimals: 0, criticalLow: 40, criticalHigh: 500 },
      { analyte: 'Creatinine', unit: 'mg/dL', refLow: 0.6, refHigh: 1.3, decimals: 2, criticalHigh: 7 },
      { analyte: 'BUN', unit: 'mg/dL', refLow: 7, refHigh: 20, decimals: 0 },
    ],
  },
  {
    name: 'Lipid Panel',
    code: '57698-3',
    category: 'CHEMISTRY',
    specimenType: 'SERUM',
    container: 'SST (gold top)',
    analytes: [
      { analyte: 'Total cholesterol', unit: 'mg/dL', refLow: 125, refHigh: 200, decimals: 0 },
      { analyte: 'LDL cholesterol', unit: 'mg/dL', refLow: 0, refHigh: 100, decimals: 0 },
      { analyte: 'HDL cholesterol', unit: 'mg/dL', refLow: 40, refHigh: 90, decimals: 0 },
      { analyte: 'Triglycerides', unit: 'mg/dL', refLow: 0, refHigh: 150, decimals: 0, criticalHigh: 1000 },
    ],
  },
  {
    name: 'Thyroid Panel',
    code: '55204-3',
    category: 'HORMONES',
    specimenType: 'SERUM',
    container: 'SST (gold top)',
    analytes: [
      { analyte: 'TSH', unit: 'mIU/L', refLow: 0.4, refHigh: 4, decimals: 2, criticalHigh: 50 },
      { analyte: 'Free T4', unit: 'ng/dL', refLow: 0.8, refHigh: 1.8, decimals: 1 },
      { analyte: 'Free T3', unit: 'pg/mL', refLow: 2.3, refHigh: 4.2, decimals: 1 },
    ],
  },
];

export interface MedicationSeed {
  readonly name: string;
  readonly genericName: string;
  readonly category: string;
  readonly form: string;
  readonly route: string;
  readonly strengths: readonly string[];
  readonly manufacturer: string;
  readonly isControlled: boolean;
  readonly isHighRisk: boolean;
  readonly interactionNote: string | null;
  readonly allergyClass: string | null;
  readonly frequencies: readonly string[];
  readonly durationsDays: readonly number[];
}

const CHRONIC = [30, 60, 90];
const COURSE = [5, 7, 10, 14];

/** DB §5 — the five seed medications. */
export const MEDICATIONS: readonly MedicationSeed[] = [
  {
    name: 'Amoxil',
    genericName: 'Amoxicillin',
    category: 'ANTIBIOTICS',
    form: 'CAPSULE',
    route: 'ORAL',
    strengths: ['250 mg', '500 mg'],
    manufacturer: 'GSK',
    isControlled: false,
    isHighRisk: false,
    interactionNote: 'May reduce the efficacy of oral contraceptives.',
    allergyClass: 'Penicillin',
    frequencies: ['Twice daily', 'Three times daily'],
    durationsDays: COURSE,
  },
  {
    name: 'Glucophage',
    genericName: 'Metformin',
    category: 'ANTIDIABETICS',
    form: 'TABLET',
    route: 'ORAL',
    strengths: ['500 mg', '850 mg', '1 g'],
    manufacturer: 'Merck',
    isControlled: false,
    isHighRisk: false,
    interactionNote: 'Withhold before iodinated contrast; lactic-acidosis risk.',
    allergyClass: null,
    frequencies: ['Twice daily', 'Three times daily'],
    durationsDays: CHRONIC,
  },
  {
    name: 'Lipitor',
    genericName: 'Atorvastatin',
    category: 'LIPID_LOWERING',
    form: 'TABLET',
    route: 'ORAL',
    strengths: ['10 mg', '20 mg', '40 mg', '80 mg'],
    manufacturer: 'Pfizer',
    isControlled: false,
    isHighRisk: false,
    interactionNote: 'Myopathy risk with macrolides and fibrates.',
    allergyClass: null,
    frequencies: ['Once daily at night'],
    durationsDays: CHRONIC,
  },
  {
    name: 'Coumadin',
    genericName: 'Warfarin',
    category: 'ANTICOAGULANTS',
    form: 'TABLET',
    route: 'ORAL',
    strengths: ['1 mg', '3 mg', '5 mg'],
    manufacturer: 'BMS',
    isControlled: false,
    isHighRisk: true,
    interactionNote: 'Numerous interactions; INR monitoring required.',
    allergyClass: null,
    frequencies: ['Once daily'],
    durationsDays: CHRONIC,
  },
  {
    name: 'Eltroxin',
    genericName: 'Levothyroxine',
    category: 'THYROID',
    form: 'TABLET',
    route: 'ORAL',
    strengths: ['50 mcg', '100 mcg'],
    manufacturer: 'Aspen',
    isControlled: false,
    isHighRisk: false,
    interactionNote: 'Absorption reduced by calcium and iron; separate dosing.',
    allergyClass: null,
    frequencies: ['Once daily before breakfast'],
    durationsDays: CHRONIC,
  },
];

/**
 * Pairwise interactions among the seeded formulary (ADR-010 group 8).
 *
 * Named by generic, because that is what interacts — the brand is
 * packaging. Each pair is normalized to a single ordered row by the
 * seeder, matching the `drug_interactions_pair_ordered` constraint.
 *
 * These four are the interactions the seeded medications' own
 * `interaction_note` strings already assert; nothing is invented. The
 * table's value over those strings is that a severity attaches to the
 * *pair* rather than to one drug, which is what RM M13.2's graded screen
 * needs.
 */
export interface InteractionSeed {
  readonly a: string;
  readonly b: string;
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
  readonly title: string;
  readonly detail: string;
  readonly management: string;
}

export const DRUG_INTERACTIONS: readonly InteractionSeed[] = [
  {
    a: 'Warfarin',
    b: 'Amoxicillin',
    severity: 'CRITICAL',
    title: 'Warfarin × Amoxicillin',
    detail:
      'Broad-spectrum antibiotics reduce vitamin-K-producing gut flora and displace warfarin, raising INR and bleeding risk.',
    management: 'Check INR within 3–5 days of starting and after stopping the antibiotic.',
  },
  {
    a: 'Warfarin',
    b: 'Levothyroxine',
    severity: 'WARNING',
    title: 'Warfarin × Levothyroxine',
    detail: 'Thyroid hormone increases the catabolism of clotting factors, potentiating warfarin.',
    management: 'Monitor INR after any levothyroxine dose change.',
  },
  {
    a: 'Atorvastatin',
    b: 'Warfarin',
    severity: 'WARNING',
    title: 'Atorvastatin × Warfarin',
    detail: 'Reported INR elevation on co-administration; both compete for hepatic metabolism.',
    management: 'Recheck INR after initiation or dose change.',
  },
  {
    a: 'Levothyroxine',
    b: 'Metformin',
    severity: 'INFO',
    title: 'Levothyroxine × Metformin',
    detail: 'Levothyroxine may reduce the glucose-lowering effect of metformin.',
    management: 'Monitor glycaemic control when thyroid replacement starts.',
  },
];

export interface PromptSeed {
  readonly slug: string;
  readonly label: string;
  readonly description: string;
  readonly promptText: string;
  readonly contextMode: string;
}

/** DB §H4 — the six prompt cards of `AI_PROMPTS`. */
export const AI_PROMPTS: readonly PromptSeed[] = [
  {
    slug: 'summarize-patient',
    label: 'Summarize patient',
    description: 'One-paragraph clinical summary with problems, medications, and risks.',
    promptText:
      'Summarize this patient: active problems, current medications, allergies, and key risks.',
    contextMode: 'PATIENT',
  },
  {
    slug: 'explain-labs',
    label: 'Explain lab results',
    description: 'Plain-language interpretation of the attached laboratory results.',
    promptText: 'Explain these lab results, flag anything abnormal, and suggest sensible next steps.',
    contextMode: 'LABS',
  },
  {
    slug: 'drug-interactions',
    label: 'Drug interaction checker',
    description: 'Screen the medication list for interactions and cumulative risks.',
    promptText:
      'Check the current medication list for drug–drug interactions and high-risk combinations.',
    contextMode: 'PHARMACY',
  },
  {
    slug: 'differential-diagnosis',
    label: 'Suggest differential diagnosis',
    description: 'Ranked differentials for the documented presentation.',
    promptText:
      'Suggest a ranked differential diagnosis for the documented presentation, with reasoning.',
    contextMode: 'RECORD',
  },
  {
    slug: 'review-medications',
    label: 'Review medications',
    description: 'Appropriateness, dosing, duplications, and deprescribing opportunities.',
    promptText:
      'Review the medication regimen for appropriateness, dosing, duplication, and deprescribing options.',
    contextMode: 'PHARMACY',
  },
  {
    slug: 'explain-imaging',
    label: 'Explain imaging findings',
    description: 'Break an imaging report down into findings and implications.',
    promptText: 'Explain the imaging findings in this record and what follow-up they usually warrant.',
    contextMode: 'RECORD',
  },
];
