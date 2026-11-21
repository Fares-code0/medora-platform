import { cn } from '@/utils/cn';

import { BG_SOLID, TONE_CLASSES, toneAt } from './palette';
import type { NamedSeries } from './types';

/**
 * Distribution bars — horizontal bars for a categorical distribution (e.g.
 * patient age bands). Each row shows the label, a proportional track fill,
 * and the value with its share of the total. Auto-assigns categorical tones
 * from the analytics palette. Pure CSS, so it reflows cleanly on mobile.
 */
export interface DistributionBarsProps {
  series: NamedSeries;
  formatValue?: (value: number) => string;
  ariaLabel: string;
}

export function DistributionBars({
  series,
  formatValue = (value) => String(value),
  ariaLabel,
}: DistributionBarsProps) {
  const max = Math.max(1, ...series.points.map((p) => p.value));
  const total = series.points.reduce((sum, p) => sum + p.value, 0);

  return (
    /*
     * `div`, not `ul`. This carries `role="img"` so a screen reader hears one
     * labelled figure rather than four bars read as a list — the right call,
     * but on a `<ul>` that role overrode the list semantics and orphaned its
     * own `<li>` children, which axe flags as a serious WCAG A/AA violation
     * (`listitem`, found on /doctor/reports in the F-14 audit). The elements
     * now match the role instead of fighting it; nothing about the rendering
     * or the announcement changes.
     */
    <div className="flex flex-col gap-3" role="img" aria-label={ariaLabel}>
      {series.points.map((point, i) => {
        const pct = Math.round((point.value / max) * 100);
        const share = total > 0 ? Math.round((point.value / total) * 100) : 0;
        // Fill AND its darker same-hue edge. This is a CSS mark, not SVG, so
        // the edge is an inset ring — it must not change the bar's width,
        // which encodes the value.
        const slot = toneAt(i);
        return (
          <div key={point.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <span className="text-body-sm font-medium text-text-primary">{point.label}</span>
              <span className="text-caption text-text-tertiary tabular-nums">
                {formatValue(point.value)} · {share}%
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-pill bg-surface-sunken">
              <div
                className={cn(
                  'h-full rounded-pill ring-1 ring-inset transition-[width] duration-slow ease-out',
                  BG_SOLID[slot],
                  TONE_CLASSES[slot].ring,
                )}
                style={barWidth(pct)}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The one dynamic value the design system already allows as an inline style
 * (see Progress) — a computed bar width. Everything else is token classes.
 */
function barWidth(pct: number): { readonly width: string } {
  return { width: `${String(pct)}%` };
}
