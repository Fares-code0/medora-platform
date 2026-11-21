import type { ReactNode } from 'react';

import { cn } from '@/utils/cn';

/**
 * SettingsRow — one labelled control inside a SettingsCard: title +
 * description on the left, the control (switch, select, buttons) on the
 * right. Rows stack with a hairline divider between them (the `divided`
 * default). On narrow viewports the control drops below the label.
 */
export interface SettingsRowProps {
  title: string;
  description?: ReactNode;
  /** The control rendered on the trailing side. */
  control?: ReactNode;
  htmlFor?: string;
  /** Stack the control under the label even on wide viewports. */
  stacked?: boolean;
  className?: string;
  children?: ReactNode;
}

export function SettingsRow({
  title,
  description,
  control,
  htmlFor,
  stacked = false,
  className,
  children,
}: SettingsRowProps) {
  const Label = htmlFor ? 'label' : 'div';
  return (
    <div
      className={cn(
        'flex gap-4 py-3.5 first:pt-0 last:pb-0',
        stacked ? 'flex-col' : 'flex-col sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <Label {...(htmlFor ? { htmlFor } : {})} className="min-w-0 max-w-prose">
        <span className="block text-body-sm font-medium text-text-primary">{title}</span>
        {description ? (
          <span className="mt-0.5 block text-caption text-text-secondary">{description}</span>
        ) : null}
      </Label>
      {control ? <div className="shrink-0 sm:ps-4">{control}</div> : null}
      {children}
    </div>
  );
}

/** A hairline-divided list of settings rows inside a card. */
export function SettingsRowList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}
