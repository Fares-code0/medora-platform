import { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/utils/cn';

import type { HeatmapData } from './types';

/**
 * Activity heatmap — weekday × time-of-day intensity grid. Each cell's fill
 * opacity encodes its value against the grid max, using the primary token so
 * it stays theme-aware. Built with CSS grid (not SVG) so labels and cells
 * reflow cleanly on small screens. Native `title` gives a per-cell readout.
 */
export interface HeatmapProps {
  data: HeatmapData;
  ariaLabel: string;
  formatValue?: (value: number) => string;
}

const STEPS = [0, 0.15, 0.35, 0.55, 0.75, 1] as const;

/** Static grid-cols classes so no inline style is needed (columns ≤ 8). */
const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
};

/** Map an intensity 0..1 to a Tailwind primary opacity utility. */
function intensityClass(ratio: number): string {
  if (ratio <= 0) return 'bg-surface-sunken';
  if (ratio < STEPS[2]) return 'bg-primary/20';
  if (ratio < STEPS[3]) return 'bg-primary/40';
  if (ratio < STEPS[4]) return 'bg-primary/60';
  if (ratio < STEPS[5]) return 'bg-primary/80';
  return 'bg-primary';
}

export function Heatmap({ data, ariaLabel, formatValue = (v) => String(v) }: HeatmapProps) {
  /*
   * Below 420px the grid scrolls sideways, and a region that scrolls must be
   * reachable without a pointer (WCAG 2.1.1, axe `scrollable-region-focusable`
   * — found at 375px on /doctor/reports). DataTable's rule, applied here: the
   * scroller becomes a named, focusable region only while it overflows, so a
   * wide screen gets no tab stop that scrolls nothing. The figure itself
   * stays the `img` inside it.
   */
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const measure = useCallback(() => {
    const node = scrollerRef.current;
    if (node === null) return;
    setScrollable(node.scrollWidth > node.clientWidth + 1);
  }, []);
  useEffect(() => {
    const node = scrollerRef.current;
    if (node === null) return;
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div
      ref={scrollerRef}
      {...(scrollable ? { tabIndex: 0, role: 'region' as const, 'aria-label': ariaLabel } : {})}
      className={cn(
        'overflow-x-auto',
        scrollable && 'rounded-control focus-visible:outline-none focus-visible:shadow-focus',
      )}
    >
      <div role="img" aria-label={ariaLabel} className="min-w-[420px]">
        {/* Column headers */}
        <div className={cn('grid gap-1 ps-10', GRID_COLS[data.columns.length] ?? 'grid-cols-6')}>
          {data.columns.map((col) => (
            <div key={col} className="pb-1 text-center text-micro text-text-tertiary">
              {col}
            </div>
          ))}
        </div>

        {/* Rows */}
        <div className="flex flex-col gap-1">
          {data.rows.map((row, r) => (
            <div key={row} className="flex items-center gap-1">
              <div className="w-9 shrink-0 pe-1 text-end text-micro text-text-tertiary">{row}</div>
              <div className={cn('grid flex-1 gap-1', GRID_COLS[data.columns.length] ?? 'grid-cols-6')}>
                {data.columns.map((col, c) => {
                  const value = data.cells[r]?.[c] ?? 0;
                  const ratio = data.max > 0 ? value / data.max : 0;
                  return (
                    <div
                      key={col}
                      title={`${row} ${col}: ${formatValue(value)}`}
                      className={cn(
                        'aspect-[3/2] rounded-control transition-transform duration-fast hover:scale-105',
                        intensityClass(ratio),
                      )}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Scale legend */}
        <div className="mt-3 flex items-center justify-end gap-1.5 ps-10">
          <span className="text-micro text-text-tertiary">Less</span>
          {['bg-surface-sunken', 'bg-primary/20', 'bg-primary/40', 'bg-primary/60', 'bg-primary/80', 'bg-primary'].map(
            (klass) => (
              <span key={klass} className={cn('h-3 w-3 rounded-control', klass)} aria-hidden="true" />
            ),
          )}
          <span className="text-micro text-text-tertiary">More</span>
        </div>
      </div>
    </div>
  );
}
