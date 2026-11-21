import { useId } from 'react';

import { AlertCircle, CheckCircle2, Info, TriangleAlert, X, type LucideIcon } from 'lucide-react';

import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

/**
 * Toast — DS §8.23 (presentational).
 * Rendered by the ToastProvider host in a top-right stack.
 * Success/info auto-dismiss 5s, warning 8s, errors persist — the provider
 * owns timers (paused on hover/focus); this component only renders.
 * Never put critical clinical information in a toast (DS §8.23).
 *
 * **This element is not a live region.** The provider announces each toast
 * through its own persistent announcer (F-18), carrying the title and
 * description only. A toast that was itself `role="status"`/`"alert"`
 * inside the host's `aria-live` stack nested one live region in another —
 * a known cause of double or missed announcements — and put the dismiss
 * button's name into what was read out.
 */
export type ToastVariant = 'success' | 'info' | 'warning' | 'error';

export interface ToastAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface ToastData {
  readonly id: string;
  readonly variant: ToastVariant;
  readonly title: string;
  readonly description?: string;
  readonly action?: ToastAction;
}

const VARIANT_ICONS: Record<ToastVariant, { icon: LucideIcon; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-success' },
  info: { icon: Info, className: 'text-info' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: AlertCircle, className: 'text-error' },
};

export interface ToastProps {
  toast: ToastData;
  onDismiss: () => void;
  className?: string;
}

export function Toast({ toast, onDismiss, className }: ToastProps) {
  const { icon: Icon, className: iconClass } = VARIANT_ICONS[toast.variant];
  const t = useT();
  const titleId = useId();

  return (
    <div
      className={cn(
        'flex w-[360px] max-w-full items-start gap-3 rounded-surface border border-border bg-surface-overlay p-4 shadow-modal',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('mt-0.5 h-5 w-5 shrink-0', iconClass)}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <p id={titleId} className="text-body-sm font-semibold text-text-primary">
          {toast.title}
        </p>
        {toast.description ? (
          <p className="mt-0.5 text-body-sm text-text-secondary">{toast.description}</p>
        ) : null}
        {toast.action ? (
          <button
            type="button"
            onClick={toast.action.onClick}
            aria-describedby={titleId}
            className="mt-2 rounded-control text-body-sm font-semibold text-primary transition-colors duration-fast hover:text-primary-hover"
          >
            {toast.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        // Which toast it closes, for a reader that reaches several of them.
        aria-label={t('shell.dismissNotification')}
        aria-describedby={titleId}
        onClick={onDismiss}
        // Alert's dismiss geometry, so a coarse pointer gets 44 × 44 (DEC-008).
        className="touch-target shrink-0 rounded-control p-0.5 text-text-tertiary transition-colors duration-fast [--touch-x:12px] [--touch-y:12px] hover:text-text-primary"
      >
        <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  );
}
