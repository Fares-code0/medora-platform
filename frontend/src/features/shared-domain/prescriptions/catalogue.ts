import type { MedicationCategory, MedicationForm, MedicationRoute } from './types';

/**
 * Medication catalogue — five representative medications behind the mock
 * generator (Phase 12 trimmed the demo formulary; the shape is
 * unchanged). Each entry carries its generic name, category, form,
 * route, strengths, manufacturer, and the controlled/high-risk flags
 * plus a canned interaction note and allergy class used to synthesize
 * the frontend safety-warning placeholders. Replaced by the formulary
 * endpoint when the API lands.
 */

export interface MedicationSpec {
  /**
   * The formulary's own id for this medication — what the safety screen
   * and the prescription are keyed by on the server (API §7.1). The demo
   * catalogue's ids are its own and mean nothing to any server.
   */
  readonly id: string;
  readonly name: string;
  readonly genericName: string;
  readonly category: MedicationCategory;
  readonly form: MedicationForm;
  readonly route: MedicationRoute;
  readonly strengths: readonly string[];
  readonly manufacturer: string;
  readonly isControlled: boolean;
  readonly isHighRisk: boolean;
  readonly interactionNote: string | null;
  readonly allergyClass: string | null;
  readonly frequencies: readonly string[];
  readonly durationsDays: readonly number[];
}

/** The medications a doctor may choose from, as one service returned them. */
export type Formulary = readonly MedicationSpec[];

/**
 * A medication's prescribing reference (API §7.2) — read-only text the
 * formulary holds beside the entry. Every section is nullable because the
 * source may simply not record it, and "not recorded" must read as that,
 * never as an empty paragraph a doctor could mistake for "none".
 */
export interface MedicationMonograph {
  readonly medicationId: string;
  readonly name: string;
  readonly genericName: string;
  readonly indications: string | null;
  readonly contraindications: string | null;
  readonly standardDosing: string | null;
  /** A, B, C, D or X — a single letter, never prose (DB §F8). */
  readonly pregnancyCategory: string | null;
  readonly warnings: string | null;
  readonly sideEffects: string | null;
}

const CHRONIC = [30, 60, 90] as const;
const COURSE = [5, 7, 10, 14] as const;

export const MEDICATION_CATALOGUE: readonly MedicationSpec[] = [
  {
    id: 'demo-amoxicillin',
    name: 'Amoxil',
    genericName: 'Amoxicillin',
    category: 'Antibiotics',
    form: 'Capsule',
    route: 'Oral',
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
    id: 'demo-metformin',
    name: 'Glucophage',
    genericName: 'Metformin',
    category: 'Antidiabetics',
    form: 'Tablet',
    route: 'Oral',
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
    id: 'demo-atorvastatin',
    name: 'Lipitor',
    genericName: 'Atorvastatin',
    category: 'Lipid-lowering',
    form: 'Tablet',
    route: 'Oral',
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
    id: 'demo-warfarin',
    name: 'Coumadin',
    genericName: 'Warfarin',
    category: 'Anticoagulants',
    form: 'Tablet',
    route: 'Oral',
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
    id: 'demo-levothyroxine',
    name: 'Eltroxin',
    genericName: 'Levothyroxine',
    category: 'Thyroid',
    form: 'Tablet',
    route: 'Oral',
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
