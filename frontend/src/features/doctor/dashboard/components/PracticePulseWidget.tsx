import { Minus, TrendingDown, TrendingUp } from 'lucide-react';

import { DashboardWidget, type StatisticDelta } from '@/components/patterns';
import { Badge, type BadgeVariant, type MenuEntry } from '@/components/ui';

import type { OverviewStatistic } from '../model/mock-data';

import { NoSourceYet } from './NoSourceYet';

/**
 * Practice pulse (UX 2.1 Row 3, recomposed) — the operational statistics
 * as one compact metric list instead of three identical cards, so the
 * dashboard reads as an executive overview rather than a card grid.
 *
 * It draws exactly the statistics it is given. Live, that is the no-show
 * rate alone — the one pulse metric the API's counts can source — with its
 * denominator as the caption; the demo's three-row fixture is never a fallback.
 */
const DELTA_TONES: Record<StatisticDelta['tone'], BadgeVariant> = {
  positive: 'success',
  negative: 'error',
  neutral: 'neutral',
};

const DELTA_ICONS = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

export function PracticePulseWidget({
  statistics,
  loading = false,
  error,
  menu,
  className,
}: {
  /** Null when the source has no operational metrics to give. */
  statistics: readonly OverviewStatistic[] | null;
  loading?: boolean;
  error?: { readonly onRetry?: () => void } | undefined;
  /** The widget's ⋯ menu, from the Overview's widget grid. */
  menu?: readonly MenuEntry[] | undefined;
  className?: string | undefined;
}) {
  return (
    <DashboardWidget
      title="Practice pulse"
      subtitle="Operational metrics · last 30 days"
      menu={menu}
      className={className}
      loading={loading}
      error={error}
      empty={statistics === null ? <NoSourceYet what="operational metrics" /> : undefined}
    >
      <div className="flex flex-col divide-y divide-border">
        {(statistics ?? []).map((stat) => {
          const DeltaIcon = stat.delta ? DELTA_ICONS[stat.delta.direction] : null;
          /*
           * A grid, not a two-child flex row (D-02). The value sits to the
           * right of the label/delta stack, but a screen reader follows the
           * DOM, so the flex version announced "…duration, 2 min down vs last
           * month, 24 min" — the movement before the thing that moved. Grid
           * placement lets the DOM run label → value → delta, matching
           * StatisticCard's order, while the value still paints in column 2
           * centred against both rows exactly as before.
           */
          return (
            <div
              key={stat.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-3 first:pt-0 last:pb-0"
            >
              <p className="col-start-1 row-start-1 text-body-sm text-text-secondary">
                {stat.label}
              </p>
              <p className="col-start-2 row-start-1 row-span-2 self-center text-h3 font-semibold text-text-primary tabular-nums">
                {stat.value}
              </p>
              {stat.delta && DeltaIcon ? (
                <Badge
                  variant={DELTA_TONES[stat.delta.tone]}
                  icon={DeltaIcon}
                  className="col-start-1 row-start-2 mt-1 justify-self-start"
                >
                  {stat.delta.label}
                  <span className="sr-only">
                    {` ${stat.delta.direction === 'up' ? 'up' : stat.delta.direction === 'down' ? 'down' : 'unchanged'}${
                      stat.delta.comparison ? ` ${stat.delta.comparison}` : ''
                    }`}
                  </span>
                </Badge>
              ) : null}
              {/*
               * Last in the DOM, so a screen reader hears the figure before
               * what it was counted from: "No-show rate (30d), 4.2%, 3 of 72
               * appointments". A rate is only readable beside its denominator.
               */}
              {stat.caption ? (
                <p
                  className={`col-start-1 mt-1 text-caption text-text-secondary ${
                    stat.delta ? 'row-start-3' : 'row-start-2'
                  }`}
                >
                  {stat.caption}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </DashboardWidget>
  );
}
