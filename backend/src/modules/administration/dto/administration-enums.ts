/**
 * Wire ⇄ Prisma vocabularies for the Administration Center (ADR-023 §2).
 *
 * A `Record` in each direction rather than a cast, so adding a member to
 * one side without the other stops the build instead of serialising
 * `ON_DUTY` to a client expecting `on-duty`.
 */

import {
  ActiveStatus,
  HolidayKind,
  PresenceStatus,
  QueuePriority,
  ResourceStatus,
  RoomKind,
  RoomStatus,
  ShiftKind,
  StaffRole,
  TemplateKind,
  WaitingStatus,
  Weekday,
} from '../../../generated/prisma/enums';

export const STAFF_ROLE_FROM_WIRE: Record<string, StaffRole> = {
  doctor: StaffRole.DOCTOR,
  nurse: StaffRole.NURSE,
  receptionist: StaffRole.RECEPTIONIST,
  laboratory: StaffRole.LABORATORY,
  pharmacy: StaffRole.PHARMACY,
};
export const STAFF_ROLE_TO_WIRE: Record<StaffRole, string> = {
  DOCTOR: 'doctor',
  NURSE: 'nurse',
  RECEPTIONIST: 'receptionist',
  LABORATORY: 'laboratory',
  PHARMACY: 'pharmacy',
};

export const PRESENCE_FROM_WIRE: Record<string, PresenceStatus> = {
  'on-duty': PresenceStatus.ON_DUTY,
  'on-break': PresenceStatus.ON_BREAK,
  'off-duty': PresenceStatus.OFF_DUTY,
  'on-leave': PresenceStatus.ON_LEAVE,
};
export const PRESENCE_TO_WIRE: Record<PresenceStatus, string> = {
  ON_DUTY: 'on-duty',
  ON_BREAK: 'on-break',
  OFF_DUTY: 'off-duty',
  ON_LEAVE: 'on-leave',
};

export const ROOM_KIND_FROM_WIRE: Record<string, RoomKind> = {
  consultation: RoomKind.CONSULTATION,
  lab: RoomKind.LAB,
  procedure: RoomKind.PROCEDURE,
  pharmacy: RoomKind.PHARMACY,
  waiting: RoomKind.WAITING,
};
export const ROOM_KIND_TO_WIRE: Record<RoomKind, string> = {
  CONSULTATION: 'consultation',
  LAB: 'lab',
  PROCEDURE: 'procedure',
  PHARMACY: 'pharmacy',
  WAITING: 'waiting',
};

export const ROOM_STATUS_FROM_WIRE: Record<string, RoomStatus> = {
  available: RoomStatus.AVAILABLE,
  occupied: RoomStatus.OCCUPIED,
  cleaning: RoomStatus.CLEANING,
  maintenance: RoomStatus.MAINTENANCE,
};
export const ROOM_STATUS_TO_WIRE: Record<RoomStatus, string> = {
  AVAILABLE: 'available',
  OCCUPIED: 'occupied',
  CLEANING: 'cleaning',
  MAINTENANCE: 'maintenance',
};

export const RESOURCE_STATUS_TO_WIRE: Record<ResourceStatus, string> = {
  IN_STOCK: 'in-stock',
  LOW: 'low',
  OUT: 'out',
};

export const WEEKDAY_FROM_WIRE: Record<string, Weekday> = {
  Mon: Weekday.MON,
  Tue: Weekday.TUE,
  Wed: Weekday.WED,
  Thu: Weekday.THU,
  Fri: Weekday.FRI,
  Sat: Weekday.SAT,
  Sun: Weekday.SUN,
};
export const WEEKDAY_TO_WIRE: Record<Weekday, string> = {
  MON: 'Mon',
  TUE: 'Tue',
  WED: 'Wed',
  THU: 'Thu',
  FRI: 'Fri',
  SAT: 'Sat',
  SUN: 'Sun',
};

export const HOLIDAY_KIND_FROM_WIRE: Record<string, HolidayKind> = {
  public: HolidayKind.PUBLIC,
  clinic: HolidayKind.CLINIC,
};
export const HOLIDAY_KIND_TO_WIRE: Record<HolidayKind, string> = {
  PUBLIC: 'public',
  CLINIC: 'clinic',
};

export const SHIFT_KIND_FROM_WIRE: Record<string, ShiftKind> = {
  morning: ShiftKind.MORNING,
  evening: ShiftKind.EVENING,
  'on-call': ShiftKind.ON_CALL,
  vacation: ShiftKind.VACATION,
  leave: ShiftKind.LEAVE,
};
export const SHIFT_KIND_TO_WIRE: Record<ShiftKind, string> = {
  MORNING: 'morning',
  EVENING: 'evening',
  ON_CALL: 'on-call',
  VACATION: 'vacation',
  LEAVE: 'leave',
};

export const QUEUE_PRIORITY_TO_WIRE: Record<QueuePriority, string> = {
  ROUTINE: 'routine',
  PRIORITY: 'priority',
  URGENT: 'urgent',
};

export const WAITING_STATUS_TO_WIRE: Record<WaitingStatus, string> = {
  WAITING: 'waiting',
  CALLED: 'called',
  IN_ROOM: 'in-room',
};

export const TEMPLATE_KIND_FROM_WIRE: Record<string, TemplateKind> = {
  prescription: TemplateKind.PRESCRIPTION,
  certificate: TemplateKind.CERTIFICATE,
  referral: TemplateKind.REFERRAL,
  'lab-request': TemplateKind.LAB_REQUEST,
  'radiology-request': TemplateKind.RADIOLOGY_REQUEST,
  discharge: TemplateKind.DISCHARGE,
};
export const TEMPLATE_KIND_TO_WIRE: Record<TemplateKind, string> = {
  PRESCRIPTION: 'prescription',
  CERTIFICATE: 'certificate',
  REFERRAL: 'referral',
  LAB_REQUEST: 'lab-request',
  RADIOLOGY_REQUEST: 'radiology-request',
  DISCHARGE: 'discharge',
};

export const ACTIVE_STATUS_FROM_WIRE: Record<string, ActiveStatus> = {
  active: ActiveStatus.ACTIVE,
  inactive: ActiveStatus.INACTIVE,
};
export const ACTIVE_STATUS_TO_WIRE: Record<ActiveStatus, string> = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
};

/**
 * `Resource.status`, derived rather than read (RM M23.2).
 *
 * The verify step says derived fields are "computed, never stored", and
 * this is the computation: out at zero, low at or below the reorder
 * level, in stock above it. The column still exists and is kept in step
 * on every write so the value is filterable — DB §14.5-6's "index use"
 * exception — but **the response always carries this function's answer**,
 * so a row whose column drifted cannot mislead a reader.
 */
export function resourceStatus(quantity: number, reorderLevel: number): string {
  if (quantity <= 0) return 'out';

  return quantity <= reorderLevel ? 'low' : 'in-stock';
}
