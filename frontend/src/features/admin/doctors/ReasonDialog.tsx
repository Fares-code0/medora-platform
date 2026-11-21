import { useEffect, useState } from 'react';

import type { LucideIcon } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Modal, Textarea } from '@/components/ui';

import { validateReason } from './doctors';

/**
 * The shared "say why" prompt behind every decision that reaches a doctor
 * (ADM-02 / ADM-03 · UX §3.2, §3.3): request more documents, reject an
 * application, reject a single document, suspend an account.
 *
 * One component rather than four because the obligation is the same in
 * every case — a written reason, sent to the person it is about — and
 * because a rejection that is easier to write than a document request would
 * quietly become the path of least resistance.
 *
 * `consequence` is the caller's chance to say what will happen before it
 * happens; §3.2 requires it for suspension, and it is optional elsewhere.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmIcon,
  tone = 'primary',
  placeholder,
  consequence,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  tone?: 'primary' | 'destructive';
  placeholder: string;
  consequence?: React.ReactNode;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setReason('');
      setReasonError(undefined);
    }
  }, [open, title]);

  const submit = () => {
    const check = validateReason(reason);
    if (!check.ok) {
      setReasonError(check.message);
      return;
    }
    setReasonError(undefined);
    onConfirm(reason);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      role={tone === 'destructive' ? 'alertdialog' : 'dialog'}
      dismissible={tone !== 'destructive'}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant={tone === 'destructive' ? 'destructive' : 'primary'}
            {...(confirmIcon ? { leadingIcon: confirmIcon } : {})}
            loading={submitting}
            onClick={submit}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {error ? (
          <Alert variant="error" title="Nothing was changed">
            {error}
          </Alert>
        ) : null}

        {consequence}

        <Textarea
          label="Reason"
          helperText="Sent to the doctor and recorded against your account."
          placeholder={placeholder}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
        />
      </form>
    </Modal>
  );
}
