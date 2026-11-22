import type { ReactNode } from 'react';

import { type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

import { PAGE_TITLE_CLASS } from './page-title';

/**
 * ContentHeader — page header per UX §1.2.
 * One h1 per page, optional caption, actions right-aligned (max 1 primary
 * + 2 secondary; overflow goes into a Dropdown — enforced by review).
 * The breadcrumb slot renders above the title for pages deeper than one
 * level. The optional icon chip carries the module's identity tone so
 * every page is recognizable at a glance without reading the title.
 */
export type ContentHeaderTone =
  'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'ai' | 'neutral';

const TONE_CHIP: Record<ContentHeaderTone, string> = {
  primary: 'bg-primary-subtle text-primary',
  secondary: 'bg-secondary-subtle text-secondary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
  info: 'bg-info-subtle text-info',
  ai: 'bg-accent-subtle text-accent',
  neutral: 'bg-surface-sunken text-text-secondary',
};

export interface ContentHeaderProps {
  title: string;
  caption?: string | undefined;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  /** Module identity chip rendered beside the title. */
  icon?: LucideIcon | undefined;
  tone?: ContentHeaderTone;
  className?: string;
}

export function ContentHeader({
  title,
  caption,
  breadcrumb,
  actions,
  icon: Icon,
  tone = 'primary',
  className,
}: ContentHeaderProps) {
  return (
    <header className={cn('flex flex-col gap-1.5', className)}>
      {breadcrumb ?? null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span
              aria-hidden="true"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-surface',
                TONE_CHIP[tone],
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
            {caption ? <p className="mt-0.5 text-body-sm text-text-secondary">{caption}</p> : null}
          </div>
        </div>
        {actions ? (
          // Wraps instead of overflowing when the actions outgrow a phone row.
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
