import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Empty state — DS §8.31.
 * Centered, max-width 400px; the icon sits in a layered two-ring badge
 * tinted by the module tone so each module's empty state carries its
 * identity. Title states what is empty; description says why / what to
 * do next.
 *
 * ## `headingLevel`, and when a page IS its empty state
 *
 * The title is an `h2` by default, which is right for the usual case: an
 * empty state inside a panel or a tab, under a page that has its own `h1`.
 *
 * It is wrong for a *page-level* one. A detail route whose id does not
 * resolve renders nothing but this component, and an `h2` there left four
 * pages with no `h1` at all — found by walking the heading outline of
 * `/doctor/patients/NOPE-9999` and its three siblings. On those pages
 * "Patient not found" is not a section heading, it is the page title, so
 * they pass `headingLevel="h1"`.
 */
export type EmptyStateTone =
  'neutral' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'ai';

const TONE_RING: Record<EmptyStateTone, string> = {
  neutral: 'bg-surface-sunken text-text-tertiary',
  primary: 'bg-primary-subtle text-primary',
  secondary: 'bg-secondary-subtle text-secondary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
  info: 'bg-info-subtle text-info',
  ai: 'bg-accent-subtle text-accent',
};

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Module identity tint for the icon badge. */
  tone?: EmptyStateTone;
  /**
   * `h2` by default — correct beneath a page that has its own `h1`. Pass
   * `h1` when this component *is* the page, `h3` when it sits under a
   * titled section (DS §3.4, never skip levels).
   */
  headingLevel?: 'h1' | 'h2' | 'h3';
  className?: string;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  tone = 'neutral',
  headingLevel: Heading = 'h2',
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'mx-auto flex max-w-[400px] flex-col items-center justify-center gap-1.5 px-6 py-14 text-center',
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="mb-3 flex h-[72px] w-[72px] items-center justify-center rounded-pill border border-border bg-surface"
      >
        <span
          className={cn('flex h-14 w-14 items-center justify-center rounded-pill', TONE_RING[tone])}
        >
          <Icon className="h-6 w-6" strokeWidth={1.5} />
        </span>
      </div>
      <Heading className="text-h5 font-semibold text-text-primary">{title}</Heading>
      {description ? <p className="text-body-sm text-text-secondary">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
