import type { HTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

/**
 * Stack — one-dimensional flex layout on the 4px grid (DS §4).
 * Gap values map 1:1 to the DS spacing scale; nothing else may space
 * siblings ad hoc. Related gaps must be visibly smaller than group gaps.
 */
export type StackGap = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 16;

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

export interface StackProps extends HTMLAttributes<HTMLElement> {
  direction?: 'column' | 'row';
  gap?: StackGap;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  wrap?: boolean;
  as?: 'div' | 'section' | 'ul' | 'ol' | 'nav';
}

const ALIGN = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
  baseline: 'items-baseline',
} as const;

const JUSTIFY = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
} as const;

export function Stack({
  direction = 'column',
  gap = 4,
  align,
  justify,
  wrap = false,
  as: Component = 'div',
  className,
  ...rest
}: StackProps) {
  return (
    <Component
      className={cn(
        'flex',
        direction === 'column' ? 'flex-col' : 'flex-row',
        GAPS[gap],
        align && ALIGN[align],
        justify && JUSTIFY[justify],
        wrap && 'flex-wrap',
        className,
      )}
      {...rest}
    />
  );
}
