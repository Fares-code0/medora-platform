import type { ReactNode } from 'react';

import { cn } from '@/utils/cn';

/**
 * Fact / FactGrid — the recurring label/value key-value pattern
 * (record cards, detail sidebars, drawers). Domain-free and prop-driven;
 * wrap `Fact`s in a `FactGrid` (a semantic <dl>). Promoted from the
 * patients feature when appointments became the third consumer
 * (FRONTEND_ARCHITECTURE §8.2 rule of three).
 */

export function Fact({
  label,
  truncate = true,
  children,
}: {
  label: string;
  /**
   * `false` for a value that must be read whole — a phone number cut to
   * "+20 100 214 33…" cannot be dialled. It wraps at its spaces instead.
   */
  truncate?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-caption font-semibold uppercase tracking-wider text-text-tertiary">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-0.5 text-body-sm text-text-primary',
          truncate ? 'truncate' : 'break-words',
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export function FactGrid({
  columns = 2,
  className,
  children,
}: {
  columns?: 1 | 2;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-4 gap-y-3',
        columns === 2 ? 'grid-cols-2' : 'grid-cols-1',
        className,
      )}
    >
      {children}
    </dl>
  );
}
