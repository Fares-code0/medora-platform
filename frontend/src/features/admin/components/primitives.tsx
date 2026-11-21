import { useId, type ReactNode } from 'react';

import type { LucideIcon } from 'lucide-react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { WidgetMenu } from '@/components/patterns';
import type { MenuEntry } from '@/components/ui';
import { cn } from '@/utils/cn';

import { loadFailureDescription } from '../refusal';

/**
 * Administration Center — presentational primitives (Phase 17).
 * Console-style overlines, accented panels and icon tiles.
 *
 * This file once argued that the area should be "deliberately distinct from
 * the platform dashboard patterns". Waves 2c and 2d retired that position for
 * the two places it had produced a second implementation: `DataGrid` became
 * `DataTable` with an admin configuration, and `MetricTile` became
 * `StatisticCard layout="stacked"`. What remains here is genuinely the area's
 * own — a panel with an accent strip, and the overline voice — rather than a
 * parallel version of something the platform already has.
 */

export type Tone = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'accent';

const TONE_TILE: Record<Tone, string> = {
  primary: 'bg-primary-subtle text-primary',
  secondary: 'bg-success-subtle text-secondary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
  info: 'bg-info-subtle text-info',
  accent: 'bg-accent-subtle text-accent',
};

/** Uppercase console-style label used across the area. */
export function Overline({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The empty message an admin table shows when a filter matches nothing.
 *
 * Reproduces the dashed panel `DataGrid` drew before Wave 2c-b, so the
 * migration to `DataTable` does not change what an administrator sees when a
 * filter comes back empty. One difference is deliberate and is the only
 * accepted behaviour change of the migration: `DataGrid` replaced the entire
 * table, taking the column headers with it, whereas `DataTable` keeps the
 * header and puts this inside the body — so the reader can still see which
 * columns they filtered into nothing.
 */
export function GridEmpty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-surface border border-dashed border-border px-4 py-8 text-center text-body-sm text-text-secondary">
      {children}
    </p>
  );
}

/** Small square icon tile — the recurring motif of the area. */
export function IconTile({
  icon: Icon,
  tone = 'primary',
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-surface',
        TONE_TILE[tone],
        className,
      )}
    >
      <Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </span>
  );
}

export interface PanelProps {
  title?: string | undefined;
  /**
   * Heading element for `title`, h2 by default — correct directly beneath a
   * page h1, which is what SectionShell renders. Drop to h3/h4 only when the
   * panel is nested under another heading (DS §3.4, never skip levels).
   */
  headingAs?: 'h2' | 'h3' | 'h4';
  description?: string | undefined;
  icon?: LucideIcon | undefined;
  tone?: Tone | undefined;
  action?: ReactNode;
  /**
   * A dashboard widget's ⋯ menu, after `action`. The same control the Doctor
   * Overview's widgets carry, so a Panel placed on the Admin Overview is
   * removable the same way. Needs a `title` to name it.
   */
  menu?: readonly MenuEntry[] | undefined;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
}

/**
 * Panel — the area's surface container. A left-accented header strip with an
 * icon tile distinguishes it from the platform Card.
 */
export function Panel({
  title,
  headingAs: Heading = 'h2',
  description,
  icon,
  tone = 'primary',
  action,
  menu,
  children,
  className,
  bodyClassName,
}: PanelProps) {
  /*
   * A bare `<section>` carries no role at all until it has an accessible name,
   * so an admin page full of panels reads to a screen reader as one
   * undifferentiated run of content. Naming the section from its own heading
   * makes each panel a navigable region — and only when there is a title to
   * name it with, since an unnamed landmark would be worse than none.
   */
  const headingId = useId();

  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cn(
        'flex flex-col overflow-hidden rounded-surface border border-border bg-surface',
        className,
      )}
    >
      {title ? (
        <header
          className={cn(
            'flex items-start justify-between gap-3 border-b border-border px-5 py-4',
            /*
             * A dashboard widget can be laid out as narrow as 20rem, where the
             * title, an action and the ⋯ menu do not all fit on one line.
             * There the controls wrap beneath the title rather than truncating
             * it ("System he…"); anywhere they fit, nothing moves.
             */
            menu && 'flex-wrap',
          )}
        >
          <div className={cn('flex min-w-0 items-start gap-3', menu && 'flex-1 basis-48')}>
            {icon ? <IconTile icon={icon} tone={tone} /> : null}
            <div className="min-w-0">
              <Heading
                id={headingId}
                className="truncate text-body font-semibold text-text-primary"
              >
                {title}
              </Heading>
              {description ? (
                <p className="mt-0.5 text-caption text-text-secondary">{description}</p>
              ) : null}
            </div>
          </div>
          {action || menu ? (
            <div className={cn('flex shrink-0 items-center gap-2', menu && 'ms-auto')}>
              {action}
              {menu ? <WidgetMenu title={title} entries={menu} /> : null}
            </div>
          ) : null}
        </header>
      ) : null}
      <div className={cn('flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * AsyncSection — standard loading/error envelope for a query-backed view.
 * Keeps every section's loading and failure handling identical.
 */
export function AsyncSection({
  isLoading,
  isError,
  onRetry,
  skeleton,
  error,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  onRetry?: (() => void) | undefined;
  skeleton?: ReactNode;
  /**
   * The failure, when the caller has it (FE-10.10). A section with no
   * backend reads "Not connected yet", and a refused permission says so,
   * instead of both looking like a transient fault Retry might fix.
   */
  error?: unknown;
  children: ReactNode;
}) {
  if (isLoading) {
    return <>{skeleton ?? <DefaultSkeleton />}</>;
  }
  if (isError) {
    const description = loadFailureDescription(error);
    return (
      <ErrorState
        onRetry={onRetry}
        error={error}
        {...(description === undefined ? {} : { description })}
      />
    );
  }
  return <>{children}</>;
}

function DefaultSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-11 w-full rounded-surface" />
      <Skeleton className="h-24 w-full rounded-surface" />
      <Skeleton className="h-24 w-full rounded-surface" />
    </div>
  );
}
