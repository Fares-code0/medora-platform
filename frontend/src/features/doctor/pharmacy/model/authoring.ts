import type { Patient } from '@/features/shared-domain/patient-identity';

import type { Formulary, MedicationSpec } from './catalogue';
import type { MedicationRoute, PrescriptionPatientSnapshot } from './types';

/**
 * Prescription authoring — the draft, the four steps, and the rules that
 * decide which of them a doctor may stand on (D-17, UX §2.7).
 *
 * Everything here is pure. The step machine is a function of the draft, not
 * of component state, so "can I reach Review?" has exactly one answer and it
 * is answerable in a unit test. The safety gate that also guards Review lives
 * in `safety-check.ts`; this module deliberately knows nothing about it, and
 * `canAdvanceTo` takes the verdict's outcome as an argument rather than
 * computing it, so neither module can drift into a second opinion.
 */

/* ── Steps ──────────────────────────────────────────────────────── */

export type AuthoringStepId = 'patient' | 'medication' | 'dosage' | 'review';

export interface AuthoringStepMeta {
  readonly id: AuthoringStepId;
  readonly label: string;
  readonly caption: string;
}

export const AUTHORING_STEPS: readonly AuthoringStepMeta[] = [
  { id: 'patient', label: 'Patient', caption: 'Who is this prescription for?' },
  { id: 'medication', label: 'Medication', caption: 'Choose the drug and strength.' },
  { id: 'dosage', label: 'Dosage', caption: 'Dose, schedule, duration, and instructions.' },
  { id: 'review', label: 'Review & sign', caption: 'Confirm the safety screen, then sign.' },
];

export const AUTHORING_STEP_IDS: readonly AuthoringStepId[] = AUTHORING_STEPS.map(
  (step) => step.id,
);

export function stepIndex(step: AuthoringStepId): number {
  return AUTHORING_STEP_IDS.indexOf(step);
}

/** The step before `step`, or null at the start of the flow. */
export function previousStep(step: AuthoringStepId): AuthoringStepId | null {
  return AUTHORING_STEP_IDS[stepIndex(step) - 1] ?? null;
}

/** The step after `step`, or null at the end of the flow. */
export function nextStep(step: AuthoringStepId): AuthoringStepId | null {
  return AUTHORING_STEP_IDS[stepIndex(step) + 1] ?? null;
}

/* ── The draft ──────────────────────────────────────────────────── */

export interface DraftMedication {
  /** Generic name — the catalogue's primary key. */
  readonly genericName: string;
  readonly strength: string;
}

export interface DraftDosage {
  readonly frequency: string | null;
  readonly durationDays: number | null;
  readonly quantity: number | null;
  readonly refillsAllowed: number;
  readonly instructions: string;
}

export const EMPTY_DOSAGE: DraftDosage = {
  frequency: null,
  durationDays: null,
  quantity: null,
  refillsAllowed: 0,
  instructions: '',
};

export type DraftOrigin = 'new' | 'renewal';

export interface PrescriptionDraft {
  readonly id: string;
  readonly patient: PrescriptionPatientSnapshot | null;
  readonly medication: DraftMedication | null;
  readonly dosage: DraftDosage;
  readonly origin: DraftOrigin;
  /** Set when the draft was opened by renewing an existing prescription. */
  readonly renewedFrom: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function emptyDraft(id: string, now: string): PrescriptionDraft {
  return {
    id,
    patient: null,
    medication: null,
    dosage: EMPTY_DOSAGE,
    origin: 'new',
    renewedFrom: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** The patient as a prescription carries them, from the patient directory. */
export function toPrescriptionPatient(patient: Patient): PrescriptionPatientSnapshot {
  return {
    id: patient.id,
    name: patient.name,
    mrn: patient.mrn,
    age: patient.age,
    gender: patient.gender,
    bloodType: patient.bloodType,
    phone: patient.phone,
    allergies: patient.allergies,
    hasSevereAllergy: patient.hasSevereAllergy,
  };
}

/* ── Formulary lookup ───────────────────────────────────────────── */

/**
 * A medication by generic name, in the formulary the caller holds — the
 * service's (`PrescriptionService.listMedications`), never an implicit
 * default, so a live screen cannot validate against the demo catalogue.
 */
export function findMedicationSpec(
  genericName: string,
  formulary: Formulary,
): MedicationSpec | null {
  return formulary.find((candidate) => candidate.genericName === genericName) ?? null;
}

/** The route a medication is given by; the catalogue owns it, not the doctor. */
export function draftRoute(draft: PrescriptionDraft, formulary: Formulary): MedicationRoute | null {
  const spec = draft.medication ? findMedicationSpec(draft.medication.genericName, formulary) : null;
  return spec?.route ?? null;
}

/**
 * Doses per day, read off the frequency phrase the catalogue supplies.
 * Used to propose a quantity; the doctor can always override it.
 */
export function dosesPerDay(frequency: string): number {
  const phrase = frequency.toLowerCase();
  if (phrase.includes('four')) return 4;
  if (phrase.includes('three')) return 3;
  if (phrase.includes('twice')) return 2;
  return 1;
}

export function suggestedQuantity(frequency: string, durationDays: number): number {
  return dosesPerDay(frequency) * durationDays;
}

export function suggestedInstructions(
  spec: MedicationSpec,
  strength: string,
  frequency: string,
): string {
  const verb = spec.route === 'Inhalation' ? 'Inhale' : spec.route === 'Oral' ? 'Take' : 'Administer';
  const via =
    spec.route === 'Oral' ? ' by mouth' : spec.route === 'Inhalation' ? '' : ` (${spec.route.toLowerCase()})`;
  return `${verb} ${strength}, ${frequency.toLowerCase()}${via}.`;
}

/* ── Per-step validation ────────────────────────────────────────── */

export interface FieldIssue {
  /** Field key, so a step can put the message on the control that owns it. */
  readonly field: string;
  readonly message: string;
}

export interface StepValidation {
  readonly step: AuthoringStepId;
  readonly issues: readonly FieldIssue[];
  readonly valid: boolean;
}

const MAX_DURATION_DAYS = 365;
const MAX_QUANTITY = 1000;
const MAX_REFILLS = 11;

function validatePatient(draft: PrescriptionDraft): readonly FieldIssue[] {
  if (draft.patient === null) {
    return [{ field: 'patient', message: 'Select the patient this prescription is for.' }];
  }
  return [];
}

function validateMedication(draft: PrescriptionDraft, formulary: Formulary): readonly FieldIssue[] {
  const { medication } = draft;
  if (medication === null) {
    return [{ field: 'medication', message: 'Choose a medication from the formulary.' }];
  }

  const spec = findMedicationSpec(medication.genericName, formulary);
  if (spec === null) {
    return [{ field: 'medication', message: 'That medication is not in the formulary.' }];
  }
  if (!spec.strengths.includes(medication.strength)) {
    return [{ field: 'strength', message: `Choose a strength stocked for ${spec.name}.` }];
  }
  return [];
}

function validateDosage(draft: PrescriptionDraft, formulary: Formulary): readonly FieldIssue[] {
  const issues: FieldIssue[] = [];
  const spec = draft.medication ? findMedicationSpec(draft.medication.genericName, formulary) : null;
  const { frequency, durationDays, quantity, refillsAllowed, instructions } = draft.dosage;

  if (frequency === null || frequency.trim() === '') {
    issues.push({ field: 'frequency', message: 'Choose how often the patient takes it.' });
  } else if (spec !== null && !spec.frequencies.includes(frequency)) {
    issues.push({ field: 'frequency', message: `That schedule is not listed for ${spec.name}.` });
  }

  if (durationDays === null) {
    issues.push({ field: 'durationDays', message: 'Set a duration in days.' });
  } else if (!Number.isInteger(durationDays) || durationDays < 1) {
    issues.push({ field: 'durationDays', message: 'Duration must be at least one whole day.' });
  } else if (durationDays > MAX_DURATION_DAYS) {
    issues.push({ field: 'durationDays', message: 'Duration cannot exceed 365 days.' });
  }

  if (quantity === null) {
    issues.push({ field: 'quantity', message: 'Set the quantity to dispense.' });
  } else if (!Number.isInteger(quantity) || quantity < 1) {
    issues.push({ field: 'quantity', message: 'Quantity must be a whole number of at least 1.' });
  } else if (quantity > MAX_QUANTITY) {
    issues.push({ field: 'quantity', message: 'Quantity cannot exceed 1000 units.' });
  }

  if (!Number.isInteger(refillsAllowed) || refillsAllowed < 0 || refillsAllowed > MAX_REFILLS) {
    issues.push({ field: 'refillsAllowed', message: 'Refills must be between 0 and 11.' });
  } else if (refillsAllowed > 0 && spec?.isControlled === true) {
    issues.push({
      field: 'refillsAllowed',
      message: 'A controlled medication cannot carry refills.',
    });
  }

  if (instructions.trim() === '') {
    issues.push({ field: 'instructions', message: 'Write plain-language instructions for the patient.' });
  }

  return issues;
}

/** Review carries no fields of its own; its gate is the safety verdict. */
export function validateStep(
  draft: PrescriptionDraft,
  step: AuthoringStepId,
  formulary: Formulary,
): StepValidation {
  const issues =
    step === 'patient'
      ? validatePatient(draft)
      : step === 'medication'
        ? validateMedication(draft, formulary)
        : step === 'dosage'
          ? validateDosage(draft, formulary)
          : [];
  return { step, issues, valid: issues.length === 0 };
}

export function validateAllSteps(
  draft: PrescriptionDraft,
  formulary: Formulary,
): Readonly<Record<AuthoringStepId, StepValidation>> {
  return {
    patient: validateStep(draft, 'patient', formulary),
    medication: validateStep(draft, 'medication', formulary),
    dosage: validateStep(draft, 'dosage', formulary),
    review: validateStep(draft, 'review', formulary),
  };
}

/* ── The step machine ───────────────────────────────────────────── */

export type StepBlock =
  | { readonly kind: 'invalid-step'; readonly step: AuthoringStepId }
  | { readonly kind: 'safety-not-cleared' };

export type StepTransition =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly blockedBy: StepBlock };

const ALLOWED: StepTransition = { allowed: true };

/**
 * May the flow stand on `target`?
 *
 * Backwards is always allowed — the draft is preserved, so returning to an
 * earlier step is how a doctor fixes what a later step objected to. Forwards
 * requires every earlier step to validate, and Review additionally requires a
 * *completed* safety verdict. `safetyCleared` is false for "not run yet",
 * "still running", and every failure alike: this function has no notion of a
 * check that half-succeeded.
 */
export function canAdvanceTo(
  draft: PrescriptionDraft,
  from: AuthoringStepId,
  target: AuthoringStepId,
  options: { readonly safetyCleared: boolean; readonly formulary: Formulary },
): StepTransition {
  if (stepIndex(target) <= stepIndex(from)) return ALLOWED;

  for (const step of AUTHORING_STEP_IDS.slice(0, stepIndex(target))) {
    const validation = validateStep(draft, step, options.formulary);
    if (!validation.valid) return { allowed: false, blockedBy: { kind: 'invalid-step', step } };
  }

  if (target === 'review' && !options.safetyCleared) {
    return { allowed: false, blockedBy: { kind: 'safety-not-cleared' } };
  }

  return ALLOWED;
}

/** The furthest step the draft alone justifies, ignoring the safety gate. */
export function furthestValidStep(draft: PrescriptionDraft, formulary: Formulary): AuthoringStepId {
  for (const step of AUTHORING_STEP_IDS) {
    if (!validateStep(draft, step, formulary).valid) return step;
  }
  return 'review';
}

/**
 * The draft with every field a prescription needs — the shape the safety
 * check and the signature both consume. Produced only by `completeDraft`,
 * so "validated" and "complete" cannot diverge.
 */
export interface CompleteDraft {
  readonly id: string;
  readonly patient: PrescriptionPatientSnapshot;
  readonly spec: MedicationSpec;
  readonly strength: string;
  readonly frequency: string;
  readonly durationDays: number;
  readonly quantity: number;
  readonly refillsAllowed: number;
  readonly instructions: string;
  readonly renewedFrom: string | null;
}

/** Narrows a draft to `CompleteDraft`, or null if any step still objects. */
export function completeDraft(
  draft: PrescriptionDraft,
  formulary: Formulary,
): CompleteDraft | null {
  const patientValid = validateStep(draft, 'patient', formulary).valid;
  const medicationValid = validateStep(draft, 'medication', formulary).valid;
  const dosageValid = validateStep(draft, 'dosage', formulary).valid;
  if (!patientValid || !medicationValid || !dosageValid) return null;

  const { patient, medication, dosage } = draft;
  const spec = medication ? findMedicationSpec(medication.genericName, formulary) : null;
  if (patient === null || medication === null || spec === null) return null;
  if (dosage.frequency === null || dosage.durationDays === null || dosage.quantity === null) {
    return null;
  }

  return {
    id: draft.id,
    patient,
    spec,
    strength: medication.strength,
    frequency: dosage.frequency,
    durationDays: dosage.durationDays,
    quantity: dosage.quantity,
    refillsAllowed: dosage.refillsAllowed,
    instructions: dosage.instructions.trim(),
    renewedFrom: draft.renewedFrom,
  };
}
