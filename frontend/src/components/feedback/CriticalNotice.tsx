import type { ReactNode } from 'react';

import { AlertTriangle, type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * CriticalNotice — a compact, undismissable notice for critical items that
 * need action: a plain card with a small red icon and a title, the list
 * beneath it. Severity is carried by the icon and the title alone — no
 * coloured card edge (Medora uses none, by design) and no red flood: the
 * large `error` Alert read as an emergency banner and pushed the dashboard
 * down.
 *
 * `role="alert"`, like the error Alert it replaces, and it has no dismiss
 * control: a critical item is resolved by acting on it, not by closing it.
 */
export interface CriticalNoticeProps {
  title: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string | undefined;
}

export function CriticalNotice({ title, icon: Icon = AlertTriangle, children, className }: CriticalNoticeProps) {
  return (
    <section
      role="alert"
      className={cn(
        'rounded-surface border border-border bg-surface shadow-card',
        className,
      )}
    >
      <header className="flex items-center gap-2 px-4 pt-3">
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-error" strokeWidth={2} />
        <p className="text-body-sm font-semibold text-text-primary">{title}</p>
      </header>
      <div className="px-4 pb-2 pt-1">{children}</div>
    </section>
  );
}
