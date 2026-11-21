import { Clock, FlaskConical, FlaskRound, ListChecks, Sparkle, TriangleAlert } from 'lucide-react';

import { Grid } from '@/components/layout';
import { StatisticCard, type StatisticTone } from '@/components/patterns';
import { formatNumber } from '@/i18n';

import type { LabTestsSummary } from '../model/selectors';

/** Summary cards over the whole lab dataset (not the filtered view). */
export function LabSummaryCards({
  summary,
  loading,
}: {
  summary: LabTestsSummary;
  loading: boolean;
}) {
  const cards: ReadonlyArray<{
    id: string;
    label: string;
    value: number;
    icon: typeof FlaskConical;
    tone: StatisticTone;
  }> = [
    { id: 'total', label: 'Total tests', value: summary.total, icon: FlaskConical, tone: 'info' },
    { id: 'pending', label: 'Pending', value: summary.pending, icon: Clock, tone: 'warning' },
    {
      id: 'inProgress',
      label: 'In progress',
      value: summary.inProgress,
      icon: FlaskRound,
      tone: 'primary',
    },
    {
      id: 'completed',
      label: 'Completed',
      value: summary.completed,
      icon: ListChecks,
      tone: 'success',
    },
    {
      id: 'critical',
      label: 'Critical results',
      value: summary.critical,
      icon: TriangleAlert,
      tone: 'error',
    },
    { id: 'newToday', label: 'New today', value: summary.newToday, icon: Sparkle, tone: 'info' },
  ];

  return (
    <Grid columns={{ base: 1, md: 2, lg: 3, xl: 6 }} gap={4}>
      {cards.map((card) => (
        <StatisticCard
          key={card.id}
          label={card.label}
          value={formatNumber(card.value)}
          icon={card.icon}
          tone={card.tone}
          loading={loading}
        />
      ))}
    </Grid>
  );
}
