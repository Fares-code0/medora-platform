import {
  CalendarClock,
  CircleCheck,
  Pill,
  RefreshCw,
  ShieldAlert,
  Sparkle,
  type LucideIcon,
} from 'lucide-react';

import { Skeleton } from '@/components/feedback';
import { Grid } from '@/components/layout';
import { type StatisticTone } from '@/components/patterns';
import { Card } from '@/components/ui';
import { formatNumber } from '@/i18n';
import { cn } from '@/utils/cn';

import type { PharmacySummary } from '../model/selectors';

/**
 * Pharmacy summary — two grouped clinical panels (prescription volume ·
 * medication safety) instead of a flat KPI grid, so the module reads as
 * a medication-safety surface at a glance.
 */
interface PanelRow {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly icon: LucideIcon;
  readonly tone: StatisticTone;
}

const TONE_TEXT: Record<StatisticTone, string> = {
  primary: 'text-primary',
  secondary: 'text-secondary',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  info: 'text-info',
  ai: 'text-accent',
  neutral: 'text-text-tertiary',
};

function Panel({
  title,
  rows,
  loading,
}: {
  title: string;
  rows: readonly PanelRow[];
  loading: boolean;
}) {
  return (
    <Card padding="compact">
      <p className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
        {title}
      </p>
      <div className="mt-2 flex flex-col divide-y divide-border">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <Icon
                  aria-hidden="true"
                  className={cn('h-4 w-4 shrink-0', TONE_TEXT[row.tone])}
                  strokeWidth={1.75}
                />
                <span className="truncate text-body-sm text-text-secondary">{row.label}</span>
              </span>
              {loading ? (
                <Skeleton className="h-4 w-8" />
              ) : (
                <span className="text-h5 font-bold text-text-primary tabular-nums">
                  {formatNumber(row.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function PharmacySummaryCards({
  summary,
  loading,
}: {
  summary: PharmacySummary;
  loading: boolean;
}) {
  const volume: readonly PanelRow[] = [
    {
      id: 'total',
      label: 'Total prescriptions',
      value: summary.total,
      icon: Pill,
      tone: 'success',
    },
    {
      id: 'active',
      label: 'Active medications',
      value: summary.active,
      icon: CircleCheck,
      tone: 'primary',
    },
    { id: 'newToday', label: 'New today', value: summary.newToday, icon: Sparkle, tone: 'success' },
  ];

  const safety: readonly PanelRow[] = [
    {
      id: 'highRisk',
      label: 'High-risk medications',
      value: summary.highRisk,
      icon: ShieldAlert,
      tone: 'error',
    },
    {
      id: 'pendingRefills',
      label: 'Pending refills',
      value: summary.pendingRefills,
      icon: RefreshCw,
      tone: 'warning',
    },
    {
      id: 'expired',
      label: 'Expired prescriptions',
      value: summary.expired,
      icon: CalendarClock,
      tone: 'neutral',
    },
  ];

  return (
    <Grid columns={{ base: 1, md: 2 }} gap={4}>
      <Panel title="Prescription volume" rows={volume} loading={loading} />
      <Panel title="Medication safety" rows={safety} loading={loading} />
    </Grid>
  );
}
