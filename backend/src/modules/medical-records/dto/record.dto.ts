/**
 * The clinical document on the wire (API §6).
 *
 * Shaped against `features/doctor/medical-records/model/types.ts`, which
 * is the coded contract: the list item carries the patient denormalized
 * and the primary diagnosis, and the detail carries the whole document
 * with its children. Field names are that file's verbatim — a payload
 * the frontend has to rename before rendering is a payload two teams
 * will disagree about.
 *
 * ## `vitals` is nullable here and not in the frontend union
 *
 * The frontend's `MedicalRecord.vitals` is `RecordVitalSigns`, not
 * optional, because its mock always produces one. The server cannot
 * promise that: vitals live in `patient_vital_signs` and a draft written
 * before the nurse has taken them genuinely has none. Serving a zeroed
 * object would put `0/0 mmHg` and a BMI of 0 on a chart, which is a
 * clinical falsehood rather than a missing value. `null` is the honest
 * answer, and widening the frontend type is recorded for M39.
 */

import type { AttachmentKindWire } from './record.schema';

export interface RecordPatientSnapshot {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly age: number;
  readonly gender: string;
  readonly bloodType: string;
  readonly phone: string;
}

export interface RecordDiagnosisView {
  readonly code: string;
  readonly label: string;
  readonly isPrimary: boolean;
}

export interface RecordVitalsView {
  readonly recordedAt: string;
  readonly bloodPressure: string;
  readonly heartRateBpm: number;
  readonly temperatureC: number;
  readonly respiratoryRate: number;
  readonly oxygenSaturation: number;
  readonly weightKg: number;
  readonly heightCm: number;
  readonly bmi: number;
}

export interface RecordMedicationView {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly instructions: string | null;
  readonly status: string;
  /**
   * The prescription this entry came from, or `null` (RM M15.2).
   *
   * The same provenance M13.6 added to `PatientMedicationView`, and
   * clinical rather than bookkeeping for the same reason: an
   * `RX-…`-linked row went through the §7.5 safety screen at signing
   * and a hand-documented one never did, so a list that rendered both
   * identically would invite a reader to assume the same assurance
   * behind each.
   */
  readonly prescriptionId: string | null;
}

export interface RecordAllergyView {
  readonly id: string;
  readonly allergen: string;
  readonly severity: string;
  readonly reaction: string;
}

export interface RecordNoteView {
  readonly id: string;
  readonly author: string;
  readonly authoredAt: string;
  readonly title: string;
  readonly body: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  /**
   * Whether an AI assistant drafted this note.
   *
   * Persisted provenance, not a UI hint (RM M12.4, M16.6): the only path
   * from an assistant's output into the clinical record is a note a
   * doctor signed, and this flag is what makes that reviewable
   * afterwards. It survives signing.
   */
  readonly aiAssisted: boolean;
}

export interface RecordAttachmentView {
  readonly id: string;
  readonly name: string;
  readonly kind: AttachmentKindWire;
  readonly sizeKb: number;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
}

export interface RecordTimelineView {
  readonly id: string;
  readonly kind: string;
  readonly at: string;
  /** The actor's display name as it was, or `System` for a job. */
  readonly actor: string;
  readonly detail: string;
}

/** API §6.1 — one row of the list. */
export interface MedicalRecordView {
  readonly id: string;
  readonly patient: RecordPatientSnapshot;
  readonly visitDate: string;
  readonly visitType: string;
  readonly department: string | null;
  readonly doctorId: string;
  readonly doctor: string;
  readonly status: string;
  readonly priority: string;
  readonly diagnoses: readonly RecordDiagnosisView[];
  readonly chiefComplaint: string;
  readonly followUpDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** API §6.2 — the full clinical document. */
export interface MedicalRecordDetailView extends MedicalRecordView {
  readonly historyOfPresentIllness: string;
  readonly physicalExamination: string;
  readonly vitals: RecordVitalsView | null;
  readonly treatmentPlan: readonly string[];
  readonly medications: readonly RecordMedicationView[];
  readonly allergies: readonly RecordAllergyView[];
  readonly notes: readonly RecordNoteView[];
  readonly attachments: readonly RecordAttachmentView[];
  readonly timeline: readonly RecordTimelineView[];
}

/** API §6.8 — one entry of the version history. */
export interface RecordVersionView {
  readonly version: number;
  readonly changedAt: string;
  readonly actor: string;
  readonly summary: string | null;
  /** The editor's reason, when one was given (BR-DEC-004). */
  readonly reason: string | null;
  /** `{ field: { before, after } }`, plus `children` for collections. */
  readonly changes: Readonly<Record<string, unknown>>;
}

/** API §6.10 — the cards above the list. */
export interface RecordSummaryView {
  /** `draft` + `active` — the frontend's `OPEN_RECORD_STATUSES`. */
  readonly open: number;
  readonly completed: number;
  readonly critical: number;
  /** Unsigned notes across the caller's records — feeds the action queue. */
  readonly unsignedNotes: number;
}

/** Whole years on a given day. */
export function ageOn(dateOfBirth: Date, now: Date): number {
  let age = now.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = now.getUTCMonth() - dateOfBirth.getUTCMonth();

  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }

  return Math.max(0, age);
}

/**
 * `bmi` is **read**, never recomputed here.
 *
 * `patient_vital_signs.bmi` is a generated column — Postgres derives it
 * from `weight_kg` and `height_cm` on every write, so it cannot go stale
 * the way a stored value would (DB §14.5-6's rule, satisfied at the
 * schema rather than in application code). Recomputing it in this module
 * would add a second definition of the same number, and the two would
 * eventually disagree about rounding.
 *
 * It is nullable in the schema (a zero height yields NULL rather than a
 * division error), and the projection serves 0 for that case — the one
 * value that cannot be mistaken for a reading.
 */
