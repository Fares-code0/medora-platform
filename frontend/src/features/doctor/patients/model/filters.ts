import type { ActiveFilter } from '@/components/patterns';
import {
  PATIENT_STATUS_META,
  type BloodType,
  type Gender,
  type PatientStatus,
} from '@/features/shared-domain/patient-identity';

/**
 * Patient list filter contract — mirrors the UX §1.3 URL params for
 * /doctor/patients so every filtered view is shareable and restorable.
 * `null` = filter not applied.
 */

export type AgeRange = '0-17' | '18-39' | '40-64' | '65+';
export type LastVisitRange = '7d' | '30d' | '90d' | 'over-1y' | 'never';
export type UpcomingFilter = 'any' | 'none' | '7d';
export type AllergyFilter = 'any' | 'none' | 'severe';

export interface PatientListFilters {
  readonly gender: Gender | null;
  readonly ageRange: AgeRange | null;
  readonly bloodType: BloodType | null;
  readonly status: PatientStatus | null;
  readonly lastVisit: LastVisitRange | null;
  readonly upcoming: UpcomingFilter | null;
  readonly condition: string | null;
  readonly allergy: AllergyFilter | null;
}

export const EMPTY_FILTERS: PatientListFilters = {
  gender: null,
  ageRange: null,
  bloodType: null,
  status: null,
  lastVisit: null,
  upcoming: null,
  condition: null,
  allergy: null,
};

export const AGE_RANGE_LABELS: Record<AgeRange, string> = {
  '0-17': '0–17',
  '18-39': '18–39',
  '40-64': '40–64',
  '65+': '65+',
};

export const LAST_VISIT_LABELS: Record<LastVisitRange, string> = {
  '7d': 'Within 7 days',
  '30d': 'Within 30 days',
  '90d': 'Within 90 days',
  'over-1y': 'Over a year ago',
  never: 'Never visited',
};

export const UPCOMING_LABELS: Record<UpcomingFilter, string> = {
  any: 'Has upcoming',
  '7d': 'Within 7 days',
  none: 'None scheduled',
};

export const ALLERGY_LABELS: Record<AllergyFilter, string> = {
  any: 'Any allergy',
  severe: 'Severe allergy',
  none: 'No known allergies',
};

/** Active-filter chips for the FilterBar ("Gender: Female" …). */
export function toActiveFilterChips(filters: PatientListFilters): readonly ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (filters.gender) {
    chips.push({
      id: 'gender',
      label: `Gender: ${filters.gender === 'female' ? 'Female' : 'Male'}`,
    });
  }
  if (filters.ageRange) {
    chips.push({ id: 'ageRange', label: `Age: ${AGE_RANGE_LABELS[filters.ageRange]}` });
  }
  if (filters.bloodType) {
    chips.push({ id: 'bloodType', label: `Blood type: ${filters.bloodType}` });
  }
  if (filters.status) {
    chips.push({ id: 'status', label: `Status: ${PATIENT_STATUS_META[filters.status].label}` });
  }
  if (filters.lastVisit) {
    chips.push({ id: 'lastVisit', label: `Last visit: ${LAST_VISIT_LABELS[filters.lastVisit]}` });
  }
  if (filters.upcoming) {
    chips.push({ id: 'upcoming', label: `Appointment: ${UPCOMING_LABELS[filters.upcoming]}` });
  }
  if (filters.condition) {
    chips.push({ id: 'condition', label: `Condition: ${filters.condition}` });
  }
  if (filters.allergy) {
    chips.push({ id: 'allergy', label: `Allergies: ${ALLERGY_LABELS[filters.allergy]}` });
  }
  return chips;
}
