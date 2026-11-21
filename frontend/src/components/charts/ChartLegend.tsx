import { cn } from '@/utils/cn';

import { BG_SOLID, TONE_CLASSES } from './palette';
import type { AnalyticsTone } from './types';

/**
 * Interactive chart legend — click a swatch to toggle its series/slice.
 * Hidden entries render struck-through and dimmed. Swatch colors come from
 * the analytics token palette so the legend always matches the marks.
 */
export interface LegendItem {
  readonly key: string;
  readonly label: string;
  readonly tone: AnalyticsTone;
}

export interface ChartLegendProps {
  items: readonly LegendItem[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
  className?: string;
}

export function ChartLegend({ items, hidden, onToggle, className }: ChartLegendProps) {
  return (
    <ul className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => {
        const isHidden = hidden.has(item.key);
        return (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={!isHidden}
              onClick={() => onToggle(item.key)}
              /*
               * `min-h-6` and the vertical padding that reaches it: this is a
               * real toggle, and at `py-0.5` over an 11px caption it was a
               * 20px-tall target — under WCAG 2.5.8's 24px minimum, found by
               * measuring the rendered page at 375px rather than by reading
               * the class list. Growing it is the honest fix here (unlike the
               * `.hit-target` pseudo-element, which exists for glyphs that
               * must stay small because they sit inline in dense table rows —
               * a legend row has the 4px to spare).
               */
              className={cn(
                'inline-flex min-h-6 items-center gap-1.5 rounded-surface px-1 py-1 text-caption font-medium transition-opacity duration-fast',
                // Off, but still the control that turns it back on: a legible
                // colour, with the strike-through saying "off" (axe measured
                // text-disabled at 3.4:1).
                isHidden ? 'text-text-tertiary line-through' : 'text-text-secondary',
              )}
            >
              <span
                aria-hidden="true"
                /*
                 * The swatch carries the same darker edge as the mark it
                 * stands for. Without it a pale slot (chart-4, chart-5) was a
                 * 10px patch at 1.40:1 against the surface — the legend was
                 * the least legible instance of the colour it explains.
                 */
                className={cn(
                  'h-2.5 w-2.5 rounded-control ring-1',
                  isHidden
                    ? 'bg-border-strong ring-border-strong'
                    : cn(BG_SOLID[item.tone], TONE_CLASSES[item.tone].ring),
                )}
              />
              {item.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
