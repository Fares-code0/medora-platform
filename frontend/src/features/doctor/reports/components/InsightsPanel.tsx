import { Minus, Sparkles, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import { TONE_CLASSES } from '@/components/charts';
import { Skeleton } from '@/components/feedback';
import { cn } from '@/utils/cn';

import type { Insight } from '../model/types';

/**
 * Insights panel — auto-generated observations (highest workload, busiest
 * day, critical patients, prescription/lab trends, revenue momentum) derived
 * from the current snapshot. Framed as AI-generated cards; each carries a
 * tone-tinted icon and a trend arrow. Mock intelligence, clearly labelled.
 */

const TREND_ICON: Record<'up' | 'down' | 'flat', LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

export function InsightsPanel({
  insights,
  loading,
}: {
  insights: readonly Insight[];
  loading?: boolean;
}) {
  return (
    <div className="flex h-full flex-col rounded-surface border border-border bg-gradient-to-b from-accent-subtle to-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-surface bg-accent-subtle text-accent"
        >
          <Sparkles className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div>
          <h3 className="text-h5 font-semibold text-text-primary">AI insights</h3>
          <p className="text-caption text-text-secondary">Auto-generated from this view</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-surface" />
          ))}
        </div>
      ) : insights.length === 0 ? (
        <p className="text-body-sm text-text-secondary">No insights for this view.</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {insights.map((insight) => {
            const tone = TONE_CLASSES[insight.tone];
            const TrendIcon = insight.trend ? TREND_ICON[insight.trend] : null;
            return (
              <li key={insight.id} className="rounded-surface border border-border bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn('text-caption font-semibold uppercase tracking-wider', tone.text)}
                  >
                    {insight.title}
                  </span>
                  {TrendIcon ? (
                    <TrendIcon
                      className={cn('h-3.5 w-3.5', tone.text)}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <p className="mt-1 text-body-sm text-text-secondary">{insight.detail}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
