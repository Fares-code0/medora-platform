import { CalendarClock, ShieldAlert, UserPlus, UserRound, Users } from 'lucide-react';

import { MetricStrip, type MetricStripItem } from '@/components/patterns';
import { formatNumber } from '@/i18n';

import type { PatientsSummary } from '../model/selectors';

/**
 * Patients summary — practice-wide figures (whole roster, not the
 * filtered view) rendered as one compact metric band so the registry
 * table stays the hero of the page.
 */
export function PatientsSummaryCards({
  summary,
  loading,
}: {
  summary: PatientsSummary;
  loading: boolean;
}) {
  const format = (value: number) => formatNumber(value);

  const items: readonly MetricStripItem[] = [
    {
      id: 'total',
      label: 'Total patients',
      value: format(summary.total),
      icon: Users,
      tone: 'primary',
    },
    {
      id: 'active',
      label: 'Active patients',
      value: format(summary.active),
      icon: UserRound,
      tone: 'success',
    },
    {
      id: 'high-risk',
      label: 'High-risk',
      value: format(summary.highRisk),
      icon: ShieldAlert,
      tone: 'error',
    },
    {
      id: 'today',
      label: "Today's visits",
      value: format(summary.todaysVisits),
      icon: CalendarClock,
      tone: 'info',
    },
    {
      id: 'new',
      label: 'New this month',
      value: format(summary.newThisMonth),
      icon: UserPlus,
      tone: 'primary',
    },
  ];

  return <MetricStrip items={items} loading={loading} />;
}
