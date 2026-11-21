import type { ActiveFilter } from '@/components/patterns';
import { formatDate } from '@/utils/dates';

import {
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_KIND_META,
  NOTIFICATION_PRIORITY_META,
  NOTIFICATION_STATUS_LABELS,
  type NotificationCategory,
  type NotificationKind,
  type NotificationPriority,
  type NotificationStatusFilter,
} from './types';

/**
 * Notification list filter contract — mirrors the URL params for
 * /doctor/notifications so every filtered view is shareable and
 * restorable. `status` defaults to 'active' (inbox = unarchived); the
 * other facets are `null` = not applied.
 */
export interface NotificationListFilters {
  readonly status: NotificationStatusFilter;
  readonly category: NotificationCategory | null;
  readonly priority: NotificationPriority | null;
  readonly kind: NotificationKind | null;
  readonly from: string | null;
  readonly to: string | null;
}

export const DEFAULT_STATUS: NotificationStatusFilter = 'active';

/** YYYY-MM-DD guard for the date-range params. */
export function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

export function toActiveFilterChips(filters: NotificationListFilters): readonly ActiveFilter[] {
  const chips: ActiveFilter[] = [];
  if (filters.status !== DEFAULT_STATUS) {
    chips.push({ id: 'status', label: `Status: ${NOTIFICATION_STATUS_LABELS[filters.status]}` });
  }
  if (filters.category) {
    chips.push({
      id: 'category',
      label: `Category: ${NOTIFICATION_CATEGORY_META[filters.category].label}`,
    });
  }
  if (filters.priority) {
    chips.push({
      id: 'priority',
      label: `Priority: ${NOTIFICATION_PRIORITY_META[filters.priority].label}`,
    });
  }
  if (filters.kind) {
    chips.push({ id: 'kind', label: `Type: ${NOTIFICATION_KIND_META[filters.kind].label}` });
  }
  if (filters.from) chips.push({ id: 'from', label: `From: ${formatDate(filters.from)}` });
  if (filters.to) chips.push({ id: 'to', label: `To: ${formatDate(filters.to)}` });
  return chips;
}
