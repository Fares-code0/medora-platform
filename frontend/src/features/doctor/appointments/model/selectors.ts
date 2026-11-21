import type { SortState } from '@/components/ui';
import { dayDiffFromToday } from '@/utils/dates';

import { appointmentDateKey } from './calendar';
import type { AppointmentListFilters } from './filters';
import { APPOINTMENT_PRIORITIES, type Appointment } from './types';

/**
 * Pure list derivations over the mock dataset: search, filtering,
 * sorting, and the summary-card figures. Becomes server-side query
 * params when the API lands; components are unaffected either way.
 */

export const APPOINTMENT_SORT_COLUMNS = ['id', 'patient', 'date', 'duration', 'priority'] as const;

export type AppointmentSortColumn = (typeof APPOINTMENT_SORT_COLUMNS)[number];

export function isAppointmentSortColumn(value: string): value is AppointmentSortColumn {
  return (APPOINTMENT_SORT_COLUMNS as readonly string[]).includes(value);
}

const digitsOnly = (value: string) => value.replace(/\D/g, '');

/** Search across patient name, MRN, appointment id, and phone. */
function matchesQuery(appointment: Appointment, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (appointment.patient.name.toLowerCase().includes(q)) return true;
  if (appointment.patient.mrn.toLowerCase().includes(q)) return true;
  if (appointment.id.toLowerCase().includes(q)) return true;
  const qDigits = digitsOnly(q);
  return qDigits.length >= 3 && digitsOnly(appointment.patient.phone).includes(qDigits);
}

export function filterAppointments(
  appointments: readonly Appointment[],
  query: string,
  filters: AppointmentListFilters,
): readonly Appointment[] {
  return appointments.filter((appointment) => {
    if (!matchesQuery(appointment, query)) return false;
    if (filters.status && appointment.status !== filters.status) return false;
    if (filters.doctor && appointment.doctor !== filters.doctor) return false;
    if (filters.department && appointment.department !== filters.department) return false;
    if (filters.visitType && appointment.visitType !== filters.visitType) return false;
    if (filters.priority && appointment.priority !== filters.priority) return false;
    if (filters.newPatient && !appointment.isNewPatient) return false;
    if (filters.followUp && !appointment.isFollowUp) return false;
    const dateKey = appointmentDateKey(appointment);
    if (filters.from && dateKey < filters.from) return false;
    if (filters.to && dateKey > filters.to) return false;
    return true;
  });
}

const COMPARATORS: Record<AppointmentSortColumn, (a: Appointment, b: Appointment) => number> = {
  id: (a, b) => a.id.localeCompare(b.id),
  patient: (a, b) => a.patient.name.localeCompare(b.patient.name),
  date: (a, b) => a.dateTime.localeCompare(b.dateTime),
  duration: (a, b) => a.durationMin - b.durationMin,
  priority: (a, b) =>
    APPOINTMENT_PRIORITIES.indexOf(a.priority) - APPOINTMENT_PRIORITIES.indexOf(b.priority),
};

export function sortAppointments(
  appointments: readonly Appointment[],
  sort: SortState | null,
): readonly Appointment[] {
  if (!sort || !isAppointmentSortColumn(sort.columnId)) {
    // Default: soonest first.
    return [...appointments].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  }
  const comparator = COMPARATORS[sort.columnId];
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...appointments].sort((a, b) => sign * comparator(a, b));
}

export interface AppointmentsSummary {
  readonly today: number;
  readonly upcoming: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly pending: number;
  readonly rescheduled: number;
}

const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed', 'pending', 'rescheduled']);

/** Summary cards over the whole dataset (not the filtered view). */
export function summarizeAppointments(appointments: readonly Appointment[]): AppointmentsSummary {
  let today = 0;
  let upcoming = 0;
  let completed = 0;
  let cancelled = 0;
  let pending = 0;
  let rescheduled = 0;

  for (const appointment of appointments) {
    const diff = dayDiffFromToday(appointment.dateTime);
    if (diff === 0 && appointment.status !== 'cancelled') today += 1;
    if (diff > 0 && ACTIVE_STATUSES.has(appointment.status)) upcoming += 1;
    if (appointment.status === 'completed') completed += 1;
    if (appointment.status === 'cancelled') cancelled += 1;
    if (appointment.status === 'pending') pending += 1;
    if (appointment.status === 'rescheduled') rescheduled += 1;
  }

  return { today, upcoming, completed, cancelled, pending, rescheduled };
}
