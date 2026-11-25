import type { ReactNode } from 'react';

import { type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

import { PAGE_TITLE_CLASS } from './page-title';

/**
 * ContentHeader — the page's header band: its breadcrumb, its one visible
 * `h1` with the module's icon chip, and its page-level actions.
 *
 * ── A compact page identity ──────────────────────────────────────────
 * Every page keeps a visible name: the title is what tells a clinician which
 * screen they are on, and the icon chip carries the module's tone so a page
 * is recognisable at a glance. What the band no longer carries by default is
 * the one-line caption under the title — on most pages a tagline ("Clinical
 * alerts, reminders and team updates.") that cost a line of height on every
 * screen and said nothing the title and the content do not.
 *
 * - The title, the chip and the actions share **one row**; the actions sit at
 *   the end of the line (logical, so it mirrors in RTL) and wrap beneath the
 *   title on a phone instead of overflowing.
 * - `caption` renders only with `showCaption`, for a band whose caption is
 *   real information rather than a tagline: a clinical detail page's record
 *   summary and patient name (the patient card stacks below the document on
 *   a phone, so this line is the one place the patient is named near the
 *   top), a settings page's scope, and the dashboard greeting's day summary.
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
  /** Shown under the title only with `showCaption`. */
  caption?: string | undefined;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  /** Module identity chip rendered beside the title. */
  icon?: LucideIcon | undefined;
  tone?: ContentHeaderTone;
  /**
   * Render `caption` under the title. Off by default: only for a caption that
   * is information the page needs near the top (see the module docblock).
   */
  showCaption?: boolean;
  className?: string;
}

function hasContent(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== '';
}

export function ContentHeader({
  title,
  caption,
  breadcrumb,
  actions,
  icon: Icon,
  tone = 'primary',
  showCaption = false,
  className,
}: ContentHeaderProps) {
  const visibleCaption = showCaption && caption !== undefined && caption !== '' ? caption : null;

  return (
    <header className={cn('flex flex-col gap-1.5', className)}>
      {hasContent(breadcrumb) ? breadcrumb : null}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon ? (
            <span
              aria-hidden="true"
              data-testid="content-header-icon"
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-surface',
                TONE_CHIP[tone],
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className={PAGE_TITLE_CLASS}>{title}</h1>
            {visibleCaption === null ? null : (
              <p className="mt-0.5 text-body-sm text-text-secondary">{visibleCaption}</p>
            )}
          </div>
        </div>
        {hasContent(actions) ? (
          // One row with the title; wraps beneath it instead of overflowing on a phone.
          <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
