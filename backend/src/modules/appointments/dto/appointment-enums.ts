/**
 * Appointment enum member → API wire value (ADR-023 §2).
 *
 * The Prisma client speaks `NO_SHOW` and `AWAITING_PATIENT`; the wire
 * speaks `no-show` and `awaiting-patient`. ADR-023 makes that mapping the
 * API layer's job at each module's serialization boundary, and the API
 * contract's §11 header calls these literals **law** — so a lossy
 * transform is not an option. `.toLowerCase()` would turn `NO_SHOW` into
 * `no_show`, which no client vocabulary contains.
 *
 * `Record<Enum, string>` makes exhaustiveness the compiler's problem: a
 * ninth appointment status stops the build rather than shipping a value
 * no client understands.
 */

import type {
  AppointmentAction,
  AppointmentPriority,
  AppointmentStatus,
  Gender,
} from '../../../generated/prisma/enums';

const STATUS_WIRE: Record<AppointmentStatus, string> = {
  SCHEDULED: 'scheduled',
  CONFIRMED: 'confirmed',
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  RESCHEDULED: 'rescheduled',
  NO_SHOW: 'no-show',
  AWAITING_PATIENT: 'awaiting-patient',
};

const PRIORITY_WIRE: Record<AppointmentPriority, string> = {
  LOW: 'low',
  NORMAL: 'normal',
  HIGH: 'high',
  URGENT: 'urgent',
};

const ACTION_WIRE: Record<AppointmentAction, string> = {
  APPROVE: 'approve',
  REJECT: 'reject',
  CANCEL: 'cancel',
  RESCHEDULE: 'reschedule',
  COMPLETE: 'complete',
  NO_SHOW: 'no-show',
  CREATED: 'created',
  NUDGED: 'nudged',
  REASSIGNED: 'reassigned',
};

export function appointmentStatusToWire(value: AppointmentStatus): string {
  return STATUS_WIRE[value];
}

export function appointmentPriorityToWire(value: AppointmentPriority): string {
  return PRIORITY_WIRE[value];
}

export function appointmentActionToWire(value: AppointmentAction): string {
  return ACTION_WIRE[value];
}

/** Every wire status, for query validation. */
export const APPOINTMENT_STATUS_VALUES = Object.values(STATUS_WIRE) as [string, ...string[]];

/** Wire value → Prisma member, for turning a `?status=` filter into a query. */
export const STATUS_FROM_WIRE: Readonly<Record<string, AppointmentStatus>> = Object.fromEntries(
  (Object.entries(STATUS_WIRE) as [AppointmentStatus, string][]).map(([member, wire]) => [
    wire,
    member,
  ]),
);

/**
 * `Gender` for the embedded patient snapshot of API §5.1.
 *
 * A third copy of a two-entry table — `modules/patients` and
 * `modules/users` each carry their own — and deliberately so: M2.2's
 * zone 1 forbids one module importing another's, and the alternative is
 * a shared kernel invented to hold one constant. `Record<Gender, string>`
 * keeps it honest; a third member stops the build in all three places,
 * which is the moment to notice.
 */
const GENDER_WIRE: Record<Gender, string> = {
  FEMALE: 'female',
  MALE: 'male',
};

export function genderToWire(value: Gender): string {
  return GENDER_WIRE[value];
}

/** Wire value → Prisma member, for turning a `?priority=` filter into a query. */
export const PRIORITY_FROM_WIRE: Readonly<Record<string, AppointmentPriority>> =
  Object.fromEntries(
    (Object.entries(PRIORITY_WIRE) as [AppointmentPriority, string][]).map(([member, wire]) => [
      wire,
      member,
    ]),
  );

/** Every wire priority, for query validation. */
export const APPOINTMENT_PRIORITY_VALUES = Object.values(PRIORITY_WIRE) as [string, ...string[]];
