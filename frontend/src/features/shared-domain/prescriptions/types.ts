import {
  Ban,
  CalendarClock,
  CircleAlert,
  FilePlus2,
  NotebookPen,
  Pill,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import type { StatusKind } from '@/components/patterns';
import type { BloodType, Gender } from '@/features/shared-domain/patient-identity';

/**
 * Pharmacy domain model — feature-local types mirroring the future
 * prescription DTOs (the list payload carries the patient and medication
 * denormalized; the detail payload is the full prescription document with
 * notes, history, timeline, and safety warnings). Statuses map onto the
 * sanctioned P8 StatusBadge vocabulary — no feature-invented color
 * pairings (DS §8.8).
 */

/* ── Prescription status ────────────────────────────────────────── */

export type PrescriptionStatus =
  | 'draft'
  | 'active'
  | 'dispensed'
  | 'completed'
  | 'discontinued'
  | 'pending-approval'
  | 'expired';

export const PRESCRIPTION_STATUS_META: Record<
  PrescriptionStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  /*
   * Created but never signed — the state a refused signature leaves a
   * prescription in on the server (API §7.7). Not issued; nothing to dispense.
   */
  draft: { label: 'Draft — not issued', kind: 'awaiting' },
  active: { label: 'Active', kind: 'active' },
  // In the patient's hands: a running course the pharmacy has settled.
  dispensed: { label: 'Dispensed', kind: 'info' },
  completed: { label: 'Completed', kind: 'completed' },
  discontinued: { label: 'Discontinued', kind: 'cancelled' },
  'pending-approval': { label: 'Pending approval', kind: 'pending' },
  expired: { label: 'Expired', kind: 'archived' },
};

export const PRESCRIPTION_STATUSES = Object.keys(
  PRESCRIPTION_STATUS_META,
) as readonly PrescriptionStatus[];

/* ── Refill status ──────────────────────────────────────────────── */

export type RefillStatus = 'none' | 'available' | 'due' | 'pending';

export const REFILL_STATUS_META: Record<
  RefillStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  none: { label: 'No refills', kind: 'archived' },
  available: { label: 'Refills available', kind: 'normal' },
  due: { label: 'Refill due', kind: 'expiring' },
  pending: { label: 'Refill pending', kind: 'pending' },
};

export const REFILL_STATUSES = Object.keys(REFILL_STATUS_META) as readonly RefillStatus[];

/* ── Medication vocabulary ──────────────────────────────────────── */

export type MedicationCategory =
  | 'Antibiotics'
  | 'Analgesics'
  | 'Antihypertensives'
  | 'Antidiabetics'
  | 'Lipid-lowering'
  | 'Anticoagulants'
  | 'Corticosteroids'
  | 'Bronchodilators'
  | 'Psychiatric'
  | 'Gastrointestinal'
  | 'Opioids'
  | 'Thyroid';

export const MEDICATION_CATEGORIES: readonly MedicationCategory[] = [
  'Antibiotics',
  'Analgesics',
  'Antihypertensives',
  'Antidiabetics',
  'Lipid-lowering',
  'Anticoagulants',
  'Corticosteroids',
  'Bronchodilators',
  'Psychiatric',
  'Gastrointestinal',
  'Opioids',
  'Thyroid',
];

export type MedicationForm =
  | 'Tablet'
  | 'Capsule'
  | 'Syrup'
  | 'Injection'
  | 'Inhaler'
  | 'Cream'
  | 'Drops'
  | 'Patch';

export type MedicationRoute =
  | 'Oral'
  | 'Intravenous'
  | 'Intramuscular'
  | 'Subcutaneous'
  | 'Topical'
  | 'Inhalation'
  | 'Ophthalmic'
  | 'Transdermal';

/** Departments/specialties that prescribe (shared with the filters). */
export const PRESCRIBER_DEPARTMENTS: readonly string[] = [
  'General Medicine',
  'Cardiology',
  'Endocrinology',
  'Pulmonology',
  'Psychiatry',
  'Orthopedics',
];

export interface Medication {
  readonly name: string;
  readonly genericName: string;
  readonly category: MedicationCategory;
  readonly strength: string;
  readonly form: MedicationForm;
  readonly route: MedicationRoute;
  readonly manufacturer: string;
  /** Controlled substance (schedule) — drives the controlled filter/chip. */
  readonly isControlled: boolean;
  /** High-alert medication (e.g. anticoagulant, insulin, opioid). */
  readonly isHighRisk: boolean;
  /** Canned interaction note surfaced as a safety warning placeholder. */
  readonly interactionNote: string | null;
  /** Allergy class (e.g. "Penicillin") matched against patient allergies. */
  readonly allergyClass: string | null;
}

/* ── Safety warnings (frontend placeholders) ────────────────────── */

export type SafetyWarningKind = 'interaction' | 'allergy' | 'duplicate' | 'dosage';

export type SafetyWarningSeverity = 'info' | 'warning' | 'critical';

export const SAFETY_WARNING_KIND_META: Record<
  SafetyWarningKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  interaction: { label: 'Drug interaction', icon: ShieldAlert },
  allergy: { label: 'Allergy conflict', icon: CircleAlert },
  duplicate: { label: 'Duplicate therapy', icon: Pill },
  dosage: { label: 'Dosage alert', icon: CircleAlert },
};

/** Severity → P8 vocabulary (badges) and Alert variant (banners). */
export const SAFETY_WARNING_SEVERITY_META: Record<
  SafetyWarningSeverity,
  { readonly label: string; readonly kind: StatusKind; readonly alert: 'info' | 'warning' | 'error' }
> = {
  info: { label: 'Info', kind: 'info', alert: 'info' },
  warning: { label: 'Warning', kind: 'expiring', alert: 'warning' },
  critical: { label: 'Critical', kind: 'critical', alert: 'error' },
};

export interface SafetyWarning {
  readonly id: string;
  readonly kind: SafetyWarningKind;
  readonly severity: SafetyWarningSeverity;
  readonly title: string;
  readonly detail: string;
}

/* ── Notes, history, timeline ───────────────────────────────────── */

export interface PrescriptionNote {
  readonly id: string;
  readonly author: string;
  readonly authoredAt: string;
  readonly body: string;
}

export interface MedicationHistoryEntry {
  readonly id: string;
  readonly date: string;
  readonly event: string;
  readonly detail: string;
}

export type PrescriptionTimelineKind =
  | 'prescribed'
  | 'dispensed'
  | 'refill-requested'
  | 'refill-approved'
  | 'renewed'
  | 'note-added'
  | 'discontinued'
  | 'expired';

export const PRESCRIPTION_TIMELINE_META: Record<
  PrescriptionTimelineKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  prescribed: { label: 'Prescribed', icon: FilePlus2 },
  dispensed: { label: 'Dispensed', icon: Truck },
  'refill-requested': { label: 'Refill requested', icon: RefreshCw },
  'refill-approved': { label: 'Refill approved', icon: RefreshCw },
  renewed: { label: 'Renewed', icon: RotateCcw },
  'note-added': { label: 'Note added', icon: NotebookPen },
  discontinued: { label: 'Discontinued', icon: Ban },
  expired: { label: 'Expired', icon: CalendarClock },
};

export interface PrescriptionTimelineEvent {
  readonly id: string;
  readonly kind: PrescriptionTimelineKind;
  readonly at: string;
  readonly actor: string;
  readonly detail: string;
}

/* ── The prescription ───────────────────────────────────────────── */

/** Denormalized patient display fields, as the list DTO will carry them. */
export interface PrescriptionPatientSnapshot {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly age: number;
  readonly gender: Gender;
  readonly bloodType: BloodType;
  readonly phone: string;
  readonly allergies: readonly string[];
  readonly hasSevereAllergy: boolean;
}

/**
 * One row of the list (API §7.3) — the prescription without its notes,
 * history and timeline, which only the detail serves (§7.4). The list
 * screens are typed against this so none of them can read a field the
 * server's list does not carry.
 */
export interface PrescriptionSummary {
  readonly id: string;
  readonly patient: PrescriptionPatientSnapshot;
  readonly medication: Medication;
  readonly dosage: string;
  readonly frequency: string;
  readonly route: MedicationRoute;
  readonly duration: string;
  readonly durationDays: number;
  readonly quantity: number;
  readonly instructions: string;
  readonly prescribingDoctor: string;
  readonly department: string;
  readonly status: PrescriptionStatus;
  readonly startDate: string;
  readonly endDate: string;
  readonly refillsAllowed: number;
  readonly refillsRemaining: number;
  readonly refillStatus: RefillStatus;
  readonly warnings: readonly SafetyWarning[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** The full prescription document (API §7.4). */
export interface Prescription extends PrescriptionSummary {
  readonly notes: readonly PrescriptionNote[];
  readonly history: readonly MedicationHistoryEntry[];
  readonly timeline: readonly PrescriptionTimelineEvent[];
}

/** Highest-severity warning on a prescription (drives the row indicator). */
export function highestWarningSeverity(
  prescription: PrescriptionSummary,
): SafetyWarningSeverity | null {
  if (prescription.warnings.some((warning) => warning.severity === 'critical')) return 'critical';
  if (prescription.warnings.some((warning) => warning.severity === 'warning')) return 'warning';
  if (prescription.warnings.length > 0) return 'info';
  return null;
}
