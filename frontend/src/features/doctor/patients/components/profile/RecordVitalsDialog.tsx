import { useState } from 'react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Input, Modal } from '@/components/ui';

import { useRecordVitalsMutation } from '../../api/usePatientProfileQuery';
import {
  EMPTY_VITALS,
  VITALS_FIELDS,
  VITALS_LIMITS,
  toVitalsInput,
  vitalsIssues,
  type VitalsDraft,
  type VitalsField,
} from '../../model/vitals';

/**
 * Record vital signs on the chart (API §4.6). A complete set or nothing —
 * the API stores no partial reading — validated against the server's own
 * bounds (`model/vitals.ts`). BMI is not entered: the server derives it, so
 * it cannot disagree with the height and weight beside it.
 *
 * Pessimistic: the dialog closes and the new reading replaces the card's only
 * once the chart has refetched.
 */
export interface RecordVitalsDialogProps {
  open: boolean;
  patientId: string;
  patientName: string;
  onClose: () => void;
}

function parse(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function RecordVitalsDialog({
  open,
  patientId,
  patientName,
  onClose,
}: RecordVitalsDialogProps) {
  const { toast } = useToast();
  const record = useRecordVitalsMutation(patientId);
  const [draft, setDraft] = useState<VitalsDraft>(EMPTY_VITALS);
  const [showIssues, setShowIssues] = useState(false);

  const issues = vitalsIssues(draft);

  const close = () => {
    setDraft(EMPTY_VITALS);
    setShowIssues(false);
    record.reset();
    onClose();
  };

  const submit = () => {
    setShowIssues(true);
    const input = toVitalsInput(draft);
    if (input === null) return;
    record.mutate(input, {
      onSuccess: () => {
        close();
        toast({ variant: 'success', title: 'Vital signs recorded' });
      },
    });
  };

  const field = (key: VitalsField) => {
    const limit = VITALS_LIMITS[key];
    const value = draft[key];
    return (
      <Input
        key={key}
        type="number"
        inputMode="decimal"
        step={limit.integer ? 1 : 0.1}
        min={limit.min}
        max={limit.max}
        required
        label={`${limit.label} (${limit.unit})`}
        value={value === null || Number.isNaN(value) ? '' : String(value)}
        onChange={(event) => setDraft({ ...draft, [key]: parse(event.target.value) })}
        error={showIssues ? issues[key] : undefined}
      />
    );
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Record vital signs"
      description={`For ${patientName}. All readings are required; BMI is calculated from height and weight.`}
      dismissible={!record.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={record.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={record.isPending}>
            Record vitals
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Stack gap={4}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{VITALS_FIELDS.map(field)}</div>
          {record.isError ? (
            <Alert variant="error" title="The reading was not recorded">
              {record.error.message || 'Please try again.'}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
