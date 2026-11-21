import type { HTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

import type { StackGap } from './Stack';

/**
 * Grid — responsive column grid (DS §10.2).
 * `preset="kpi"` implements the dashboard KPI row (1 → 2 → 4 columns);
 * `preset="cards"` implements card lists (1 → 2 → 3). Custom column counts
 * per breakpoint cover the remaining §10.2 patterns.
 */
export interface GridColumns {
  readonly base?: 1 | 2 | 3 | 4;
  readonly md?: 1 | 2 | 3 | 4;
  readonly lg?: 1 | 2 | 3 | 4 | 6;
  readonly xl?: 1 | 2 | 3 | 4 | 6;
}

const BASE_COLS = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
} as const;
const MD_COLS = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
} as const;
const LG_COLS = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  6: 'lg:grid-cols-6',
} as const;
const XL_COLS = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  6: 'xl:grid-cols-6',
} as const;

const GAPS: Record<StackGap, string> = {
  0: 'gap-0',
  1: 'gap-1',
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
  8: 'gap-8',
  10: 'gap-10',
  12: 'gap-12',
  16: 'gap-16',
};

const PRESETS: Record<'kpi' | 'cards', GridColumns> = {
  kpi: { base: 1, md: 2, lg: 4 },
  cards: { base: 1, md: 2, lg: 3 },
};

export interface GridProps extends HTMLAttributes<HTMLDivElement> {
  columns?: GridColumns;
  preset?: 'kpi' | 'cards';
  /** Between cards in a grid the DS default is 6 (24px). */
  gap?: StackGap;
}

export function Grid({ columns, preset, gap = 6, className, ...rest }: GridProps) {
  const cols = columns ?? (preset ? PRESETS[preset] : { base: 1 });
  return (
    <div
      className={cn(
        'grid',
        BASE_COLS[cols.base ?? 1],
        cols.md !== undefined && MD_COLS[cols.md],
        cols.lg !== undefined && LG_COLS[cols.lg],
        cols.xl !== undefined && XL_COLS[cols.xl],
        GAPS[gap],
        className,
      )}
      {...rest}
    />
  );
}
