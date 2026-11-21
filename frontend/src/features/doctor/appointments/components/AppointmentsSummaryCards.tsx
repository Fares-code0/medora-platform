import {
  Ban,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarSync,
  ClipboardList,
} from 'lucide-react';

import { MetricStrip, type MetricStripItem } from '@/components/patterns';

import type { AppointmentsSummary } from '../model/selectors';

/**
 * Appointments summary — one schedule band over the whole calendar (not
 * the filtered view) so the calendar/list view switcher stays the hero.
 */
export function AppointmentsSummaryCards({
  summary,
  loading,
}: {
  summary: AppointmentsSummary;
  loading: boolean;
}) {
  const items: readonly MetricStripItem[] = [
    {
      id: 'today',
      label: 'Today',
      value: String(summary.today),
      icon: CalendarDays,
      tone: 'warning',
    },
    {
      id: 'upcoming',
      label: 'Upcoming',
      value: String(summary.upcoming),
      icon: CalendarClock,
      tone: 'primary',
    },
    {
      id: 'completed',
      label: 'Completed',
      value: String(summary.completed),
      icon: CalendarCheck2,
      tone: 'success',
    },
    {
      id: 'cancelled',
      label: 'Cancelled',
      value: String(summary.cancelled),
      icon: Ban,
      tone: 'error',
    },
    {
      id: 'pending',
      label: 'Pending approval',
      value: String(summary.pending),
      icon: ClipboardList,
      tone: 'neutral',
    },
    {
      id: 'rescheduled',
      label: 'Rescheduled',
      value: String(summary.rescheduled),
      icon: CalendarSync,
      tone: 'info',
    },
  ];

  return <MetricStrip items={items} loading={loading} />;
}
