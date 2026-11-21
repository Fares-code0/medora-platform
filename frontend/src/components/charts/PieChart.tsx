import { useMemo, useState } from 'react';

import { cn } from '@/utils/cn';

import { arcPath } from './chart-utils';
import { ChartLegend, type LegendItem } from './ChartLegend';
import { TONE_CLASSES } from './palette';
import type { Slice } from './types';


/**
 * Pie / Donut chart — token-colored segments with an interactive legend
 * (click to hide a slice; remaining slices re-proportion). Donut variant
 * shows the total in the hole. Native `<title>` tooltips give each slice a
 * value + share readout. Square viewBox keeps it circular at any width.
 */
export interface PieChartProps {
  slices: readonly Slice[];
  variant?: 'pie' | 'donut';
  formatValue?: (value: number) => string;
  ariaLabel: string;
  /** Center caption for the donut hole (e.g. "Patients"). */
  centerLabel?: string;
}

const SIZE = 220;
const CENTER = SIZE / 2;
const OUTER = 96;

export function PieChart({
  slices,
  variant = 'pie',
  formatValue = (value) => String(value),
  ariaLabel,
  centerLabel,
}: PieChartProps) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const inner = variant === 'donut' ? 56 : 0;

  const visible = slices.filter((s) => !hidden.has(s.label));
  const total = useMemo(() => visible.reduce((sum, s) => sum + s.value, 0), [visible]);

  const segments = useMemo(() => {
    let angle = 0;
    return visible.map((slice) => {
      const fraction = total > 0 ? slice.value / total : 0;
      const start = angle;
      const end = angle + fraction * 360;
      angle = end;
      // Guard the full-circle case (single slice) so the arc still renders.
      const safeEnd = end - start >= 360 ? end - 0.01 : end;
      return { slice, start, end: safeEnd, fraction };
    });
  }, [visible, total]);

  const legendItems: readonly LegendItem[] = slices.map((s) => ({
    key: s.label,
    label: s.label,
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
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0">
        <svg
          viewBox={`0 0 ${String(SIZE)} ${String(SIZE)}`}
          className="h-40 w-40"
          role="img"
          aria-label={ariaLabel}
        >
          {segments.map(({ slice, start, end, fraction }) => (
            <path
              key={slice.label}
              d={arcPath(CENTER, CENTER, OUTER, inner, start, end)}
              /*
               * The outline is the slice's own darker hue, not `stroke-surface`.
               * A surface-coloured separator only carved slices apart; it did
               * nothing to make a pale slice readable, and slots 4 and 5 of the
               * chart ramp are pale on purpose. Same-hue edges both separate
               * neighbours and carry the fill's contrast.
               */
              className={cn(
                TONE_CLASSES[slice.tone].fill,
                TONE_CLASSES[slice.tone].edge,
                'transition-opacity duration-fast hover:opacity-80',
              )}
              strokeWidth={1.5}
            >
              <title>{`${slice.label}: ${formatValue(slice.value)} (${Math.round(fraction * 100)}%)`}</title>
            </path>
          ))}
          {variant === 'donut' ? (
            <>
              <text
                x={CENTER}
                y={CENTER - 2}
                textAnchor="middle"
                className="fill-text-primary text-[22px] font-semibold"
              >
                {formatValue(total)}
              </text>
              {centerLabel ? (
                <text
                  x={CENTER}
                  y={CENTER + 16}
                  textAnchor="middle"
                  className="fill-text-tertiary text-[11px]"
                >
                  {centerLabel}
                </text>
              ) : null}
            </>
          ) : null}
        </svg>
      </div>
      <ChartLegend items={legendItems} hidden={hidden} onToggle={toggle} className="flex-col !items-start" />
    </div>
  );
}
