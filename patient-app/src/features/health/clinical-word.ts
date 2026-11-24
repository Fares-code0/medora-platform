import type { MessageKey } from '@/i18n';
import type {
  AllergySeverity,
  HistoryEventKind,
  LabResultFlag,
  MedicationStatus,
  PrescriptionStatus,
} from '@/types/vocabularies';

/**
 * A clinical literal, as a patient reads it.
 *
 * ── The rule this implements, and where it is written ───────────────
 *
 * The clinical vocabulary the record itself is written in — allergy
 * severity, medication status, lab-result flags, prescription status,
 * the kind of a history entry — was kept in English until W-10's owner
 * decided. On 2026-11-23 the owner approved translating it. These maps
 * are that decision: each wire literal names a catalogue key, and the
 * screen renders `t(key)`.
 *
 * ⚠ The approval covers translating only. The W-10 clinical sign-off is
 * still **not given**: the Arabic values of these keys are an
 * engineering draft awaiting the named clinical reviewer in
 * `docs/SIGNOFF.md`. "Severe" and "Critically high" are the words a
 * paramedic reads off a phone, which is why they are on that list.
 *
 * Rendering the *wire literal* is still the defect this file exists to
 * close: the medical-history row once read `hospitalization · 14
 * September 2026`. A-07's "field names are law" is untouched: the
 * literal is still what this client sends and compares. This is only
 * what it draws. The English values are the capitalised literals the
 * screens showed before, word for word.
 */
export const ALLERGY_SEVERITY_KEY: Record<AllergySeverity, MessageKey> = {
  mild: 'health.allergy.severity.mild',
  moderate: 'health.allergy.severity.moderate',
  severe: 'health.allergy.severity.severe',
};

export const MEDICATION_STATUS_KEY: Record<MedicationStatus, MessageKey> = {
  active: 'health.medication.status.active',
  completed: 'health.medication.status.completed',
  discontinued: 'health.medication.status.discontinued',
};

export const HISTORY_KIND_KEY: Record<HistoryEventKind, MessageKey> = {
  diagnosis: 'health.history.kind.diagnosis',
  surgery: 'health.history.kind.surgery',
  procedure: 'health.history.kind.procedure',
  hospitalization: 'health.history.kind.hospitalization',
  vaccination: 'health.history.kind.vaccination',
};

export const LAB_FLAG_KEY: Record<LabResultFlag, MessageKey> = {
  normal: 'health.labs.flag.normal',
  low: 'health.labs.flag.low',
  high: 'health.labs.flag.high',
  'critical-low': 'health.labs.flag.criticalLow',
  'critical-high': 'health.labs.flag.criticalHigh',
  abnormal: 'health.labs.flag.abnormal',
};

export const PRESCRIPTION_STATUS_KEY: Record<PrescriptionStatus, MessageKey> = {
  draft: 'health.prescriptions.status.draft',
  'pending-approval': 'health.prescriptions.status.pendingApproval',
  active: 'health.prescriptions.status.active',
  dispensed: 'health.prescriptions.status.dispensed',
  completed: 'health.prescriptions.status.completed',
  discontinued: 'health.prescriptions.status.discontinued',
  expired: 'health.prescriptions.status.expired',
};
