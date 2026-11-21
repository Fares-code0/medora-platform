import {
  Activity,
  FilePlus2,
  NotebookPen,
  Paperclip,
  Pill,
  RefreshCw,
  Stethoscope,
  type LucideIcon,
} from 'lucide-react';

import type { StatusKind } from '@/components/patterns';
import type { BloodType, Gender } from '@/features/shared-domain/patient-identity';

/**
 * Medical-records domain model — feature-local types mirroring the
 * future records DTOs (list payload carries the patient denormalized;
 * the detail payload is the full clinical document). Statuses and
 * priorities map onto the sanctioned P8 StatusBadge vocabulary — no
 * feature-invented color pairings.
 */

/* ── Status & priority ──────────────────────────────────────────── */

export type MedicalRecordStatus = 'draft' | 'active' | 'completed' | 'archived';

export type MedicalRecordPriority = 'low' | 'normal' | 'high' | 'critical';

export const RECORD_STATUS_META: Record<
  MedicalRecordStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  draft: { label: 'Draft', kind: 'pending' },
  active: { label: 'Active', kind: 'active' },
  completed: { label: 'Completed', kind: 'completed' },
  archived: { label: 'Archived', kind: 'archived' },
};

export const RECORD_PRIORITY_META: Record<
  MedicalRecordPriority,
  { readonly label: string; readonly kind: StatusKind }
> = {
  low: { label: 'Low', kind: 'archived' },
  normal: { label: 'Normal', kind: 'normal' },
  high: { label: 'High', kind: 'expiring' },
  critical: { label: 'Critical', kind: 'critical' },
};

export const RECORD_STATUSES = Object.keys(RECORD_STATUS_META) as readonly MedicalRecordStatus[];
export const RECORD_PRIORITIES = Object.keys(
  RECORD_PRIORITY_META,
) as readonly MedicalRecordPriority[];

/** Open = still being worked; closed = finalized (summary-card split). */
export const OPEN_RECORD_STATUSES: ReadonlySet<MedicalRecordStatus> = new Set(['draft', 'active']);

/* ── Visit vocabulary ───────────────────────────────────────────── */

export const RECORD_VISIT_TYPES: readonly string[] = [
  'Consultation',
  'Follow-up',
  'Emergency',
  'Annual check-up',
  'Procedure',
  'Telemedicine',
];

export const RECORD_DEPARTMENTS: readonly string[] = [
  'General Medicine',
  'Cardiology',
  'Endocrinology',
  'Pulmonology',
  'Orthopedics',
];

/* ── Diagnoses ──────────────────────────────────────────────────── */

export interface DiagnosisConcept {
  /** ICD-10 code, e.g. "E11.9". */
  readonly code: string;
  readonly label: string;
}

/** Canonical diagnosis vocabulary shared by the mock data and filters. */
export const DIAGNOSES: readonly DiagnosisConcept[] = [
  { code: 'E11.9', label: 'Type 2 diabetes mellitus' },
  { code: 'I10', label: 'Essential hypertension' },
  { code: 'J45.909', label: 'Asthma, unspecified' },
  { code: 'N18.3', label: 'Chronic kidney disease, stage 3' },
  { code: 'I25.10', label: 'Coronary artery disease' },
  { code: 'E03.9', label: 'Hypothyroidism' },
  { code: 'J44.9', label: 'COPD' },
  { code: 'I48.91', label: 'Atrial fibrillation' },
  { code: 'K21.9', label: 'GERD' },
  { code: 'M54.5', label: 'Low back pain' },
  { code: 'J06.9', label: 'Acute upper respiratory infection' },
  { code: 'D64.9', label: 'Anemia, unspecified' },
  { code: 'R51.9', label: 'Headache, unspecified' },
  { code: 'M17.9', label: 'Osteoarthritis of knee' },
];

export interface RecordDiagnosis extends DiagnosisConcept {
  readonly isPrimary: boolean;
}

/** The primary diagnosis, shown in the table and detail header. */
export function primaryDiagnosis(record: MedicalRecordSummary): RecordDiagnosis | null {
  return record.diagnoses.find((diagnosis) => diagnosis.isPrimary) ?? record.diagnoses[0] ?? null;
}

/* ── Clinical sub-documents ─────────────────────────────────────── */

export interface RecordVitalSigns {
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

export type RecordMedicationStatus = 'active' | 'completed' | 'discontinued';

export const RECORD_MEDICATION_STATUS_META: Record<
  RecordMedicationStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  active: { label: 'Active', kind: 'active' },
  completed: { label: 'Completed', kind: 'completed' },
  discontinued: { label: 'Discontinued', kind: 'cancelled' },
};

export interface RecordMedication {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly instructions: string | null;
  readonly status: RecordMedicationStatus;
}

export type RecordAllergySeverity = 'mild' | 'moderate' | 'severe';

export const RECORD_ALLERGY_SEVERITY_META: Record<
  RecordAllergySeverity,
  { readonly label: string; readonly kind: StatusKind }
> = {
  mild: { label: 'Mild', kind: 'info' },
  moderate: { label: 'Moderate', kind: 'expiring' },
  severe: { label: 'Severe', kind: 'critical' },
};

export interface RecordAllergy {
  readonly id: string;
  readonly allergen: string;
  readonly severity: RecordAllergySeverity;
  readonly reaction: string;
}

export interface RecordClinicalNote {
  readonly id: string;
  readonly author: string;
  readonly authoredAt: string;
  readonly title: string;
  readonly body: string;
  readonly signed: boolean;
}

export type RecordAttachmentKind =
  'lab-result' | 'imaging' | 'referral' | 'consent' | 'external-report';

export const RECORD_ATTACHMENT_KIND_META: Record<RecordAttachmentKind, { readonly label: string }> =
  {
    'lab-result': { label: 'Lab result' },
    imaging: { label: 'Imaging' },
    referral: { label: 'Referral' },
    consent: { label: 'Consent' },
    'external-report': { label: 'External report' },
  };

export interface RecordAttachment {
  readonly id: string;
  readonly name: string;
  readonly kind: RecordAttachmentKind;
  readonly sizeKb: number;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
}

/* ── Timeline ───────────────────────────────────────────────────── */

export type RecordTimelineKind =
  | 'created'
  | 'vitals-recorded'
  | 'diagnosis-added'
  | 'medication-prescribed'
  | 'note-added'
  | 'attachment-added'
  | 'status-changed';

export const RECORD_TIMELINE_META: Record<
  RecordTimelineKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  created: { label: 'Record created', icon: FilePlus2 },
  'vitals-recorded': { label: 'Vitals recorded', icon: Activity },
  'diagnosis-added': { label: 'Diagnosis added', icon: Stethoscope },
  'medication-prescribed': { label: 'Medication prescribed', icon: Pill },
  'note-added': { label: 'Note added', icon: NotebookPen },
  'attachment-added': { label: 'Attachment added', icon: Paperclip },
  'status-changed': { label: 'Status changed', icon: RefreshCw },
};

export interface RecordTimelineEvent {
  readonly id: string;
  readonly kind: RecordTimelineKind;
  readonly at: string;
  readonly actor: string;
  readonly detail: string;
}

/* ── The record ─────────────────────────────────────────────────── */

/** Denormalized patient display fields, as the list DTO will carry them. */
export interface RecordPatientSnapshot {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly age: number;
  readonly gender: Gender;
  readonly bloodType: BloodType;
  readonly phone: string;
}

/**
 * One row of the list (API §6.1) — the encounter without its clinical body.
 *
 * The list endpoint serves exactly this, so the list screens are typed
 * against it: a table that read `record.notes` would compile against a mock
 * that happens to carry them and break against the server that does not.
 */
export interface MedicalRecordSummary {
  readonly id: string;
  readonly patient: RecordPatientSnapshot;
  readonly visitDate: string;
  readonly visitType: string;
  readonly department: string;
  readonly doctor: string;
  readonly status: MedicalRecordStatus;
  readonly priority: MedicalRecordPriority;
  readonly diagnoses: readonly RecordDiagnosis[];
  readonly chiefComplaint: string;
  readonly followUpDate: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The full clinical document (API §6.2). */
export interface MedicalRecord extends MedicalRecordSummary {
  readonly historyOfPresentIllness: string;
  readonly physicalExamination: string;
  /**
   * `null` when none were taken. A zeroed reading would put `0/0 mmHg` on a
   * chart, which is a clinical falsehood rather than a missing value.
   */
  readonly vitals: RecordVitalSigns | null;
  readonly treatmentPlan: readonly string[];
  readonly medications: readonly RecordMedication[];
  readonly allergies: readonly RecordAllergy[];
  readonly notes: readonly RecordClinicalNote[];
  readonly attachments: readonly RecordAttachment[];
  readonly timeline: readonly RecordTimelineEvent[];
}
