import type { SortState } from '@/components/ui';
import { RISK_LEVELS, type Patient } from '@/features/shared-domain/patient-identity';
import { dayDiffFromToday } from '@/utils/dates';

import type { PatientListFilters } from './filters';

/**
 * Pure list derivations: search, filtering, sorting, and the summary-card
 * figures. All run client-side over the mock dataset; when the API lands
 * these become server-side query params and this module shrinks to the
 * summary mapper — components are unaffected either way.
 */

/** Columns the table may sort by; the URL sort param validates against this. */
export const PATIENT_SORT_COLUMNS = [
  'name',
  'mrn',
  'age',
  'lastVisit',
  'nextAppointment',
  'riskLevel',
] as const;

export type PatientSortColumn = (typeof PATIENT_SORT_COLUMNS)[number];

export function isPatientSortColumn(value: string): value is PatientSortColumn {
  return (PATIENT_SORT_COLUMNS as readonly string[]).includes(value);
}

const digitsOnly = (value: string) => value.replace(/\D/g, '');

/** Search across name, MRN, patient id, and phone (digits-insensitive). */
function matchesQuery(patient: Patient, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (patient.name.toLowerCase().includes(q)) return true;
  if (patient.mrn.toLowerCase().includes(q)) return true;
  if (patient.id.toLowerCase().includes(q)) return true;
  const qDigits = digitsOnly(q);
  return qDigits.length >= 3 && digitsOnly(patient.phone).includes(qDigits);
}

function matchesAgeRange(age: number, range: NonNullable<PatientListFilters['ageRange']>) {
  switch (range) {
    case '0-17':
      return age <= 17;
    case '18-39':
      return age >= 18 && age <= 39;
    case '40-64':
      return age >= 40 && age <= 64;
    case '65+':
      return age >= 65;
  }
}

function matchesLastVisit(
  lastVisit: string | null,
  range: NonNullable<PatientListFilters['lastVisit']>,
) {
  if (range === 'never') return lastVisit === null;
  if (lastVisit === null) return false;
  const daysAgo = -dayDiffFromToday(lastVisit);
  switch (range) {
    case '7d':
      return daysAgo <= 7;
    case '30d':
      return daysAgo <= 30;
    case '90d':
      return daysAgo <= 90;
    case 'over-1y':
      return daysAgo > 365;
  }
}

function matchesUpcoming(
  nextAppointment: string | null,
  filter: NonNullable<PatientListFilters['upcoming']>,
) {
  switch (filter) {
    case 'any':
      return nextAppointment !== null;
    case 'none':
      return nextAppointment === null;
    case '7d':
      return nextAppointment !== null && dayDiffFromToday(nextAppointment) <= 7;
  }
}

export function filterPatients(
  patients: readonly Patient[],
  query: string,
  filters: PatientListFilters,
): readonly Patient[] {
  return patients.filter((patient) => {
    if (!matchesQuery(patient, query)) return false;
    if (filters.gender && patient.gender !== filters.gender) return false;
    if (filters.ageRange && !matchesAgeRange(patient.age, filters.ageRange)) return false;
    if (filters.bloodType && patient.bloodType !== filters.bloodType) return false;
    if (filters.status && patient.status !== filters.status) return false;
    if (filters.lastVisit && !matchesLastVisit(patient.lastVisit, filters.lastVisit)) return false;
    if (filters.upcoming && !matchesUpcoming(patient.nextAppointment, filters.upcoming)) {
      return false;
    }
    // `filters.condition` is not applied here: the patient directory filters
    // by condition (the server's list projection carries no conditions to
    // test), so the rows this receives are already scoped to it.
    if (filters.allergy) {
      if (filters.allergy === 'none' && patient.allergies.length > 0) return false;
      if (filters.allergy === 'any' && patient.allergies.length === 0) return false;
      if (filters.allergy === 'severe' && !patient.hasSevereAllergy) return false;
    }
    return true;
  });
}

/** Nulls (never visited / nothing scheduled) always sort last. */
function compareNullableDates(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

const COMPARATORS: Record<PatientSortColumn, (a: Patient, b: Patient) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  mrn: (a, b) => a.mrn.localeCompare(b.mrn),
  age: (a, b) => a.age - b.age,
  lastVisit: (a, b) => compareNullableDates(a.lastVisit, b.lastVisit),
  nextAppointment: (a, b) => compareNullableDates(a.nextAppointment, b.nextAppointment),
  riskLevel: (a, b) => RISK_LEVELS.indexOf(a.riskLevel) - RISK_LEVELS.indexOf(b.riskLevel),
};

export function sortPatients(
  patients: readonly Patient[],
  sort: SortState | null,
): readonly Patient[] {
  if (!sort || !isPatientSortColumn(sort.columnId)) return patients;
  const comparator = COMPARATORS[sort.columnId];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...patients].sort((a, b) => sign * comparator(a, b));
}

export interface PatientsSummary {
  readonly total: number;
  readonly active: number;
  readonly highRisk: number;
  readonly todaysVisits: number;
  readonly newThisMonth: number;
}

/** Summary-card figures over the whole practice (not the filtered view). */
export function summarizePatients(patients: readonly Patient[]): PatientsSummary {
  const now = new Date();
  return {
    total: patients.length,
    active: patients.filter((p) => p.status === 'active' || p.status === 'under-treatment').length,
    highRisk: patients.filter((p) => p.riskLevel === 'high' || p.riskLevel === 'critical').length,
    todaysVisits: patients.filter(
      (p) => p.nextAppointment !== null && dayDiffFromToday(p.nextAppointment) === 0,
    ).length,
    newThisMonth: patients.filter((p) => {
      const registered = new Date(p.registeredAt);
      return (
        registered.getFullYear() === now.getFullYear() && registered.getMonth() === now.getMonth()
      );
    }).length,
  };
}
