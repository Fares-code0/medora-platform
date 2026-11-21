/**
 * Notification enum member → API wire value (ADR-023 §2).
 *
 * `MEDICAL_RECORDS` is `medical-records` on the wire, which is exactly
 * the case a mechanical `toLowerCase()` gets wrong — it would produce
 * `medical_records`, a value API §10's vocabulary does not contain.
 *
 * `Record<Enum, string>` makes exhaustiveness the compiler's problem.
 */

import type {
  NotificationCategory,
  NotificationKind,
  NotificationPriority,
} from '../../../generated/prisma/enums';

const CATEGORY_WIRE: Record<NotificationCategory, string> = {
  APPOINTMENTS: 'appointments',
  MEDICAL_RECORDS: 'medical-records',
  LABORATORY: 'laboratory',
  PHARMACY: 'pharmacy',
  PATIENTS: 'patients',
  AI: 'ai',
  SYSTEM: 'system',
  SECURITY: 'security',
};

const PRIORITY_WIRE: Record<NotificationPriority, string> = {
  NORMAL: 'normal',
  IMPORTANT: 'important',
  CRITICAL: 'critical',
};

const KIND_WIRE: Record<NotificationKind, string> = {
  ALERT: 'alert',
  REMINDER: 'reminder',
  UPDATE: 'update',
};

export function categoryToWire(value: NotificationCategory): string {
  return CATEGORY_WIRE[value];
}

export function priorityToWire(value: NotificationPriority): string {
  return PRIORITY_WIRE[value];
}

export function kindToWire(value: NotificationKind): string {
  return KIND_WIRE[value];
}

export const CATEGORY_VALUES = Object.values(CATEGORY_WIRE) as [string, ...string[]];
export const PRIORITY_VALUES = Object.values(PRIORITY_WIRE) as [string, ...string[]];

export const CATEGORY_FROM_WIRE: Readonly<Record<string, NotificationCategory>> =
  Object.fromEntries(
    (Object.entries(CATEGORY_WIRE) as [NotificationCategory, string][]).map(([member, wire]) => [
      wire,
      member,
    ]),
  );

export const PRIORITY_FROM_WIRE: Readonly<Record<string, NotificationPriority>> =
  Object.fromEntries(
    (Object.entries(PRIORITY_WIRE) as [NotificationPriority, string][]).map(([member, wire]) => [
      wire,
      member,
    ]),
  );
