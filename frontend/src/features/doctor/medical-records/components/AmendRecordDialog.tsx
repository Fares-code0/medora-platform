import { useEffect, useState } from 'react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Input, Modal, Textarea } from '@/components/ui';

import type { MedicalRecord } from '../model/types';

/**
 * Add an addendum (D-21).
 *
 * This is the *only* way to change what a record says once something on it is
 * signed, and the dialog says so rather than leaving the reader to infer it
 * from the absence of an edit button. The addendum arrives unsigned and is
 * signed like any other note, under its own author and timestamp.
 */
export interface AmendRecordDialogProps {
  open: boolean;
  record: MedicalRecord | null;
  author: string;
  onClose: () => void;
  onConfirm: (title: string, body: string) => void;
  submitting: boolean;
  errorMessage: string | null;
}

export function AmendRecordDialog({
  open,
  record,
  author,
  onClose,
  onConfirm,
  submitting,
  errorMessage,
}: AmendRecordDialogProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  /* Reset per record, not per open: a failed write keeps what was typed. */
  useEffect(() => {
    setTitle('');
    setBody('');
  }, [record?.id]);

  if (record === null) return null;

  const ready = title.trim() !== '' && body.trim() !== '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an addendum"
      description={`${record.id} · ${record.patient.name} (MRN ${record.patient.mrn})`}
      size="md"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={!ready}
            onClick={() => onConfirm(title, body)}
          >
            Add addendum
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        {errorMessage !== null ? (
          // The message says whether the record is known to be unchanged
          // (`useRecordLifecycleActions`): after a lost connection it may not be.
          <Alert variant="error" critical title="Adding the addendum failed">
            {errorMessage}
          </Alert>
        ) : null}

        <Alert variant="info" title="Addenda append; they never replace">
          The signed notes already on this record stay exactly as they are. Your addendum stands
          beside them under your name, and arrives unsigned until you sign it.
        </Alert>

        <Input
          label="Addendum title"
          required
          value={title}
          disabled={submitting}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="e.g. Correction — laterality"
        />

        <Textarea
          label="Addendum"
          required
          rows={6}
          value={body}
          disabled={submitting}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What is being added or corrected, and why."
          helperText={`Recorded against ${author}.`}
        />
      </Stack>
    </Modal>
  );
}
