import { useRef } from 'react';
import type { ReactNode } from 'react';

import { useT } from '@/i18n';

import { Button } from './Button';
import { Modal } from './Modal';

/**
 * ConfirmationDialog — DS §8.14 destructive-confirmation rules.
 * The title states the consequence ("Cancel this appointment?") and the
 * confirm button is labelled with the verb ("Cancel appointment") — never
 * "OK"/"Yes". Esc and scrim-click are disabled: an explicit choice is
 * required. Initial focus lands on the least-destructive action (Cancel).
 */
export interface ConfirmationDialogProps {
  open: boolean;
  /** Called by the cancel button (the only way to dismiss). */
  onClose: () => void;
  onConfirm: () => void;
  /** Consequence-stating question, e.g. "Cancel this appointment?". */
  title: string;
  description?: string | undefined;
  /** Verb-labelled action, e.g. "Cancel appointment". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'destructive' | 'primary';
  /** Pending confirm action; keeps the dialog open with a busy button. */
  loading?: boolean;
  children?: ReactNode;
}

export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'destructive',
  loading = false,
  children,
}: ConfirmationDialogProps) {
  const t = useT();
  const shownCancelLabel = cancelLabel ?? t('ui.goBack');
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      dismissible={false}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={loading}>
            {shownCancelLabel}
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ?? null}
    </Modal>
  );
}
