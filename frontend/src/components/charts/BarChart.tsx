import { useMemo } from 'react';

import { cn } from '@/utils/cn';

import {
  CHART_HEIGHT,
  CHART_WIDTH,
  axisTicks,
  niceCeil,
  plotArea,
} from './chart-utils';
import { TONE_CLASSES } from './palette';
import type { AnalyticsTone, NamedSeries } from './types';


/**
 * Bar chart — a single categorical series with a value axis, gridlines, and
 * per-bar native `<title>` tooltips. Bars use the series tone from the
 * analytics palette; hover lifts their opacity. Responsive via viewBox.
 */
export interface BarChartProps {
  series: NamedSeries;
  formatValue?: (value: number) => string;
  ariaLabel: string;
  /** Override the single tone with a per-bar tone (e.g. status colors). */
  barTones?: readonly AnalyticsTone[];
}

export function BarChart({
  series,
  formatValue = (value) => String(value),
  ariaLabel,
  barTones,
}: BarChartProps) {
  const area = plotArea();
  const points = series.points;

  const max = useMemo(
    () => niceCeil(Math.max(1, ...points.map((p) => p.value))),
    [points],
  );

  const ticks = axisTicks(max);
  const slot = points.length > 0 ? area.width / points.length : area.width;
  const barWidth = Math.min(48, slot * 0.6);

  const yAt = (value: number): number => area.y1 - (value / max) * area.height;

  return (
    <svg
      viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`}
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {ticks.map((tick) => {
        const y = yAt(tick);
        return (
          <g key={tick}>
            <line
              x1={area.x0}
              x2={area.x1}
              y1={y}
              y2={y}
              className="stroke-border"
              strokeWidth={1}
              strokeDasharray={tick === 0 ? undefined : '3 3'}
              vectorEffect="non-scaling-stroke"
            />
            <text x={area.x0 - 8} y={y + 3} textAnchor="end" className="fill-text-tertiary text-micro">
              {formatValue(tick)}
            </text>
          </g>
        );
      })}

      {points.map((point, i) => {
        const cx = area.x0 + slot * i + slot / 2;
        const y = yAt(point.value);
        const tone = TONE_CLASSES[barTones?.[i] ?? series.tone];
        return (
          <g key={point.label}>
            <rect
              x={cx - barWidth / 2}
              y={y}
              width={barWidth}
              height={Math.max(0, area.y1 - y)}
              rx={3}
              // The darker same-hue outline. Chart slots 4 and 5 are pale by
              // design (2.21:1 and 1.40:1 against the surface) and rely on
              // this to reach 3:1 — a bar drawn without it is unreadable.
              className={cn(tone.fill, tone.edge, 'transition-opacity duration-fast hover:opacity-80')}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${point.label}: ${formatValue(point.value)}`}</title>
            </rect>
            <text x={cx} y={area.y1 + 18} textAnchor="middle" className="fill-text-tertiary text-micro">
              {point.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
