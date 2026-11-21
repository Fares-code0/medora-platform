import { useState } from 'react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Modal, Textarea } from '@/components/ui';
import { formatNumber } from '@/i18n';

import { useReportRecordIssueMutation } from '../api/useRecordMutations';
import { RECORD_ISSUE_MAX } from '../model/record-service';
import type { MedicalRecord } from '../model/types';

/**
 * Report a data issue on a record (API §6.9).
 *
 * A report is not a correction: the record is untouched, and the dialog says
 * so, because the doctor who wrote it corrects it by addendum. It needs only
 * read access — the clinician most likely to notice a wrong laterality or a
 * mis-filed result is often not the author.
 *
 * **What the confirmation promises is only what the server does**: it keeps
 * the report against the record and logs it in the reporter's own activity.
 * No screen in this client reads reports back, so the toast does not name a
 * team or a queue that would see it.
 *
 * Pessimistic, and a failure keeps what was typed beside the reason.
 */
export interface ReportRecordIssueDialogProps {
  open: boolean;
  record: MedicalRecord;
  onClose: () => void;
}

export function ReportRecordIssueDialog({ open, record, onClose }: ReportRecordIssueDialogProps) {
  const { toast } = useToast();
  const mutation = useReportRecordIssueMutation();
  const [description, setDescription] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = description.trim();
  const tooLong = trimmed.length > RECORD_ISSUE_MAX;
  const invalid = trimmed.length === 0 || tooLong;

  const close = () => {
    if (mutation.isPending) return;
    setDescription('');
    setTouched(false);
    mutation.reset();
    onClose();
  };

  const submit = () => {
    setTouched(true);
    if (invalid) return;
    mutation.mutate(
      { recordId: record.id, description: trimmed },
      {
        onSuccess: () => {
          toast({
            variant: 'success',
            title: `Issue reported on ${record.id}`,
            description: 'It is kept with the record and listed in your activity log.',
          });
          setDescription('');
          setTouched(false);
          mutation.reset();
          onClose();
        },
      },
    );
  };

  let fieldError: string | undefined;
  if (touched && trimmed.length === 0) fieldError = 'Describe what is wrong so it can be acted on.';
  else if (tooLong) fieldError = `Keep it under ${formatNumber(RECORD_ISSUE_MAX)} characters.`;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Report an issue with this record"
      description={`${record.id} · ${record.patient.name} (MRN ${record.patient.mrn})`}
      size="md"
      dismissible={!mutation.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={mutation.isPending}>
            Report issue
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        {mutation.isError ? (
          <Alert variant="error" critical title="The issue was not reported">
            Nothing was recorded. Your description is kept below — try again.
          </Alert>
        ) : null}

        <Alert variant="info" title="This does not change the record">
          A report flags the record as possibly wrong. The record&rsquo;s author corrects it with an
          addendum.
        </Alert>

        <Textarea
          label="What is wrong"
          required
          rows={5}
          value={description}
          disabled={mutation.isPending}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="e.g. The diagnosis lists the left knee; the imaging and the note both say right."
          error={fieldError}
          helperText={`${formatNumber(trimmed.length)} / ${formatNumber(RECORD_ISSUE_MAX)}`}
        />
      </Stack>
    </Modal>
  );
}
