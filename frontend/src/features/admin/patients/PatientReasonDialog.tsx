import { useEffect, useState } from 'react';

import type { LucideIcon } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Modal, Textarea } from '@/components/ui';

import { validateReason } from './patients';

/**
 * The "say why" prompt behind every ADM-04 decision that changes what
 * somebody can reach: deactivating an account, revoking a grant, declining
 * an access request (UX §3.4 — each is a P4).
 *
 * Separate from the doctors module's dialog of the same shape because the
 * obligation is different in a way the copy has to carry: a doctor-facing
 * reason is *sent to the doctor*, while these are kept on the patient's
 * account record and read back during an access audit. Sharing one
 * component would mean sharing one helper line, and the helper line is the
 * part that tells an administrator who will read what they write.
 */
export function PatientReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmIcon,
  tone = 'primary',
  placeholder,
  helperText = 'Kept on the account record and shown in the access history.',
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
  helperText?: string;
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
          helperText={helperText}
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
