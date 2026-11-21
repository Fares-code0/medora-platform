import { useState } from 'react';

import { Stack } from '@/components/layout';
import { Button, Modal, Select, Textarea } from '@/components/ui';

import { CANCELLATION_REASONS } from '../model/prescription-service';
import { END_ACT_LABEL, type EndAct } from '../model/selectors';

/**
 * End a prescription with a reason (D-19, UX P4, DEC-002) — cancel one that
 * has not taken effect, or discontinue a therapy under way. `endActFor`
 * chooses the act from the status; the dialog says what that act is, because
 * the two write the same `discontinued` status and differ only in what the
 * record says happened. A reason category is required for either; it is
 * kept on the prescription's timeline and in the server's audit event.
 */

export interface EndPrescriptionDialogProps {
  open: boolean;
  act: EndAct;
  prescriptionId: string;
  medicationLabel: string;
  loading: boolean;
  onConfirm: (reason: string, details: string) => void;
  onClose: () => void;
}

const COPY: Readonly<
  Record<
    EndAct,
    { readonly title: (id: string) => string; readonly lead: (medication: string) => string }
  >
> = {
  cancel: {
    title: (id) => `Cancel ${id}`,
    lead: (medication) =>
      `${medication} has not taken effect yet. Cancelling withdraws it before therapy starts; it will be marked discontinued and its refills removed.`,
  },
  discontinue: {
    title: (id) => `Discontinue ${id}`,
    lead: (medication) =>
      `This stops the active therapy with ${medication}. It will be marked discontinued and any remaining refills removed.`,
  },
};

export function EndPrescriptionDialog({
  open,
  act,
  prescriptionId,
  medicationLabel,
  loading,
  onConfirm,
  onClose,
}: EndPrescriptionDialogProps) {
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
      role="alertdialog"
      title={COPY[act].title(prescriptionId)}
      description={COPY[act].lead(medicationLabel)}
      dismissible={!loading}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={loading}>
            Keep prescription
          </Button>
          <Button
            variant="destructive"
            disabled={reason === null}
            loading={loading}
            onClick={() => {
              if (reason !== null) onConfirm(reason, details);
            }}
          >
            {END_ACT_LABEL[act]}
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <p className="text-body-sm text-text-secondary">
          The record keeps that it was {act === 'cancel' ? 'cancelled' : 'discontinued'}, with your
          reason.
        </p>
        <Select
          label="Reason"
          required
          placeholder="Select a reason…"
          options={CANCELLATION_REASONS.map((option) => ({ value: option, label: option }))}
          value={reason}
          onChange={setReason}
        />
        <Textarea
          label="Additional details (optional)"
          placeholder="Anything a colleague reading this record should know…"
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          rows={3}
        />
      </Stack>
    </Modal>
  );
}
