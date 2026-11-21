import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import {
  DashboardWidget,
  Sparkline,
  type StatisticDelta,
  type StatisticTone,
} from '@/components/patterns';
import { Badge, type BadgeVariant } from '@/components/ui';
import { cn } from '@/utils/cn';

import type { OverviewKpi } from '../model/mock-data';
import type { DashboardWidgetSlotProps } from '../model/widgets';

import { NoSourceYet } from './NoSourceYet';

/**
 * The four KPI tiles as four widgets, so a doctor keeps the figures they use
 * and drops the rest. They were one fixed row of `KpiWidget`s.
 *
 * Why not `KpiWidget` itself: it makes the whole card one link, and a card
 * may hold exactly one interactive element (DS §8.18), so it has nowhere to
 * put the ⋯ menu every dashboard widget needs to be removable. This keeps
 * `KpiWidget`'s content — icon chip, tabular figure, delta, caption,
 * sparkline — on the `DashboardWidget` shell every other widget uses, and
 * moves the link into that menu as "View details".
 *
 * Each figure is the Overview document's (FE-10.4): the mock's seeded KPI in
 * the demo, the one the API returned in a live build. The title is fixed
 * here rather than read from the KPI, so a tile keeps its heading while the
 * document loads or after it fails to.
 */

const TONE_CHIP: Record<StatisticTone, string> = {
  primary: 'bg-primary-subtle text-primary',
  secondary: 'bg-secondary-subtle text-secondary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
  info: 'bg-info-subtle text-info',
  ai: 'bg-accent-subtle text-accent',
  neutral: 'bg-surface-sunken text-text-secondary',
};

const DELTA_TONES: Record<StatisticDelta['tone'], BadgeVariant> = {
  positive: 'success',
  negative: 'error',
  neutral: 'neutral',
};

const DELTA_ICONS = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

const SPOKEN_DIRECTION = { up: 'up', down: 'down', flat: 'unchanged' } as const;

function MetricWidget({
  kpiId,
  title,
  overview,
  menu,
  className,
}: { kpiId: string; title: string } & DashboardWidgetSlotProps) {
  const navigate = useNavigate();
  const metric = overview.data?.kpis.find((entry) => entry.id === kpiId);

  return (
    <DashboardWidget
      title={title}
      loading={overview.loading}
      error={overview.error}
      // Loaded, and the document carries no such figure.
      empty={metric === undefined ? <NoSourceYet what="this figure" /> : undefined}
      /*
       * Fill the card, top to bottom. The layout gives every widget in a row
       * the row's height, and a metric often shares a row with a list or a
       * chart three times its natural height; left top-aligned, the figure
       * sat over an empty card. Card's body is its last child, and making it
       * grow lets the figure stay at the top while the caption and trend
       * settle to the bottom edge, so a tall metric reads as a tile, not a
       * gap. At its natural height the two halves simply meet.
       */
      className={cn(
        'flex flex-col [&>div:last-child>div]:h-full [&>div:last-child]:flex-1',
        className,
      )}
      menu={
        metric === undefined
          ? menu
          : [
              {
                id: 'view-details',
                label: 'View details',
                icon: ArrowUpRight,
                onSelect: () => {
                  navigate(metric.href);
                },
              },
              { type: 'separator', id: 'view-details-separator' },
              ...menu,
            ]
      }
    >
      {metric === undefined ? null : <MetricBody metric={metric} />}
    </DashboardWidget>
  );
}

function MetricBody({ metric }: { metric: OverviewKpi }) {
  const Icon = metric.icon;
  const DeltaIcon = metric.delta ? DELTA_ICONS[metric.delta.direction] : null;

  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-surface',
            TONE_CHIP[metric.tone],
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        {/* A template string, not `cn` — see StatisticCard: tailwind-merge
              reads `text-metric` as a colour and drops the size. */}
        <p className="text-metric font-bold text-text-primary tabular-nums">{metric.value}</p>
      </div>
      {metric.delta || metric.caption || metric.sparkline ? (
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {metric.delta && DeltaIcon ? (
              <Badge variant={DELTA_TONES[metric.delta.tone]} icon={DeltaIcon}>
                {metric.delta.label}
                <span className="sr-only">
                  {` ${SPOKEN_DIRECTION[metric.delta.direction]}${
                    metric.delta.comparison ? ` ${metric.delta.comparison}` : ''
                  }`}
                </span>
              </Badge>
            ) : null}
            {metric.caption ? (
              <span className="text-caption text-text-secondary">{metric.caption}</span>
            ) : null}
          </div>
          {metric.sparkline ? <Sparkline points={metric.sparkline} className="shrink-0" /> : null}
        </div>
      ) : null}
    </div>
  );
}

export function TodaysAppointmentsMetric(props: DashboardWidgetSlotProps) {
  return <MetricWidget kpiId="appointments-today" title="Today's appointments" {...props} />;
}

export function PendingRequestsMetric(props: DashboardWidgetSlotProps) {
  return <MetricWidget kpiId="pending-requests" title="Pending requests" {...props} />;
}

export function ActivePatientsMetric(props: DashboardWidgetSlotProps) {
  return <MetricWidget kpiId="total-patients" title="Active patients" {...props} />;
}

export function CompletedThisWeekMetric(props: DashboardWidgetSlotProps) {
  return <MetricWidget kpiId="completed-week" title="Completed this week" {...props} />;
}
