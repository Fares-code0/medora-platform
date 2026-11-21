import type { ActiveFilter } from '@/components/patterns';
import { formatDate } from '@/utils/dates';

import {
  PRESCRIPTION_STATUS_META,
  REFILL_STATUS_META,
  type MedicationCategory,
  type PrescriptionStatus,
  type RefillStatus,
} from './types';

/**
 * Pharmacy list filter contract — mirrors the URL params for
 * /doctor/pharmacy so every filtered view is shareable and restorable.
 * `null` = filter not applied. `patient` is the deep-link filter used by
 * the Patient Profile, Medical Records, and Labs entry points; `highRisk`
 * and `controlled` narrow to high-alert and controlled medications.
 */
export interface PharmacyListFilters {
  readonly status: PrescriptionStatus | null;
  readonly category: MedicationCategory | null;
  readonly doctor: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly refillStatus: RefillStatus | null;
  readonly highRisk: boolean;
  readonly controlled: boolean;
  readonly patient: string | null;
}

/** YYYY-MM-DD guard for the date-range params. */
export function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

/**
 * `patientName` resolves the `patient` filter's id for its chip — from the
 * prescriptions on screen, which carry their patient's name — and falls
 * back to the id itself.
 */
export function toActiveFilterChips(
  filters: PharmacyListFilters,
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
    chips.push({ id: 'status', label: `Status: ${PRESCRIPTION_STATUS_META[filters.status].label}` });
  }
  if (filters.category) chips.push({ id: 'category', label: `Category: ${filters.category}` });
  if (filters.doctor) chips.push({ id: 'doctor', label: `Doctor: ${filters.doctor}` });
  if (filters.refillStatus) {
    chips.push({ id: 'refillStatus', label: `Refill: ${REFILL_STATUS_META[filters.refillStatus].label}` });
  }
  if (filters.from) chips.push({ id: 'from', label: `From: ${formatDate(filters.from)}` });
  if (filters.to) chips.push({ id: 'to', label: `To: ${formatDate(filters.to)}` });
  if (filters.highRisk) chips.push({ id: 'highRisk', label: 'High-risk only' });
  if (filters.controlled) chips.push({ id: 'controlled', label: 'Controlled only' });
  return chips;
}
