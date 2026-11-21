import { useMemo, useState } from 'react';

import { cn } from '@/utils/cn';

import {
  CHART_HEIGHT,
  CHART_WIDTH,
  areaPath,
  axisTicks,
  linePath,
  niceCeil,
  plotArea,
  xLabelIndexes,
  type Point,
} from './chart-utils';
import { ChartLegend, type LegendItem } from './ChartLegend';
import { TONE_CLASSES } from './palette';
import type { NamedSeries } from './types';


/**
 * Line / Area chart — multi-series, responsive SVG in a fixed viewBox. The
 * interactive legend toggles series; each vertex carries a native `<title>`
 * tooltip. Area variant fills under each line at low opacity. Colors come
 * from the analytics token palette, so the chart is theme-aware.
 */
export interface LineAreaChartProps {
  series: readonly NamedSeries[];
  variant?: 'line' | 'area';
  /** Formats the y-axis ticks and tooltips. */
  formatValue?: (value: number) => string;
  ariaLabel: string;
}

export function LineAreaChart({
  series,
  variant = 'line',
  formatValue = (value) => String(value),
  ariaLabel,
}: LineAreaChartProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const area = plotArea();

  const visible = series.filter((s) => !hidden.has(s.name));
  const labels = series[0]?.points.map((p) => p.label) ?? [];

  const max = useMemo(() => {
    const values = visible.flatMap((s) => s.points.map((p) => p.value));
    return niceCeil(Math.max(1, ...values));
  }, [visible]);

  const xAt = (index: number): number => {
    if (labels.length <= 1) return area.x0 + area.width / 2;
    return area.x0 + (index / (labels.length - 1)) * area.width;
  };
  const yAt = (value: number): number => area.y1 - (value / max) * area.height;

  const ticks = axisTicks(max);
  const labelIndexes = useMemo(() => xLabelIndexes(labels.length, area.width), [labels.length, area.width]);

  const legendItems: readonly LegendItem[] = series.map((s) => ({
    key: s.name,
    label: s.name,
    tone: s.tone,
  }));

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div>
      <svg
        viewBox={`0 0 ${String(CHART_WIDTH)} ${String(CHART_HEIGHT)}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
      >
        {/* Y grid + tick labels */}
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
              <text
                x={area.x0 - 8}
                y={y + 3}
                textAnchor="end"
                className="fill-text-tertiary text-micro"
              >
                {formatValue(tick)}
              </text>
            </g>
          );
        })}

        {/* X labels — thinned so neighbours cannot collide (see
            `xLabelIndexes`). Every point still exists on the line and in the
            accessible table; it is only the tick text that is sampled. */}
        {labelIndexes.map((i) => (
          <text
            key={`${labels[i] ?? ''}-${String(i)}`}
            x={xAt(i)}
            y={area.y1 + 18}
            textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
            className="fill-text-tertiary text-micro"
          >
            {labels[i]}
          </text>
        ))}

        {/* Series */}
        {visible.map((s) => {
          const points: Point[] = s.points.map((p, i) => ({ x: xAt(i), y: yAt(p.value) }));
          const tone = TONE_CLASSES[s.tone];
          return (
            <g key={s.name}>
              {variant === 'area' ? (
                <path
                  d={areaPath(points, area.y1)}
                  className={cn(tone.fill, 'opacity-15')}
                  stroke="none"
                />
              ) : null}
              <path
                d={linePath(points)}
                fill="none"
                className={tone.stroke}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
              {points.map((pt, i) => (
                <circle key={i} cx={pt.x} cy={pt.y} r={3} className={cn(tone.fill, 'stroke-surface')} strokeWidth={1.5}>
                  <title>{`${s.name} · ${s.points[i]?.label ?? ''}: ${formatValue(s.points[i]?.value ?? 0)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      <ChartLegend items={legendItems} hidden={hidden} onToggle={toggle} className="mt-3" />
    </div>
  );
}
