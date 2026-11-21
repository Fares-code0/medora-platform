/**
 * Patient enum member → API wire value (ADR-023 §2).
 *
 * The mechanical transform gets three of these wrong and gets them wrong
 * quietly: `UNDER_TREATMENT` is `under-treatment`, `FOLLOW_UP` is
 * `follow-up`, and `O_POSITIVE` is `O+`. API §4's vocabulary is the
 * contract, so a lossy transform would put values on the wire that no
 * client understands.
 *
 * `Record<Enum, string>` makes exhaustiveness the compiler's problem: a
 * sixth patient status stops the build rather than shipping a value the
 * frontend's union does not contain.
 */

import type {
  AlertSeverity,
  AllergySeverity,
  AppointmentPriority,
  AppointmentStatus,
  DocumentCategory,
  HistoryEventKind,
  MedicationStatus,
  PatientStatus,
  RiskLevel,
  StudyModality,
  StudyStatus,
} from '../../../generated/prisma/enums';

const STATUS_WIRE: Record<PatientStatus, string> = {
  ACTIVE: 'active',
  UNDER_TREATMENT: 'under-treatment',
  CRITICAL: 'critical',
  FOLLOW_UP: 'follow-up',
  DISCHARGED: 'discharged',
};

const RISK_WIRE: Record<RiskLevel, string> = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

const ALLERGY_SEVERITY_WIRE: Record<AllergySeverity, string> = {
  MILD: 'mild',
  MODERATE: 'moderate',
  SEVERE: 'severe',
};

const ALERT_SEVERITY_WIRE: Record<AlertSeverity, string> = {
  CRITICAL: 'critical',
  WARNING: 'warning',
};

const HISTORY_KIND_WIRE: Record<HistoryEventKind, string> = {
  DIAGNOSIS: 'diagnosis',
  SURGERY: 'surgery',
  PROCEDURE: 'procedure',
  HOSPITALIZATION: 'hospitalization',
  VACCINATION: 'vaccination',
};

/** `EXTERNAL_RECORD` is `external-record` — the case a transform loses. */
const DOCUMENT_CATEGORY_WIRE: Record<DocumentCategory, string> = {
  REFERRAL: 'referral',
  CONSENT: 'consent',
  EXTERNAL_RECORD: 'external-record',
  INSURANCE: 'insurance',
  REPORT: 'report',
};

const STUDY_MODALITY_WIRE: Record<StudyModality, string> = {
  LAB: 'lab',
  IMAGING: 'imaging',
};

const STUDY_STATUS_WIRE: Record<StudyStatus, string> = {
  COMPLETED: 'completed',
  PENDING: 'pending',
  CRITICAL: 'critical',
};

/**
 * The appointment vocabulary, transcribed for the patient chart's
 * appointments tab (API §4.5).
 *
 * `modules/appointments` holds the same two maps and M2.2's zone 1
 * forbids importing them. `NO_SHOW` is `no-show` and `AWAITING_PATIENT`
 * is `awaiting-patient`, so a mechanical transform would put values on
 * the wire that no client vocabulary contains — which is ADR-023 §2's
 * whole point and the reason these are transcribed rather than derived.
 */
const APPOINTMENT_STATUS_WIRE: Record<AppointmentStatus, string> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  RESCHEDULED: 'rescheduled',
  NO_SHOW: 'no-show',
  AWAITING_PATIENT: 'awaiting-patient',
};

const APPOINTMENT_PRIORITY_WIRE: Record<AppointmentPriority, string> = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
};

export function historyKindToWire(value: HistoryEventKind): string {
  return HISTORY_KIND_WIRE[value];
}

export function documentCategoryToWire(value: DocumentCategory): string {
  return DOCUMENT_CATEGORY_WIRE[value];
}

export function studyModalityToWire(value: StudyModality): string {
  return STUDY_MODALITY_WIRE[value];
}

export function studyStatusToWire(value: StudyStatus): string {
  return STUDY_STATUS_WIRE[value];
}

export function appointmentStatusToWire(value: AppointmentStatus): string {
  return APPOINTMENT_STATUS_WIRE[value];
}

export function appointmentPriorityToWire(value: AppointmentPriority): string {
  return APPOINTMENT_PRIORITY_WIRE[value];
}

export const HISTORY_KIND_FROM_WIRE: Readonly<Record<string, HistoryEventKind>> =
  Object.fromEntries(
    (Object.entries(HISTORY_KIND_WIRE) as [HistoryEventKind, string][]).map(([member, wire]) => [
      wire,
      member,
    ]),
  );

const MEDICATION_STATUS_WIRE: Record<MedicationStatus, string> = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  DISCONTINUED: 'discontinued',
};

export function medicationStatusToWire(value: MedicationStatus): string {
  return MEDICATION_STATUS_WIRE[value];
}

export function patientStatusToWire(value: PatientStatus): string {
  return STATUS_WIRE[value];
}

export function riskLevelToWire(value: RiskLevel): string {
  return RISK_WIRE[value];
}

export function allergySeverityToWire(value: AllergySeverity): string {
  return ALLERGY_SEVERITY_WIRE[value];
}

export function alertSeverityToWire(value: AlertSeverity): string {
  return ALERT_SEVERITY_WIRE[value];
}

export const PATIENT_STATUS_VALUES = Object.values(STATUS_WIRE) as [string, ...string[]];
export const RISK_LEVEL_VALUES = Object.values(RISK_WIRE) as [string, ...string[]];
export const ALLERGY_SEVERITY_VALUES = Object.values(ALLERGY_SEVERITY_WIRE) as [string, ...string[]];
export const ALERT_SEVERITY_VALUES = Object.values(ALERT_SEVERITY_WIRE) as [string, ...string[]];

export const DOCUMENT_CATEGORY_VALUES = Object.values(DOCUMENT_CATEGORY_WIRE) as [
  string,
  ...string[],
];

export const DOCUMENT_CATEGORY_FROM_WIRE: Readonly<Record<string, DocumentCategory>> =
  Object.fromEntries(
    (Object.entries(DOCUMENT_CATEGORY_WIRE) as [DocumentCategory, string][]).map(
      ([member, wire]) => [wire, member],
    ),
  );

export const PATIENT_STATUS_FROM_WIRE: Readonly<Record<string, PatientStatus>> =
  Object.fromEntries(
    (Object.entries(STATUS_WIRE) as [PatientStatus, string][]).map(([member, wire]) => [
      wire,
      member,
    ]),
  );

export const RISK_LEVEL_FROM_WIRE: Readonly<Record<string, RiskLevel>> = Object.fromEntries(
  (Object.entries(RISK_WIRE) as [RiskLevel, string][]).map(([member, wire]) => [wire, member]),
);

export const ALLERGY_SEVERITY_FROM_WIRE: Readonly<Record<string, AllergySeverity>> =
  Object.fromEntries(
    (Object.entries(ALLERGY_SEVERITY_WIRE) as [AllergySeverity, string][]).map(
      ([member, wire]) => [wire, member],
    ),
  );

export const ALERT_SEVERITY_FROM_WIRE: Readonly<Record<string, AlertSeverity>> =
  Object.fromEntries(
    (Object.entries(ALERT_SEVERITY_WIRE) as [AlertSeverity, string][]).map(([member, wire]) => [
      wire,
      member,
    ]),
  );
