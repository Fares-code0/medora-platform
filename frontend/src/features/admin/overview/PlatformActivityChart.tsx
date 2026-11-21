import { Activity } from 'lucide-react';

import { LineAreaChart, type NamedSeries } from '@/components/charts';
import { Skeleton } from '@/components/feedback';
import { Button } from '@/components/ui';

import { AsyncSection, Panel } from '../components/primitives';

import type { ActivityRange, OverviewWidgetSurface } from './overview.types';

/**
 * Row 2 left (§3.1) — platform activity over the selected window.
 *
 * `LineAreaChart` owns per-series legend toggling, so §3.1's "legend toggles
 * per series" needs nothing here; this component owns only the range switch
 * and the widget's own loading and error branches. The series it is handed
 * already share one x-axis (`overview.api.ts`) — three lines on three sets of
 * day labels would be three charts stacked on top of each other.
 */
export interface PlatformActivityChartProps extends OverviewWidgetSurface {
  series: readonly NamedSeries[];
  range: ActivityRange;
  onRangeChange: (range: ActivityRange) => void;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

const RANGES: readonly { readonly key: ActivityRange; readonly label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
];

export function PlatformActivityChart({
  series,
  range,
  onRangeChange,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: PlatformActivityChartProps) {
  return (
    <Panel
      title="Platform activity"
      menu={menu}
      className={className}
      description="Daily active users, appointments booked and messages sent."
      icon={Activity}
      tone="primary"
      action={
        <div className="flex items-center gap-1">
          {RANGES.map((option) => (
            <Button
              key={option.key}
              variant={option.key === range ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => {
                onRangeChange(option.key);
              }}
              aria-pressed={option.key === range}
            >
              {option.label}
            </Button>
          ))}
        </div>
      }
    >
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<ChartSkeleton />}
      >
        <LineAreaChart series={series} ariaLabel="Platform activity over time" />
      </AsyncSection>
    </Panel>
  );
}

/**
 * The default envelope skeleton is roughly half this chart's height, so the
 * panel body grows when the series land. `LineAreaChart` is a fixed-viewBox
 * SVG sized `h-auto w-full`, which makes its rendered height the body width
 * times 260/640 — reproducing that ratio here, plus the legend row it draws
 * underneath, keeps the body the same height before and after.
 */
function ChartSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[640/260] w-full rounded-surface" />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {['users', 'appointments', 'messages'].map((name) => (
          <Skeleton key={name} className="h-5 w-32 rounded-surface" />
        ))}
      </div>
    </div>
  );
}
