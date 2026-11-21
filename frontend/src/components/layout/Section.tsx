import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/utils/cn';

/**
 * Section — a titled content grouping inside a page (DS §4.4).
 * Separate unrelated sections by space-16 desktop / space-12 mobile —
 * done by the parent (e.g. a Stack with gap 12/16), not by this component.
 */
export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: string;
  caption?: string | undefined;
  /** Right-aligned header slot (e.g. a "View all" link). */
  actions?: ReactNode;
  /** Heading element, h2 by default; never skip levels (DS §3.4). */
  headingAs?: 'h2' | 'h3' | 'h4';
}

export function Section({
  title,
  caption,
  actions,
  headingAs: Heading = 'h2',
  className,
  children,
  ...rest
}: SectionProps) {
  return (
    <section className={cn('flex flex-col gap-3', className)} {...rest}>
      {title !== undefined || actions !== undefined ? (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title !== undefined ? (
              <Heading className="text-h5 font-semibold text-text-primary">{title}</Heading>
            ) : null}
            {caption ? <p className="mt-0.5 text-body-sm text-text-secondary">{caption}</p> : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
