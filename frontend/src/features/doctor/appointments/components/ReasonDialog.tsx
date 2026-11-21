import { useState } from 'react';

import { Stack } from '@/components/layout';
import { Button, Modal, Select, Textarea } from '@/components/ui';

/**
 * Confirm-with-reason — UX P4, composed from Modal + Select + Textarea
 * per COMPONENT_LIBRARY §5 (the reason-capture variant is feature-
 * composed). Any action affecting another human (reject, cancel)
 * requires a reason category; it is stored with the mutation and will
 * be audit-logged once the audit dispatcher lands.
 */
export interface ReasonDialogProps {
  open: boolean;
  title: string;
  /** Consequence line, e.g. "The patient will be notified immediately." */
  consequence: string;
  confirmLabel: string;
  reasonOptions: readonly string[];
  loading: boolean;
  onConfirm: (reason: string, details: string) => void;
  onClose: () => void;
}

export function ReasonDialog({
  open,
  title,
  consequence,
  confirmLabel,
  reasonOptions,
  loading,
  onConfirm,
  onClose,
}: ReasonDialogProps) {
  const [reason, setReason] = useState<string | null>(null);
  const [details, setDetails] = useState('');

  const close = () => {
    setReason(null);
    setDetails('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={title}
      description={consequence}
      dismissible={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={loading}>
            Keep appointment
          </Button>
          <Button
            variant="destructive"
            disabled={reason === null}
            loading={loading}
            onClick={() => {
              if (reason !== null) onConfirm(reason, details);
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Select
          label="Reason"
          required
          placeholder="Select a reason…"
          options={reasonOptions.map((option) => ({ value: option, label: option }))}
          value={reason}
          onChange={setReason}
        />
        <Textarea
          label="Additional details (optional)"
          placeholder="Anything the patient should know…"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          rows={3}
        />
      </Stack>
    </Modal>
  );
}
