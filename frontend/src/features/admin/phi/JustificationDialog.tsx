import { useEffect, useState } from 'react';

import { ShieldAlert } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Modal, Radio, RadioGroup, Textarea } from '@/components/ui';

import type { PhiJustificationCategory } from '../administration.types';

import { PHI_ELEVATION_MINUTES, PHI_JUSTIFICATION_CATEGORIES, validateReason } from './phi-access';

/**
 * The per-access justification prompt (UX §1.5.1 · §3.6).
 *
 * A closed category plus a written reason, in that order: the category is
 * what makes the log reviewable in aggregate, the sentence is what makes a
 * single entry defensible. The consequence line is not decoration — the
 * administrator should know their name is going on this before they choose,
 * not after.
 */
export function JustificationDialog({
  open,
  subjectLabel,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  subjectLabel: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (category: PhiJustificationCategory, reason: string) => void;
}) {
  const [category, setCategory] = useState<PhiJustificationCategory>('clinical-review');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  // A fresh prompt every time: a reason typed for one record must never be
  // carried over to the next one.
  useEffect(() => {
    if (open) {
      setCategory('clinical-review');
      setReason('');
      setReasonError(undefined);
    }
  }, [open]);

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
      title="Justify this access"
      description={`Revealing identifiers for ${subjectLabel}. This is recorded against your account and visible in the system log.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Keep masked
          </Button>
          <Button onClick={submit} loading={submitting} leadingIcon={ShieldAlert}>
            Reveal and log
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
          <Alert variant="error" title="Nothing was revealed">
            {error}
          </Alert>
        ) : null}

        <RadioGroup
          name="phi-justification-category"
          label="Reason category"
          value={category}
          onChange={(next) => setCategory(next as PhiJustificationCategory)}
        >
          {PHI_JUSTIFICATION_CATEGORIES.map((entry) => (
            <Radio
              key={entry.id}
              value={entry.id}
              label={entry.label}
              description={entry.description}
            />
          ))}
        </RadioGroup>

        <Textarea
          label="What are you doing?"
          placeholder="e.g. Confirming the patient on ticket A-104 before reassigning their appointment."
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={reasonError}
        />

        <p className="text-caption text-text-secondary">
          Identifiers stay visible for {PHI_ELEVATION_MINUTES} minutes for this record only, then
          re-mask automatically.
        </p>
      </form>
    </Modal>
  );
}
