import type { StatusKind } from '@/components/patterns';

/**
 * Patients domain model — feature-local types (FRONTEND_ARCHITECTURE §9.1:
 * types used by exactly one feature live in the feature). The shape mirrors
 * the future `PatientDto` list payload so Phase 7+ API integration swaps
 * the data source without touching any component.
 */

export type PatientStatus = 'active' | 'under-treatment' | 'critical' | 'follow-up' | 'discharged';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type Gender = 'female' | 'male';

export type BloodType = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';

export interface Patient {
  readonly id: string;
  readonly mrn: string;
  readonly name: string;
  readonly dateOfBirth: string;
  readonly age: number;
  readonly gender: Gender;
  readonly bloodType: BloodType;
  readonly phone: string;
  /** Null until the files service exists; Avatar falls back to initials. */
  readonly photoUrl: string | null;
  readonly lastVisit: string | null;
  readonly nextAppointment: string | null;
  readonly assignedDoctor: string;
  readonly status: PatientStatus;
  readonly riskLevel: RiskLevel;
  readonly chronicConditions: readonly string[];
  readonly allergies: readonly string[];
  readonly hasSevereAllergy: boolean;
  readonly registeredAt: string;
  /** Optional contact/registration details (present on patients added in-app). */
  readonly email?: string | undefined;
  readonly address?: string | undefined;
  readonly insurance?: string | undefined;
  readonly medicalNotes?: string | undefined;
}

/**
 * Status → P8 vocabulary. StatusBadge owns the only status→color mapping
 * in the platform; these maps pick the sanctioned kind for each domain
 * value (never a raw Badge variant).
 */
export const PATIENT_STATUS_META: Record<
  PatientStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  active: { label: 'Active', kind: 'active' },
  'under-treatment': { label: 'Under treatment', kind: 'info' },
  critical: { label: 'Critical', kind: 'critical' },
  'follow-up': { label: 'Follow-up', kind: 'awaiting' },
  discharged: { label: 'Discharged', kind: 'archived' },
};

export const RISK_LEVEL_META: Record<
  RiskLevel,
  { readonly label: string; readonly kind: StatusKind }
> = {
  low: { label: 'Low', kind: 'normal' },
  medium: { label: 'Medium', kind: 'expiring' },
  high: { label: 'High', kind: 'critical' },
  critical: { label: 'Critical', kind: 'critical' },
};

export const PATIENT_STATUSES = Object.keys(PATIENT_STATUS_META) as readonly PatientStatus[];
export const RISK_LEVELS = Object.keys(RISK_LEVEL_META) as readonly RiskLevel[];

export const BLOOD_TYPES: readonly BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

/** Canonical chronic-condition vocabulary used by mock data and filters. */
export const CHRONIC_CONDITIONS: readonly string[] = [
  'Type 2 diabetes',
  'Hypertension',
  'Asthma',
  'Chronic kidney disease',
  'Coronary artery disease',
  'Hypothyroidism',
  'COPD',
  'Atrial fibrillation',
  'Epilepsy',
  'Osteoarthritis',
];
