import { useState } from 'react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Modal, Radio, RadioGroup, Textarea } from '@/components/ui';

import { useAddAlertMutation } from '../../api/usePatientProfileQuery';
import { ALERT_MESSAGE_MAX } from '../../model/profile-service';
import type { ClinicalAlert } from '../../model/profile-types';

/**
 * Raise a clinical alert (API §4.5, M10.5) — the banner the Overview draws
 * above everything else on the chart, for every clinician who opens it.
 *
 * - **Severity has no default.** Whether something is critical is the
 *   clinician's call; a pre-selected "warning" would be a judgement nobody
 *   made, and a pre-selected "critical" would teach people to ignore red.
 * - **300 characters, the API's cap.** A banner has to be read at a glance.
 * - **Pessimistic.** "Raised" is announced only once the chart has refetched
 *   with the banner on it.
 *
 * Resolving an alert is not offered here: who may take a safety banner down
 * is an owner decision (DEC-003), not a form field.
 */
export interface RaiseAlertDialogProps {
  open: boolean;
  patientId: string;
  patientName: string;
  onClose: () => void;
}

type Severity = ClinicalAlert['severity'];

const SEVERITIES: readonly { readonly value: Severity; readonly label: string; readonly hint: string }[] =
  [
    { value: 'critical', label: 'Critical', hint: 'Must be acted on before treating' },
    { value: 'warning', label: 'Warning', hint: 'Needs attention' },
  ];

function failureOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const { detail } = error as { readonly detail?: unknown };
    if (typeof detail === 'string' && detail !== '') return detail;
  }
  return 'Nothing was saved. Please try again.';
}

export function RaiseAlertDialog({ open, patientId, patientName, onClose }: RaiseAlertDialogProps) {
  const { toast } = useToast();
  const add = useAddAlertMutation(patientId);
  const [severity, setSeverity] = useState<Severity | null>(null);
  const [message, setMessage] = useState('');
  const [showIssues, setShowIssues] = useState(false);

  const trimmed = message.trim();
  const issues = {
    severity: severity === null ? 'Choose a severity' : undefined,
    message:
      trimmed === ''
        ? 'Say what the alert is'
        : trimmed.length > ALERT_MESSAGE_MAX
          ? `Keep it under ${String(ALERT_MESSAGE_MAX)} characters`
          : undefined,
  };
  const valid = issues.severity === undefined && issues.message === undefined;

  const close = () => {
    setSeverity(null);
    setMessage('');
    setShowIssues(false);
    add.reset();
    onClose();
  };

  const submit = () => {
    setShowIssues(true);
    if (!valid || severity === null) return;
    add.mutate(
      { severity, message: trimmed },
      {
        onSuccess: (alert) => {
          close();
          toast({
            variant: 'success',
            title: alert.severity === 'critical' ? 'Critical alert raised' : 'Warning raised',
            description: `It now shows on ${patientName}’s chart for everyone who opens it.`,
          });
        },
      },
    );
  };

  const issue = (field: keyof typeof issues) => (showIssues ? issues[field] : undefined);

  return (
    <Modal
      open={open}
      onClose={close}
      size="md"
      title="Raise a clinical alert"
      description={`For ${patientName}. An alert is a banner at the top of the chart, shown to every clinician who opens it.`}
      dismissible={!add.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={add.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.isPending}>
            Raise alert
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
          <RadioGroup
            label="Severity"
            name="alert-severity"
            required
            orientation="horizontal"
            value={severity}
            onChange={(value) => setSeverity(value as Severity)}
            error={issue('severity')}
          >
            {SEVERITIES.map((option) => (
              <Radio
                key={option.value}
                value={option.value}
                label={option.label}
                description={option.hint}
              />
            ))}
          </RadioGroup>
          <Textarea
            label="Alert"
            required
            rows={3}
            maxLength={ALERT_MESSAGE_MAX}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            error={issue('message')}
            placeholder="e.g. On warfarin — check INR before any procedure."
            helperText={`${String(trimmed.length)} / ${String(ALERT_MESSAGE_MAX)}`}
          />
          {add.isError ? (
            <Alert variant="error" title="The alert was not raised">
              {failureOf(add.error)}
            </Alert>
          ) : null}
        </Stack>
      </form>
    </Modal>
  );
}
