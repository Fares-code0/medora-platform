import type { ActiveFilter } from '@/components/patterns';
import { formatDate } from '@/utils/dates';

import {
  APPOINTMENT_PRIORITY_META,
  APPOINTMENT_STATUS_META,
  type AppointmentPriority,
  type AppointmentStatus,
} from './types';

/**
 * Appointment list filter contract — mirrors the UX §1.3 URL params for
 * /doctor/appointments so every filtered view is shareable/restorable.
 * `null` (or `false` for the flags) = filter not applied.
 */
export interface AppointmentListFilters {
  readonly status: AppointmentStatus | null;
  readonly doctor: string | null;
  readonly department: string | null;
  readonly from: string | null;
  readonly to: string | null;
  readonly visitType: string | null;
  readonly priority: AppointmentPriority | null;
  readonly newPatient: boolean;
  readonly followUp: boolean;
}

export function toActiveFilterChips(filters: AppointmentListFilters): readonly ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (filters.status) {
    chips.push({
      id: 'status',
      label: `Status: ${APPOINTMENT_STATUS_META[filters.status].label}`,
    });
  }
  if (filters.doctor) chips.push({ id: 'doctor', label: `Doctor: ${filters.doctor}` });
  if (filters.department) {
    chips.push({ id: 'department', label: `Department: ${filters.department}` });
  }
  if (filters.from) chips.push({ id: 'from', label: `From: ${formatDate(filters.from)}` });
  if (filters.to) chips.push({ id: 'to', label: `To: ${formatDate(filters.to)}` });
  if (filters.visitType) chips.push({ id: 'visitType', label: `Type: ${filters.visitType}` });
  if (filters.priority) {
    chips.push({
      id: 'priority',
      label: `Priority: ${APPOINTMENT_PRIORITY_META[filters.priority].label}`,
    });
  }
  if (filters.newPatient) chips.push({ id: 'newPatient', label: 'New patients' });
  if (filters.followUp) chips.push({ id: 'followUp', label: 'Follow-ups' });
  return chips;
}
