import type { ReactNode } from 'react';

import { ErrorState } from '@/components/feedback/ErrorState';
import { Skeleton } from '@/components/feedback/Skeleton';
import { Card, type CardTone } from '@/components/ui/Card';
import type { MenuEntry } from '@/components/ui/Dropdown';

import { WidgetMenu } from './dashboard/WidgetMenu';

/**
 * DashboardWidget — UX P6 widget shell.
 * Card with h4 title header, optional range/action slot and ⋯ menu; owns
 * the widget-level loading (skeleton), error (in-place ErrorState with
 * Retry — one failed widget never takes down the page, DS §8.33), and
 * empty states so every dashboard widget behaves identically.
 */
export interface DashboardWidgetProps {
  title: string;
  subtitle?: string | undefined;
  /** Header slot next to the menu (e.g. a range Select or "View all" link). */
  actions?: ReactNode;
  /** ⋯ overflow menu entries (export, view as table…). */
  menu?: readonly MenuEntry[] | undefined;
  loading?: boolean;
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  /** Rendered instead of children when the widget has no data. */
  empty?: ReactNode;
  /** Card accent bar (e.g. `ai` for the AI surface — UX 1.5 provenance). */
  tone?: CardTone | undefined;
  className?: string | undefined;
  children?: ReactNode;
}

export function DashboardWidget({
  title,
  subtitle,
  actions,
  menu,
  loading = false,
  error,
  empty,
  tone,
  className,
  children,
}: DashboardWidgetProps) {
  const headerAction =
    actions !== undefined || menu !== undefined ? (
      <div className="flex items-center gap-2">
        {actions}
        {menu !== undefined ? <WidgetMenu title={title} entries={menu} /> : null}
      </div>
    ) : undefined;

  return (
    <Card
      title={title}
      subtitle={subtitle}
      headerAction={headerAction}
      tone={tone ?? 'none'}
      className={className}
    >
      <div aria-busy={loading || undefined}>
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-24 w-full rounded-surface" />
          </div>
        ) : error ? (
          <ErrorState
            title={error.title ?? `Couldn't load ${title.toLowerCase()}`}
            onRetry={error.onRetry}
            className="border-0"
          />
        ) : empty !== undefined ? (
          empty
        ) : (
          children
        )}
      </div>
    </Card>
  );
}
