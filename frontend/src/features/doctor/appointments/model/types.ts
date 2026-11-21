import {
  Ban,
  CalendarClock,
  CalendarRange,
  Check,
  CheckCheck,
  UserRoundX,
  X,
  type LucideIcon,
} from 'lucide-react';

import type { StatusKind } from '@/components/patterns';
import type { Gender } from '@/features/shared-domain/patient-identity';
import { dayDiffFromToday } from '@/utils/dates';

/**
 * Appointments domain model — feature-local types mirroring the future
 * appointments list DTO (patient fields arrive denormalized on the list
 * payload). Statuses and priorities map onto the sanctioned P8
 * StatusBadge vocabulary; the action availability map is the typed
 * status machine (FRONTEND_ARCHITECTURE §9.2) — an illegal transition
 * button cannot render.
 */

export type AppointmentStatus =
  | 'scheduled'
  | 'confirmed'
  | 'pending'
  | 'completed'
  | 'cancelled'
  | 'rescheduled'
  | 'no-show'
  /** A reschedule has been proposed and the patient has not answered (API §5.8). */
  | 'awaiting-patient';

export type AppointmentPriority = 'low' | 'normal' | 'high' | 'urgent';

export const APPOINTMENT_STATUS_META: Record<
  AppointmentStatus,
  { readonly label: string; readonly kind: StatusKind }
> = {
  scheduled: { label: 'Scheduled', kind: 'scheduled' },
  confirmed: { label: 'Confirmed', kind: 'confirmed' },
  pending: { label: 'Pending', kind: 'pending' },
  completed: { label: 'Completed', kind: 'completed' },
  cancelled: { label: 'Cancelled', kind: 'cancelled' },
  /*
   * `scheduled`, not `awaiting`. A rescheduled appointment is not waiting on
   * anyone — the move already happened — and mapping it to `awaiting` painted
   * it the same amber as Pending in the column right beside it, so the one
   * status that needs a decision looked identical to one that does not.
   */
  rescheduled: { label: 'Rescheduled', kind: 'scheduled' },
  'no-show': { label: 'No-show', kind: 'rejected' },
  'awaiting-patient': { label: 'Awaiting patient', kind: 'awaiting' },
};

export const APPOINTMENT_PRIORITY_META: Record<
  AppointmentPriority,
  { readonly label: string; readonly kind: StatusKind }
> = {
  low: { label: 'Low', kind: 'archived' },
  normal: { label: 'Normal', kind: 'normal' },
  high: { label: 'High', kind: 'expiring' },
  urgent: { label: 'Urgent', kind: 'critical' },
};

export const APPOINTMENT_STATUSES = Object.keys(
  APPOINTMENT_STATUS_META,
) as readonly AppointmentStatus[];
export const APPOINTMENT_PRIORITIES = Object.keys(
  APPOINTMENT_PRIORITY_META,
) as readonly AppointmentPriority[];

/** Denormalized patient display fields, as the list DTO will carry them. */
export interface AppointmentPatientSnapshot {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly phone: string;
  readonly age: number;
  readonly gender: Gender;
}

export interface Appointment {
  readonly id: string;
  readonly patient: AppointmentPatientSnapshot;
  readonly dateTime: string;
  readonly durationMin: number;
  readonly visitType: string;
  readonly department: string;
  readonly doctor: string;
  readonly status: AppointmentStatus;
  readonly priority: AppointmentPriority;
  readonly isNewPatient: boolean;
  readonly isFollowUp: boolean;
  readonly reason: string;
  readonly notes: string | null;
  /**
   * The transitions the server says this appointment allows, when the
   * source says — the API returns them on every appointment so the client
   * never computes them (API §5). Absent for the mock, which has no server
   * to ask; `availableActions` then falls back to the local machine.
   */
  readonly allowedActions?: readonly AppointmentAction[] | undefined;
}

export const VISIT_TYPES: readonly string[] = [
  'Consultation',
  'Follow-up',
  'Annual check-up',
  'Lab review',
  'Medication review',
  'Procedure',
];

export const DEPARTMENTS: readonly string[] = [
  'General Medicine',
  'Cardiology',
  'Endocrinology',
  'Pulmonology',
  'Orthopedics',
];

/* ── Action availability (the status machine) ───────────────────── */

export type AppointmentAction =
  'approve' | 'reject' | 'propose-slots' | 'cancel' | 'reschedule' | 'complete' | 'no-show';

export const APPOINTMENT_ACTION_META: Record<
  AppointmentAction,
  { readonly label: string; readonly destructive: boolean; readonly icon: LucideIcon }
> = {
  approve: { label: 'Approve', destructive: false, icon: Check },
  reject: { label: 'Reject', destructive: true, icon: X },
  'propose-slots': { label: 'Propose other times', destructive: false, icon: CalendarRange },
  cancel: { label: 'Cancel appointment', destructive: true, icon: Ban },
  reschedule: { label: 'Reschedule', destructive: false, icon: CalendarClock },
  complete: { label: 'Mark completed', destructive: false, icon: CheckCheck },
  'no-show': { label: 'Mark no-show', destructive: true, icon: UserRoundX },
};

/**
 * Which actions a doctor may take given status + time. Completion and
 * no-show only make sense once the slot has started (today or past);
 * terminal states offer nothing.
 */
export function availableActions(appointment: Appointment): readonly AppointmentAction[] {
  if (appointment.allowedActions !== undefined) return appointment.allowedActions;
  const diff = dayDiffFromToday(appointment.dateTime);
  switch (appointment.status) {
    case 'pending':
      // A request the doctor cannot take at the asked time can be answered
      // with alternatives rather than only declined (API §5.8).
      return ['approve', 'propose-slots', 'reject'];
    case 'scheduled':
    case 'confirmed':
    case 'rescheduled':
      return diff <= 0 ? ['complete', 'no-show', 'reschedule', 'cancel'] : ['reschedule', 'cancel'];
    case 'awaiting-patient':
      // A proposal is outstanding; it can only be resolved, not re-proposed.
      return ['reschedule', 'cancel'];
    case 'completed':
    case 'cancelled':
    case 'no-show':
      return [];
  }
}
