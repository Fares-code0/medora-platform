import {
  Activity,
  Building2,
  FileCheck,
  FileHeart,
  FileText,
  ShieldCheck,
  Slice,
  Stethoscope,
  Syringe,
  type LucideIcon,
} from 'lucide-react';

import type { StatusKind } from '@/components/patterns';
import type { Patient } from '@/features/shared-domain/patient-identity';

/**
 * Patient-profile domain model (UX 2.3) — feature-local types mirroring
 * the future profile DTO bundle so Phase 7+ API integration swaps the
 * data source without touching components. Every status maps onto the
 * sanctioned P8 StatusBadge vocabulary — no new color pairings.
 */

/* ── Vitals ─────────────────────────────────────────────────────── */

export interface VitalSigns {
  readonly recordedAt: string;
  readonly bloodPressure: string;
  readonly heartRateBpm: number;
  readonly temperatureC: number;
  readonly respiratoryRate: number;
  readonly oxygenSaturation: number;
  readonly weightKg: number;
  readonly heightCm: number;
  /** Null when height or weight is missing, so no BMI can be derived. */
  readonly bmi: number | null;
}

/* ── Allergies ──────────────────────────────────────────────────── */

export type AllergySeverity = 'mild' | 'moderate' | 'severe';

export interface AllergyRecord {
  readonly id: string;
  readonly allergen: string;
  readonly severity: AllergySeverity;
  readonly reaction: string;
  readonly notes: string | null;
  readonly recordedAt: string;
}

export const ALLERGY_SEVERITY_META: Record<
  AllergySeverity,
  { readonly label: string; readonly kind: StatusKind }
> = {
  mild: { label: 'Mild', kind: 'info' },
  moderate: { label: 'Moderate', kind: 'expiring' },
  severe: { label: 'Severe', kind: 'critical' },
};

/* ── Medications ────────────────────────────────────────────────── */

export type MedicationStatus = 'active' | 'completed' | 'discontinued';

export interface MedicationRecord {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly prescribedBy: string;
  readonly status: MedicationStatus;
}

export const MEDICATION_STATUS_META: Record<
  MedicationStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  active: { label: 'Active', kind: 'active' },
  completed: { label: 'Completed', kind: 'completed' },
  discontinued: { label: 'Discontinued', kind: 'cancelled' },
};

/* ── Medical history timeline ───────────────────────────────────── */

export type HistoryEventKind =
  'diagnosis' | 'surgery' | 'procedure' | 'hospitalization' | 'vaccination';

export interface MedicalHistoryEvent {
  readonly id: string;
  readonly kind: HistoryEventKind;
  readonly title: string;
  readonly date: string;
  readonly detail: string;
  readonly facility: string | null;
}

export const HISTORY_KIND_META: Record<
  HistoryEventKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  diagnosis: { label: 'Diagnosis', icon: Stethoscope },
  surgery: { label: 'Surgery', icon: Slice },
  procedure: { label: 'Procedure', icon: Activity },
  hospitalization: { label: 'Hospitalization', icon: Building2 },
  vaccination: { label: 'Vaccination', icon: Syringe },
};

/* ── Lab & imaging studies (placeholder cards) ──────────────────── */

export type StudyStatus = 'completed' | 'pending' | 'critical';

export interface StudyRecord {
  readonly id: string;
  readonly name: string;
  readonly date: string;
  readonly status: StudyStatus;
}

export interface StudyCategory {
  readonly id: string;
  readonly label: string;
  readonly studies: readonly StudyRecord[];
}

export const STUDY_STATUS_META: Record<
  StudyStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  completed: { label: 'Completed', kind: 'completed' },
  pending: { label: 'Pending', kind: 'pending' },
  critical: { label: 'Critical', kind: 'critical' },
};

/* ── Appointments ───────────────────────────────────────────────── */

export type ProfileAppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'pending'
  | 'rescheduled'
  | 'awaiting-patient'
  | 'completed'
  | 'cancelled'
  | 'no-show';

export interface AppointmentRecord {
  readonly id: string;
  readonly dateTime: string;
  readonly type: string;
  readonly doctor: string;
  /** Null when the source does not say (the API's patient tab carries none). */
  readonly department: string | null;
  readonly status: ProfileAppointmentStatus;
}

/** Statuses of an appointment that is still going to happen. */
export const LIVE_APPOINTMENT_STATUSES: ReadonlySet<ProfileAppointmentStatus> = new Set([
  'scheduled',
  'confirmed',
  'pending',
  'rescheduled',
  'awaiting-patient',
]);

export const APPOINTMENT_STATUS_META: Record<
  ProfileAppointmentStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  scheduled: { label: 'Scheduled', kind: 'scheduled' },
  confirmed: { label: 'Confirmed', kind: 'confirmed' },
  pending: { label: 'Pending', kind: 'pending' },
  rescheduled: { label: 'Rescheduled', kind: 'pending' },
  'awaiting-patient': { label: 'Awaiting patient', kind: 'awaiting' },
  completed: { label: 'Completed', kind: 'completed' },
  cancelled: { label: 'Cancelled', kind: 'cancelled' },
  'no-show': { label: 'No-show', kind: 'rejected' },
};

/* ── Notes & documents ──────────────────────────────────────────── */

export interface ClinicalNote {
  readonly id: string;
  /**
   * The author's account id — live, `users.public_id`, the same value the
   * session's `SessionUser.id` carries — compared to decide whether to offer
   * Edit and Sign (DEC-001). Never a display name: two clinicians can share one.
   */
  readonly authorId: string;
  /** What the tab prints. Live this is the same handle; the API resolves no name. */
  readonly author: string;
  readonly authoredAt: string;
  readonly title: string;
  readonly body: string;
  readonly signed: boolean;
}

export type DocumentCategory = 'referral' | 'consent' | 'external-record' | 'insurance' | 'report';

export const DOCUMENT_CATEGORY_META: Record<
  DocumentCategory,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  referral: { label: 'Referral', icon: FileText },
  consent: { label: 'Consent', icon: FileCheck },
  'external-record': { label: 'External record', icon: FileHeart },
  insurance: { label: 'Insurance', icon: ShieldCheck },
  report: { label: 'Report', icon: FileText },
};

export interface PatientDocument {
  readonly id: string;
  readonly name: string;
  readonly category: DocumentCategory;
  readonly uploadedAt: string;
  readonly uploadedBy: string;
  readonly sizeKb: number;
}

/* ── Contact, insurance, alerts ─────────────────────────────────── */

export interface EmergencyContact {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly phone: string;
  /** At most one per patient — the server clears the others when one is set. */
  readonly isPrimary: boolean;
}

/** The contact to call first: the primary one if marked, otherwise the first on file. */
export function primaryEmergencyContact(
  contacts: readonly EmergencyContact[],
): EmergencyContact | null {
  return contacts.find((contact) => contact.isPrimary) ?? contacts[0] ?? null;
}

export interface InsuranceInfo {
  readonly provider: string;
  readonly policyNumber: string;
  readonly plan: string;
  readonly validUntil: string;
}

export interface ClinicalAlert {
  readonly id: string;
  readonly severity: 'critical' | 'warning';
  readonly message: string;
}

/* ── The profile bundle ─────────────────────────────────────────── */

/**
 * What a chart shows the moment it opens: the header, the summary column
 * and the Overview tab.
 *
 * The rest of the record — history, the full medication list, notes,
 * documents, imaging — is `ProfileTabData`, loaded only when its tab is
 * opened. That split is the backend's (API §4.5 "lazy per-tab fetch"), and
 * it exists for the audit trail rather than for payload size: every tab
 * read is recorded as `patient.tab_view`, so loading all of them on open
 * would log "read the notes" for a doctor who only looked at the header.
 * `appointments` is here, not there, because the summary column renders
 * the next appointment on every tab — it is read because it is shown.
 */
export interface PatientProfile {
  /** A written one-line summary; empty when none exists (the API has none). */
  readonly summary: string;
  /** The latest reading, or null when none has been taken. */
  readonly vitals: VitalSigns | null;
  readonly allergies: readonly AllergyRecord[];
  /** Current medications for the summary cards; the full list is a tab. */
  readonly medications: readonly MedicationRecord[];
  readonly appointments: readonly AppointmentRecord[];
  /** The primary contact, or null when none is on file. */
  readonly emergencyContacts: readonly EmergencyContact[];
  /** Null when no insurance is on file — or the source records none at all. */
  readonly insurance: InsuranceInfo | null;
  readonly alerts: readonly ClinicalAlert[];
}

/** The record behind each lazily loaded tab — see `PatientProfile`. */
export interface ProfileTabData {
  readonly history: readonly MedicalHistoryEvent[];
  readonly medications: readonly MedicationRecord[];
  readonly notes: readonly ClinicalNote[];
  readonly documents: readonly PatientDocument[];
  readonly imaging: readonly StudyCategory[];
}

export type ProfileTab = keyof ProfileTabData;

export interface PatientProfileBundle {
  readonly patient: Patient;
  readonly profile: PatientProfile;
}
