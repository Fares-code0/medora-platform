import type { Patient } from '@/features/shared-domain/patient-identity';

import { DIAGNOSES, type RecordDiagnosis, type RecordPatientSnapshot } from './types';

/**
 * Record authoring — the draft, the four steps, and the rules that decide
 * which of them a doctor may stand on (D-21).
 *
 * Everything here is pure, and the step machine is a function of the draft
 * rather than of component state, so "can I reach Review?" has exactly one
 * answer. This is the shape `pharmacy/model/authoring.ts` established; the
 * differences are the domain's, not the pattern's.
 */

/* ── Steps ──────────────────────────────────────────────────────── */

export type RecordStepId = 'patient' | 'visit' | 'clinical' | 'review';

export interface RecordStepMeta {
  readonly id: RecordStepId;
  readonly label: string;
  readonly caption: string;
}

export const RECORD_STEPS: readonly RecordStepMeta[] = [
  { id: 'patient', label: 'Patient', caption: 'Who was seen?' },
  { id: 'visit', label: 'Encounter', caption: 'Date, type, department, and findings.' },
  { id: 'clinical', label: 'Clinical', caption: 'Vitals, diagnoses, and the note.' },
  { id: 'review', label: 'Review & sign', caption: 'Check it, then sign the note.' },
];

export const RECORD_STEP_IDS: readonly RecordStepId[] = RECORD_STEPS.map((step) => step.id);

export function recordStepIndex(step: RecordStepId): number {
  return RECORD_STEP_IDS.indexOf(step);
}

export function previousRecordStep(step: RecordStepId): RecordStepId | null {
  return RECORD_STEP_IDS[recordStepIndex(step) - 1] ?? null;
}

export function nextRecordStep(step: RecordStepId): RecordStepId | null {
  return RECORD_STEP_IDS[recordStepIndex(step) + 1] ?? null;
}

/* ── Vitals ─────────────────────────────────────────────────────── */

/**
 * Vitals as they are *entered*: every field nullable, because a half-filled
 * vitals panel is a normal intermediate state and `0` is a real measurement
 * that must not stand in for "not recorded".
 *
 * BMI is absent on purpose — it is derived (see `bmiFor`). A hand-entered BMI
 * is a number that can disagree with the height and weight beside it, and
 * there is no reading of the record that makes the typed one right.
 */
export interface DraftVitals {
  readonly bloodPressure: string;
  readonly heartRateBpm: number | null;
  readonly temperatureC: number | null;
  readonly respiratoryRate: number | null;
  readonly oxygenSaturation: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
}

export const EMPTY_VITALS: DraftVitals = {
  bloodPressure: '',
  heartRateBpm: null,
  temperatureC: null,
  respiratoryRate: null,
  oxygenSaturation: null,
  weightKg: null,
  heightCm: null,
};

/**
 * Plausibility bounds, not reference ranges. They exist to catch a typo — a
 * heart rate of 720, a temperature entered in Fahrenheit — and deliberately
 * span far wider than "normal", because a record must be able to hold a
 * genuinely alarming value. Anything inside these bounds is accepted without
 * comment; the clinical reading is the doctor's, not the form's.
 */
export const VITALS_BOUNDS = {
  heartRateBpm: { min: 20, max: 300, label: 'Heart rate', unit: 'bpm' },
  temperatureC: { min: 25, max: 45, label: 'Temperature', unit: '°C' },
  respiratoryRate: { min: 4, max: 80, label: 'Respiratory rate', unit: '/min' },
  oxygenSaturation: { min: 40, max: 100, label: 'Oxygen saturation', unit: '%' },
  weightKg: { min: 1, max: 400, label: 'Weight', unit: 'kg' },
  heightCm: { min: 30, max: 250, label: 'Height', unit: 'cm' },
} as const satisfies Record<
  keyof Omit<DraftVitals, 'bloodPressure'>,
  { readonly min: number; readonly max: number; readonly label: string; readonly unit: string }
>;

export type VitalsField = keyof typeof VITALS_BOUNDS;

/** `120/80` — two positive integers, systolic above diastolic. */
export const BLOOD_PRESSURE_PATTERN = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/;

export function isValidBloodPressure(value: string): boolean {
  const match = BLOOD_PRESSURE_PATTERN.exec(value);
  if (match === null) return false;
  const systolic = Number(match[1]);
  const diastolic = Number(match[2]);
  return systolic > diastolic && systolic <= 300 && diastolic >= 20;
}

/** The out-of-bounds fields, so the form can name them rather than just refuse. */
export function implausibleVitals(vitals: DraftVitals): readonly VitalsField[] {
  return (Object.keys(VITALS_BOUNDS) as readonly VitalsField[]).filter((field) => {
    const value = vitals[field];
    if (value === null) return false;
    const bounds = VITALS_BOUNDS[field];
    return value < bounds.min || value > bounds.max;
  });
}

/** Derived, never entered. Null until both height and weight are present. */
export function bmiFor(vitals: Pick<DraftVitals, 'heightCm' | 'weightKg'>): number | null {
  const { heightCm, weightKg } = vitals;
  if (heightCm === null || weightKg === null || heightCm <= 0) return null;
  const metres = heightCm / 100;
  return Number((weightKg / (metres * metres)).toFixed(1));
}

/* ── The draft ──────────────────────────────────────────────────── */

/** The display fields a record carries about its patient, from the directory. */
export function toRecordPatientSnapshot(patient: Patient): RecordPatientSnapshot {
  return {
    id: patient.id,
    name: patient.name,
    mrn: patient.mrn,
    age: patient.age,
    gender: patient.gender,
    bloodType: patient.bloodType,
    phone: patient.phone,
  };
}

export interface DraftVisit {
  /** ISO date (YYYY-MM-DD); the encounter happened on a day, not an instant. */
  readonly visitDate: string | null;
  readonly visitType: string | null;
  readonly department: string | null;
}

export const EMPTY_VISIT: DraftVisit = { visitDate: null, visitType: null, department: null };

export interface DraftNote {
  readonly title: string;
  readonly body: string;
}

export const EMPTY_NOTE: DraftNote = { title: '', body: '' };

export interface MedicalRecordDraft {
  readonly id: string;
  readonly patient: RecordPatientSnapshot | null;
  readonly visit: DraftVisit;
  readonly chiefComplaint: string;
  readonly historyOfPresentIllness: string;
  readonly physicalExamination: string;
  readonly vitals: DraftVitals;
  readonly diagnoses: readonly RecordDiagnosis[];
  readonly note: DraftNote;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function emptyDraft(id: string, now: string): MedicalRecordDraft {
  return {
    id,
    patient: null,
    visit: EMPTY_VISIT,
    chiefComplaint: '',
    historyOfPresentIllness: '',
    physicalExamination: '',
    vitals: EMPTY_VITALS,
    diagnoses: [],
    note: EMPTY_NOTE,
    createdAt: now,
    updatedAt: now,
  };
}

/* ── Completeness ───────────────────────────────────────────────── */

/**
 * A draft that has everything a record needs. The branded shape is what the
 * service takes, so an incomplete draft is not merely refused at runtime — it
 * cannot be passed.
 */
export interface CompleteRecordDraft extends MedicalRecordDraft {
  readonly patient: RecordPatientSnapshot;
  readonly visit: { readonly visitDate: string; readonly visitType: string; readonly department: string };
  readonly diagnoses: readonly [RecordDiagnosis, ...RecordDiagnosis[]];
}

export function isPatientStepComplete(draft: MedicalRecordDraft): boolean {
  return draft.patient !== null;
}

/** The narrative fields a record must carry — API §6.3 requires all three. */
export type NarrativeField = 'chiefComplaint' | 'historyOfPresentIllness' | 'physicalExamination';

export function isVisitStepComplete(draft: MedicalRecordDraft): boolean {
  const { visitDate, visitType, department } = draft.visit;
  return (
    visitDate !== null &&
    visitType !== null &&
    department !== null &&
    draft.chiefComplaint.trim() !== '' &&
    draft.historyOfPresentIllness.trim() !== '' &&
    draft.physicalExamination.trim() !== ''
  );
}

/**
 * The clinical step needs a primary diagnosis and a note with content.
 * Vitals are **optional** — a telemedicine follow-up may legitimately record
 * none — but any vitals that *are* entered must be plausible and, if a blood
 * pressure was typed at all, it must parse.
 */
export function isClinicalStepComplete(draft: MedicalRecordDraft): boolean {
  if (draft.diagnoses.length === 0) return false;
  if (!draft.diagnoses.some((diagnosis) => diagnosis.isPrimary)) return false;
  if (draft.note.title.trim() === '' || draft.note.body.trim() === '') return false;
  if (draft.vitals.bloodPressure.trim() !== '' && !isValidBloodPressure(draft.vitals.bloodPressure)) {
    return false;
  }
  return implausibleVitals(draft.vitals).length === 0;
}

export function isDraftComplete(draft: MedicalRecordDraft): draft is CompleteRecordDraft {
  return (
    isPatientStepComplete(draft) && isVisitStepComplete(draft) && isClinicalStepComplete(draft)
  );
}

/** Steps are reachable in order, each gated on the ones before it. */
export function canAdvanceTo(draft: MedicalRecordDraft, step: RecordStepId): boolean {
  switch (step) {
    case 'patient':
      return true;
    case 'visit':
      return isPatientStepComplete(draft);
    case 'clinical':
      return isPatientStepComplete(draft) && isVisitStepComplete(draft);
    case 'review':
      return isDraftComplete(draft);
  }
}

export function isStepValid(draft: MedicalRecordDraft, step: RecordStepId): boolean {
  switch (step) {
    case 'patient':
      return isPatientStepComplete(draft);
    case 'visit':
      return isVisitStepComplete(draft);
    case 'clinical':
      return isClinicalStepComplete(draft);
    case 'review':
      return isDraftComplete(draft);
  }
}

/* ── Diagnoses ──────────────────────────────────────────────────── */

/**
 * Exactly one primary diagnosis, always. Adding the first makes it primary;
 * promoting one demotes the rest; removing the primary promotes whatever is
 * left. The invariant lives here rather than in the component because
 * `primaryDiagnosis()` on the read side already assumes it.
 */
export function withDiagnosisAdded(
  diagnoses: readonly RecordDiagnosis[],
  code: string,
): readonly RecordDiagnosis[] {
  if (diagnoses.some((diagnosis) => diagnosis.code === code)) return diagnoses;
  const concept = DIAGNOSES.find((candidate) => candidate.code === code);
  if (concept === undefined) return diagnoses;
  return [...diagnoses, { ...concept, isPrimary: diagnoses.length === 0 }];
}

export function withDiagnosisRemoved(
  diagnoses: readonly RecordDiagnosis[],
  code: string,
): readonly RecordDiagnosis[] {
  const next = diagnoses.filter((diagnosis) => diagnosis.code !== code);
  if (next.length === 0) return next;
  if (next.some((diagnosis) => diagnosis.isPrimary)) return next;
  return next.map((diagnosis, index) => ({ ...diagnosis, isPrimary: index === 0 }));
}

export function withPrimaryDiagnosis(
  diagnoses: readonly RecordDiagnosis[],
  code: string,
): readonly RecordDiagnosis[] {
  if (!diagnoses.some((diagnosis) => diagnosis.code === code)) return diagnoses;
  return diagnoses.map((diagnosis) => ({ ...diagnosis, isPrimary: diagnosis.code === code }));
}
