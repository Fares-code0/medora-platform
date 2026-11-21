import type { ActiveFilter } from '@/components/patterns';
import { formatDate } from '@/utils/dates';

import {
  RECORD_PRIORITY_META,
  RECORD_STATUS_META,
  type MedicalRecordPriority,
  type MedicalRecordStatus,
} from './types';

/**
 * Medical-records list filter contract — mirrors the URL params for
 * /doctor/medical-records so every filtered view is shareable and
 * restorable. `null` = filter not applied. `patient` is the deep-link
 * filter used by the Patient Profile "Medical record" entry point.
 */
export interface MedicalRecordListFilters {
  readonly status: MedicalRecordStatus | null;
  readonly diagnosis: string | null;
  readonly department: string | null;
  readonly doctor: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly visitType: string | null;
  readonly priority: MedicalRecordPriority | null;
  readonly patient: string | null;
}

/** YYYY-MM-DD guard for the date-range params. */
export function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * `patientName` resolves the `patient` filter's id for its chip — from the
 * records on screen, which carry their patient's name — and falls back to
 * the id itself when none of them is that patient's.
 */
export function toActiveFilterChips(
  filters: MedicalRecordListFilters,
  patientName: (patientId: string) => string | undefined = () => undefined,
): readonly ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (filters.patient) {
    chips.push({
      id: 'patient',
      label: `Patient: ${patientName(filters.patient) ?? filters.patient}`,
    });
  }
  if (filters.status) {
    chips.push({ id: 'status', label: `Status: ${RECORD_STATUS_META[filters.status].label}` });
  }
  if (filters.diagnosis) chips.push({ id: 'diagnosis', label: `Diagnosis: ${filters.diagnosis}` });
  if (filters.department) {
    chips.push({ id: 'department', label: `Department: ${filters.department}` });
  }
  if (filters.doctor) chips.push({ id: 'doctor', label: `Doctor: ${filters.doctor}` });
  if (filters.from) chips.push({ id: 'from', label: `From: ${formatDate(filters.from)}` });
  if (filters.to) chips.push({ id: 'to', label: `To: ${formatDate(filters.to)}` });
  if (filters.visitType) chips.push({ id: 'visitType', label: `Type: ${filters.visitType}` });
  if (filters.priority) {
    chips.push({
      id: 'priority',
      label: `Priority: ${RECORD_PRIORITY_META[filters.priority].label}`,
    });
  }
  return chips;
}
