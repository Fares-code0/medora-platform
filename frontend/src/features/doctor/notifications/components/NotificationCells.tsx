import { StatusBadge } from '@/components/patterns';
import { Badge } from '@/components/ui';
import { cn } from '@/utils/cn';

import {
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_KIND_META,
  NOTIFICATION_PRIORITY_META,
  type DoctorNotification,
  type NotificationCategory,
} from '../model/types';

/**
 * Small presentational cells shared by the list rows, the detail drawer,
 * and the navbar bell feed — one implementation per visual.
 */

export function CategoryIcon({
  category,
  size = 'md',
}: {
  category: NotificationCategory;
  size?: 'sm' | 'md';
}) {
  const meta = NOTIFICATION_CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 items-center justify-center rounded-pill',
        size === 'md' ? 'h-8 w-8' : 'h-6 w-6',
        meta.iconClass,
      )}
    >
      <Icon className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} strokeWidth={1.75} />
    </span>
  );
}

export function NotificationPriorityBadge({ notification }: { notification: DoctorNotification }) {
  const meta = NOTIFICATION_PRIORITY_META[notification.priority];
  // Normal priority carries no badge — only deviations are highlighted.
  if (notification.priority === 'normal') return null;
  return <StatusBadge status={meta.kind} label={meta.label} />;
}

export function NotificationKindBadge({ notification }: { notification: DoctorNotification }) {
  return <Badge variant="neutral">{NOTIFICATION_KIND_META[notification.kind].label}</Badge>;
}
