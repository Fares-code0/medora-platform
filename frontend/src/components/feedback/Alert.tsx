import type { ReactNode } from 'react';

import { AlertCircle, CheckCircle2, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';

import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Alert (inline banner) — DS §8.22.
 * Persistent contextual message in the page flow. Critical clinical alerts
 * use the error variant, are not dismissible (`critical` ignores
 * onDismiss), and sit at the top of the content area. Error/warning use
 * role="alert"; info/success use role="status".
 */
export type AlertVariant = 'info' | 'success' | 'warning' | 'error';

const VARIANTS: Record<AlertVariant, { icon: LucideIcon; container: string; heading: string }> = {
  info: { icon: Info, container: 'border-info bg-info-subtle', heading: 'text-info' },
  success: {
    icon: CheckCircle2,
    container: 'border-success bg-success-subtle',
    heading: 'text-success',
  },
  warning: {
    icon: TriangleAlert,
    container: 'border-warning bg-warning-subtle',
    heading: 'text-warning',
  },
  error: { icon: AlertCircle, container: 'border-error bg-error-subtle', heading: 'text-error' },
};

export interface AlertProps {
  variant?: AlertVariant;
  title: string;
  children?: ReactNode;
  /** Inline actions rendered under the body (secondary/ghost buttons). */
  actions?: ReactNode;
  onDismiss?: (() => void) | undefined;
  /** Critical clinical alerts can never be dismissed (DS §8.22). */
  critical?: boolean;
  className?: string;
}

export function Alert({
  variant = 'info',
  title,
  children,
  actions,
  onDismiss,
  critical = false,
  className,
}: AlertProps) {
  const t = useT();
  const { icon: Icon, container, heading } = VARIANTS[variant];
  const dismissible = Boolean(onDismiss) && !critical;

  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={cn('flex items-start gap-3 rounded-surface border p-4', container, className)}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 h-5 w-5 shrink-0', heading)}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <p className={cn('text-body-sm font-semibold', heading)}>{title}</p>
        {children !== undefined ? (
          <div className="mt-1 text-body-sm text-text-secondary">{children}</div>
        ) : null}
        {actions ? <div className="mt-3 flex items-center gap-2">{actions}</div> : null}
      </div>
      {dismissible ? (
        <button
          type="button"
          aria-label={t('ui.dismiss')}
          onClick={onDismiss}
          className="touch-target shrink-0 rounded-control p-0.5 text-text-tertiary transition-colors duration-fast [--touch-x:12px] [--touch-y:12px] hover:text-text-primary"
        >
          <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}
