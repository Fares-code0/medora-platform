import type { HTMLAttributes } from 'react';

import { cn } from '@/utils/cn';

/**
 * PageContainer — DS §4.3 containers with UX §1.2 gutters.
 * `xl` (1280px) is the default app container; `2xl` (1440px) is for
 * data-dense tables and analytics; `md`/`sm` for settings and focused
 * flows. Gutters: 16px mobile / 24px tablet / 32px desktop.
 *
 * ── This component owns the page's EDGE SPACING, all four sides ──────
 * Horizontal gutters and the vertical rhythm are one decision, so they are
 * made in one place. They used to be two: the gutters here, and `py-*`
 * hand-written into every page's className. Twenty-six call sites had drifted
 * into three different rhythms — `py-6 md:py-8` on most pages, `py-5 md:py-6`
 * on Reports, `py-4 md:py-5` on the Doctor Overview and Appointments — so
 * navigating between two screens of the same product moved the content.
 *
 * The Doctor Overview's rhythm is the one that survived, because it is the
 * page the density target (<=1.5 screens at 1280x720, FRONTEND_CHECKLIST
 * §10.2) was measured against; the looser rhythms were never measured against
 * anything. A page still needing its own may pass `py-*` in `className` —
 * `cn` is tailwind-merge, so it replaces rather than compounds — but it is
 * now a visible exception rather than the default nobody chose.
 */
export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  width?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'prose';
  /**
   * Disable the page's own edge spacing — both the horizontal gutters and the
   * vertical rhythm (rare; full-bleed surfaces).
   */
  padded?: boolean;
}

const WIDTHS = {
  sm: 'max-w-container-sm',
  md: 'max-w-container-md',
  lg: 'max-w-container-lg',
  xl: 'max-w-container-xl',
  '2xl': 'max-w-container-2xl',
  prose: 'max-w-prose',
} as const;

export function PageContainer({
  width = 'xl',
  padded = true,
  className,
  ...rest
}: PageContainerProps) {
  return (
    <div
      className={cn(
        'mx-auto w-full',
        WIDTHS[width],
        padded && 'px-4 py-4 md:px-6 md:py-5 xl:px-8',
        className,
      )}
      {...rest}
    />
  );
}
