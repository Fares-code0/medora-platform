import { useEffect, useId } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';

import { AnimatePresence, m } from 'framer-motion';
import { X } from 'lucide-react';

import { useT } from '@/i18n';
import { EASE_EMPHASIZED, motionTokens } from '@/styles/motion';
import { cn } from '@/utils/cn';

import { useModalDialog } from './internal/useModalDialog';
/**
 * Modal (Dialog) — DS §8.14.
 * Built on native <dialog>: focus trap, Esc handling, inert background,
 * and focus return to the trigger are platform-provided. Sizes sm/md/lg;
 * header (h3 title + close) · scrollable body (max 70vh) · footer with
 * right-aligned actions. Non-dismissible mode is for confirmations that
 * require an explicit choice. Panel enters with fade + scale 0.96→1.
 */
const SIZES = { sm: 'max-w-[400px]', md: 'max-w-[560px]', lg: 'max-w-[720px]' } as const;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Supporting sentence under the title, linked via aria-describedby. */
  description?: string | undefined;
  size?: keyof typeof SIZES;
  /** Confirmation dialogs require an explicit choice (DS §8.14). */
  dismissible?: boolean;
  /** Right-aligned actions: primary rightmost, cancel to its left. */
  footer?: ReactNode;
  /** Receives focus on open; defaults to the dialog's first focusable. */
  initialFocusRef?: RefObject<HTMLElement | null> | undefined;
  role?: 'dialog' | 'alertdialog';
  children: ReactNode;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  dismissible = true,
  footer,
  initialFocusRef,
  role = 'dialog',
  children,
}: ModalProps) {
  const t = useT();
  const titleId = useId();
  const descriptionId = useId();
  // Esc key: honoured only when dismissible.
  const { dialogRef, closing, onExitComplete } = useModalDialog(open, () => {
    if (dismissible) onClose();
  });

  useEffect(() => {
    if (open) initialFocusRef?.current?.focus();
  }, [open, initialFocusRef]);

  const duration = motionTokens.duration.menu;

  return (
    <dialog
      ref={dialogRef}
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-motion=""
      data-closing={closing ? '' : undefined}
      style={{ '--dialog-motion': `${String(duration * 1000)}ms` } as CSSProperties}
      onClick={(event) => {
        // Scrim click closes when dismissible (the event target is the
        // dialog element itself only when clicking the backdrop area).
        if (dismissible && event.target === dialogRef.current) onClose();
      }}
      className={cn('w-full bg-transparent p-0 backdrop:bg-scrim', SIZES[size])}
    >
      <AnimatePresence onExitComplete={onExitComplete}>
        {open ? (
          // The surface is the panel, not the dialog, so it fades with it.
          <m.div
            key="modal-panel"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration, ease: EASE_EMPHASIZED }}
            className="rounded-surface bg-surface-overlay shadow-modal"
          >
            <div className="flex items-start justify-between gap-4 p-6">
              <div className="min-w-0">
                <h2 id={titleId} className="text-h4 font-semibold text-text-primary">
                  {title}
                </h2>
                {description ? (
                  <p id={descriptionId} className="mt-1 text-body-sm text-text-secondary">
                    {description}
                  </p>
                ) : null}
              </div>
              {dismissible ? (
                <button
                  type="button"
                  aria-label={t('ui.closeDialog')}
                  onClick={onClose}
                  className="touch-target rounded-surface p-1 text-text-tertiary transition-colors duration-fast [--touch-x:8px] [--touch-y:8px] hover:text-text-primary"
                >
                  <X aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
            <div className="max-h-[70vh] overflow-y-auto px-6 pb-6">{children}</div>
            {footer ? (
              <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
                {footer}
              </div>
            ) : null}
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  );
}
