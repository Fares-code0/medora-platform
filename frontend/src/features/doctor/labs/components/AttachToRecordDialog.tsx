import { useEffect, useState } from 'react';

import { Alert, Spinner } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Checkbox, Modal, Radio, RadioGroup } from '@/components/ui';
import { useAttachableRecordsQuery } from '@/features/doctor/medical-records';
import {
  ATTACH_BLOCKED_META,
  assessAttachability,
  type AttachableReport,
  type AttachmentTarget,
  type LabReportAttachment,
} from '@/features/shared-domain/record-attachments';
import { formatDate } from '@/utils/dates';

import { abnormalResultCount, type LabTest } from '../model/types';

/**
 * Attach report to patient record (D-14, UX §2.6) — "attach report to patient
 * record (confirmation with patient-identity check: *Attach to Amira Saleh,
 * MRN 4482-19?*)".
 *
 * The identity check is a real gate, not a sentence in a dialog. It has three
 * parts, and all three are enforced in `shared-domain/record-attachments`
 * rather than here:
 *
 * 1. The encounter list is scoped to this result's patient, so the common
 *    mistake — picking the row above — cannot select another patient at all.
 * 2. The confirmation carries the identity it confirmed, not a boolean. Change
 *    the selected encounter and the confirmation is void by construction,
 *    because the identity it names no longer matches the target.
 * 3. `assessAttachability` is the only producer of `AttachableReport`, and
 *    the store demands one. There is no path from this component to a written
 *    attachment that skips the check.
 *
 * Nothing is claimed before it lands: the dialog stays open and busy through
 * the write, and the caller closes it on success. On failure it says so and
 * the record keeps nothing.
 */

export interface AttachToRecordDialogProps {
  open: boolean;
  test: LabTest | null;
  attachedBy: string;
  /** Attachments already on this lab, so a duplicate is refused, not doubled. */
  existing: readonly LabReportAttachment[];
  onClose: () => void;
  onConfirm: (attachable: AttachableReport) => void;
  submitting: boolean;
  errorMessage: string | null;
}

export function AttachToRecordDialog({
  open,
  test,
  attachedBy,
  existing,
  onClose,
  onConfirm,
  submitting,
  errorMessage,
}: AttachToRecordDialogProps) {
  const [recordId, setRecordId] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const patientId = test?.patient.id ?? '';
  const records = useAttachableRecordsQuery(patientId);

  useEffect(() => {
    setRecordId('');
    setConfirmed(false);
  }, [test?.id]);

  if (test === null) return null;

  const options = records.data ?? [];
  const selected = options.find((record) => record.recordId === recordId) ?? null;
  const alreadyAttachedTo = new Set(existing.map((attachment) => attachment.recordId));

  const target: AttachmentTarget | null =
    selected === null
      ? null
      : {
          recordId: selected.recordId,
          label: selected.label,
          visitDate: selected.visitDate,
          patientId: selected.patientId,
          patientName: selected.patientName,
          patientMrn: selected.patientMrn,
        };

  const { attachable, blockedBy } = assessAttachability({
    report: {
      labId: test.id,
      testName: test.testName,
      testCode: test.testCode,
      collectedAt: test.collectedDate,
      completedAt: test.completedDate,
      resultCount: test.results.length,
      abnormalCount: abnormalResultCount(test),
      hasCriticalResult: test.hasCriticalResult,
    },
    reportPatient: { patientId: test.patient.id, patientMrn: test.patient.mrn },
    target,
    confirmed:
      confirmed && target !== null
        ? { patientId: target.patientId, patientMrn: target.patientMrn }
        : null,
    confirmedBy: attachedBy,
    existingLabIds: target !== null && alreadyAttachedTo.has(target.recordId) ? [test.id] : [],
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Attach this report to a medical record"
      description={`${test.testName} · ${test.id}`}
      size="md"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            loading={submitting}
            disabled={attachable === null}
            onClick={() => {
              if (attachable !== null) onConfirm(attachable);
            }}
          >
            Attach report
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        {errorMessage !== null ? (
          <Alert variant="error" critical title="The report was not attached">
            {errorMessage} Nothing was added to the record.
          </Alert>
        ) : null}

        {records.isPending ? (
          <div className="flex items-center gap-3 py-4">
            <Spinner size="sm" label="Loading encounters" />
            <p className="text-body-sm text-text-secondary">Loading this patient&apos;s records…</p>
          </div>
        ) : records.isError ? (
          <Alert
            variant="error"
            title="Couldn't load this patient's records"
            actions={
              <Button variant="secondary" size="sm" onClick={() => void records.refetch()}>
                Retry
              </Button>
            }
          >
            Without the encounter list there is nothing to attach to, so attaching stays
            unavailable.
          </Alert>
        ) : options.length === 0 ? (
          <Alert variant="warning" title="This patient has no medical records yet">
            A report can only be attached to an existing encounter.
          </Alert>
        ) : (
          <RadioGroup
            label="Encounter"
            name="attach-record"
            value={recordId === '' ? null : recordId}
            disabled={submitting}
            onChange={(value) => {
              setRecordId(value);
              // Changing the target voids the confirmation. The model would
              // refuse it anyway; clearing the tick means the reader sees why
              // rather than facing a silently dead button.
              setConfirmed(false);
            }}
            /*
             * Scoped to this result's patient — see part 1 of the identity
             * check above. There is no "all patients" mode to slip into.
             */
            helperText={`Records for ${test.patient.name} (MRN ${test.patient.mrn}) only.`}
          >
            {options.map((record) => {
              const taken = alreadyAttachedTo.has(record.recordId);
              return (
                <Radio
                  key={record.recordId}
                  value={record.recordId}
                  disabled={taken}
                  label={`${formatDate(record.visitDate)} — ${record.label}`}
                  description={
                    taken ? 'This report is already on this record.' : `Seen by ${record.doctor}`
                  }
                />
              );
            })}
          </RadioGroup>
        )}

        {selected !== null ? (
          <div className="rounded-surface border border-border bg-surface-sunken p-4">
            <Checkbox
              checked={confirmed}
              disabled={submitting}
              onChange={(event) => setConfirmed(event.target.checked)}
              label={`Attach to ${selected.patientName}, MRN ${selected.patientMrn}?`}
              description={`${test.testName} (${String(test.results.length)} value${
                test.results.length === 1 ? '' : 's'
              }${test.hasCriticalResult ? ', including a critical value' : ''}) will be linked to the ${formatDate(
                selected.visitDate,
              )} encounter. Attachments are not removable.`}
            />
          </div>
        ) : null}

        {attachable === null && !records.isPending && !records.isError && options.length > 0 ? (
          <p role="status" className="text-caption text-text-tertiary">
            {ATTACH_BLOCKED_META[blockedBy]}
          </p>
        ) : null}
      </Stack>
    </Modal>
  );
}
