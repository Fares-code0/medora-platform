import type { ReactNode } from 'react';

import { type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * SettingsCard — the grouped-card container every settings section is built
 * from. A subtle header (title + description + optional trailing action)
 * over a token surface, matching the "grouped cards" of enterprise account
 * settings. Distinct from the DS Card so the Settings Center reads as its
 * own surface, not another dashboard module.
 */
export interface SettingsCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  /** Remove body padding (e.g. for full-bleed lists). */
  flush?: boolean;
  children: ReactNode;
  className?: string;
}

export function SettingsCard({
  title,
  description,
  icon: Icon,
  action,
  flush = false,
  children,
  className,
}: SettingsCardProps) {
  return (
    <section
      className={cn('overflow-hidden rounded-surface border border-border bg-surface', className)}
    >
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-surface bg-surface-sunken text-text-secondary"
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-h5 font-semibold text-text-primary">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-body-sm text-text-secondary">{description}</p>
            ) : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={cn(flush ? '' : 'px-5 py-4')}>{children}</div>
    </section>
  );
}
