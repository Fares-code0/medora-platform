import { useEffect, useState } from 'react';

import { Ban } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Modal, Radio, RadioGroup, Textarea } from '@/components/ui';

import { CANCEL_CATEGORIES, formatSlot, validateReason } from './oversight';
import type { CancelCategory, OversightAppointment } from './oversight.types';

/**
 * Administrative cancellation (ADM-05 · UX §3.5).
 *
 * The clinic cancelling on a patient, which is why this is the one row
 * action with no bulk equivalent and why it costs a category *and* a
 * sentence. The category makes the cancellations reviewable in aggregate;
 * the sentence makes this one defensible when the patient asks why.
 *
 * The apology the patient receives is shown before confirming — an
 * administrator should see what is about to arrive on someone's phone.
 */
export function CancelDialog({
  open,
  appointment,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  appointment: OversightAppointment | null;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (category: CancelCategory, reason: string) => void;
}) {
  const [category, setCategory] = useState<CancelCategory>('doctor-unavailable');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setCategory('doctor-unavailable');
      setReason('');
      setReasonError(undefined);
    }
  }, [open, appointment?.id]);

  if (appointment === null) return null;

  const submit = () => {
    const check = validateReason(reason);
    if (!check.ok) {
      setReasonError(check.message);
      return;
    }
    setReasonError(undefined);
    onConfirm(category, reason);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      role="alertdialog"
      dismissible={false}
      title={`Cancel ${appointment.reference} on the clinic's behalf?`}
      description={`${appointment.visitType} · ${formatSlot(appointment.startsAt)} · ${appointment.doctorName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Keep the appointment
          </Button>
          <Button variant="destructive" leadingIcon={Ban} loading={submitting} onClick={submit}>
            Cancel and notify patient
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
          <Alert variant="error" title="Nothing was cancelled">
            {error}
          </Alert>
        ) : null}

        <RadioGroup
          name="administrative-cancel-category"
          label="Reason category"
          value={category}
          onChange={(next) => setCategory(next as CancelCategory)}
        >
          {CANCEL_CATEGORIES.map((entry) => (
            <Radio
              key={entry.id}
              value={entry.id}
              label={entry.label}
              description={entry.description}
            />
          ))}
        </RadioGroup>

        <Textarea
          label="What happened?"
          placeholder="e.g. Cardiology clinic closed Thursday for the power works; patient offered Monday instead."
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
        />

        <div className="rounded-surface border border-border bg-surface-sunken p-4">
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-text-tertiary">
            The patient receives
          </p>
          <p className="mt-1.5 text-body-sm text-text-secondary">
            We are sorry — your appointment on {formatSlot(appointment.startsAt)} has been cancelled
            by the clinic. Someone will contact you to arrange a new time. We apologise for the
            disruption.
          </p>
        </div>
      </form>
    </Modal>
  );
}
