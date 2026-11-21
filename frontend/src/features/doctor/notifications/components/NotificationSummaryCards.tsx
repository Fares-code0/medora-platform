import { Bell, BellDot, CalendarClock, CalendarDays, TriangleAlert } from 'lucide-react';

import { MetricStrip, type MetricStripItem } from '@/components/patterns';

import type { NotificationsSummary } from '../model/selectors';

/**
 * Notifications summary — one compact activity band over the unarchived
 * dataset so the inbox itself stays the page's focal point.
 */
export function NotificationSummaryCards({
  summary,
  loading,
}: {
  summary: NotificationsSummary;
  loading: boolean;
}) {
  const items: readonly MetricStripItem[] = [
    { id: 'total', label: 'Total', value: String(summary.total), icon: Bell, tone: 'neutral' },
    {
      id: 'unread',
      label: 'Unread',
      value: String(summary.unread),
      icon: BellDot,
      tone: 'primary',
    },
    {
      id: 'critical',
      label: 'Critical',
      value: String(summary.critical),
      icon: TriangleAlert,
      tone: 'error',
    },
    {
      id: 'today',
      label: 'Today',
      value: String(summary.today),
      icon: CalendarClock,
      tone: 'info',
    },
    {
      id: 'week',
      label: 'This week',
      value: String(summary.thisWeek),
      icon: CalendarDays,
      tone: 'neutral',
    },
  ];

  return <MetricStrip items={items} loading={loading} />;
}
