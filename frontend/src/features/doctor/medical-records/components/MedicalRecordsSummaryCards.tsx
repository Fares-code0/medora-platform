import { FilePlus2, FolderCheck, FolderHeart, FolderOpen, TriangleAlert } from 'lucide-react';

import { Grid } from '@/components/layout';
import { StatisticCard, type StatisticTone } from '@/components/patterns';
import { formatNumber } from '@/i18n';

import type { MedicalRecordsSummary } from '../model/selectors';

/**
 * Records summary — dataset metrics rendered as a compact stack that
 * sits in the xl metadata rail beside the records table (a responsive
 * grid below xl).
 */
export function MedicalRecordsSummaryCards({
  summary,
  loading,
}: {
  summary: MedicalRecordsSummary;
  loading: boolean;
}) {
  const cards: ReadonlyArray<{
    id: string;
    label: string;
    value: number;
    icon: typeof FolderHeart;
    tone: StatisticTone;
  }> = [
    {
      id: 'total',
      label: 'Total records',
      value: summary.total,
      icon: FolderHeart,
      tone: 'secondary',
    },
    { id: 'open', label: 'Open records', value: summary.open, icon: FolderOpen, tone: 'info' },
    {
      id: 'closed',
      label: 'Closed records',
      value: summary.closed,
      icon: FolderCheck,
      tone: 'success',
    },
    {
      id: 'critical',
      label: 'Critical cases',
      value: summary.critical,
      icon: TriangleAlert,
      tone: 'error',
    },
    {
      id: 'createdToday',
      label: 'Created today',
      value: summary.createdToday,
      icon: FilePlus2,
      tone: 'secondary',
    },
  ];

  return (
    <Grid columns={{ base: 1, md: 2, xl: 1 }} gap={3}>
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
