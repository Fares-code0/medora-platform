import { useMemo, useState } from 'react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Input, Modal, Radio, RadioGroup, Select, Textarea } from '@/components/ui';
import { usePatientDirectoryQuery } from '@/features/shared-domain/patient-identity';
import { isApiError } from '@/types/api';
import { formatDate, formatTime } from '@/utils/dates';

import { useCreateTimeOffMutation, useResolveTimeOffMutation } from '../api/useAppointmentsQuery';
import {
  RESOLUTION_LABELS,
  type ResolutionAction,
  type ResolutionOutcome,
  type TimeOffCreated,
  type TimeOffKind,
} from '../model/time-off-service';

/**
 * Block time off, and emergency unavailability (UX §2.4, FE-10.4).
 *
 * 1. **The window.** From, to, and whether it is planned (vacation) or an
 *    emergency. Booking it moves nothing.
 * 2. **The blast radius.** Every appointment inside the window, listed
 *    before anything is sent, with what to do about them: ask the patients
 *    to pick a new time, offer a colleague handover, cancel with an
 *    apology — or leave them for now. The confirmation names how many
 *    patients will be notified (UX: "6 patients will be notified").
 * 3. **The outcome.** What was acted on and what was skipped, with the
 *    server's reason for each skip — a bulk action that reported only
 *    success would leave the doctor believing the day is clear.
 *
 * The count the doctor confirmed travels with the request; if the
 * appointments in the window have changed since, the server refuses and
 * nothing is sent (`blast_radius_changed`), which this reports as is.
 */

type Phase =
  | { readonly kind: 'window' }
  | { readonly kind: 'impact'; readonly created: TimeOffCreated }
  | {
      readonly kind: 'done';
      readonly created: TimeOffCreated;
      readonly outcome: ResolutionOutcome | null;
    };

type Choice = ResolutionAction | 'leave';

const KIND_OPTIONS: readonly { readonly value: TimeOffKind; readonly label: string }[] = [
  { value: 'vacation', label: 'Planned time off' },
  { value: 'emergency-block', label: 'Emergency — unavailable now' },
];

function localNow(offsetHours = 0): string {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  date.setMinutes(0, 0, 0);
  // `datetime-local` wants local wall-clock time without a zone.
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function messageOf(error: unknown): string {
  if (isApiError(error) && error.kind === 'conflict') return error.detail;
  if (isApiError(error) && error.kind === 'validation') {
    const first = Object.values(error.fieldErrors)[0]?.[0];
    if (first !== undefined) return first;
  }
  return 'Nothing was changed — try again.';
}

export function BlockTimeOffDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [from, setFrom] = useState(() => localNow(1));
  const [to, setTo] = useState(() => localNow(9));
  const [kind, setKind] = useState<TimeOffKind>('vacation');
  const [phase, setPhase] = useState<Phase>({ kind: 'window' });
  const [choice, setChoice] = useState<Choice>('leave');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useCreateTimeOffMutation();
  const resolve = useResolveTimeOffMutation();
  const directory = usePatientDirectoryQuery({ enabled: open && phase.kind !== 'window' });
  const names = useMemo(
    () => new Map((directory.data ?? []).map((patient) => [patient.id, patient.name])),
    [directory.data],
  );

  const windowValid = from !== '' && to !== '' && new Date(from) < new Date(to);

  const close = () => {
    setPhase({ kind: 'window' });
    setChoice('leave');
    setReason('');
    setError(null);
    onClose();
  };

  const submitWindow = () => {
    setError(null);
    create.mutate(
      { from: new Date(from).toISOString(), to: new Date(to).toISOString(), kind },
      {
        onSuccess: (created) => {
          setChoice(kind === 'emergency-block' ? 'reschedule-proposal' : 'leave');
          setPhase(
            created.impacted.length === 0
              ? { kind: 'done', created, outcome: null }
              : { kind: 'impact', created },
          );
        },
        onError: (failure) => setError(messageOf(failure)),
      },
    );
  };

  const submitImpact = (created: TimeOffCreated) => {
    setError(null);
    if (choice === 'leave') {
      setPhase({ kind: 'done', created, outcome: null });
      return;
    }
    resolve.mutate(
      {
        blockId: created.block.id,
        action: choice,
        confirmedCount: created.impacted.length,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      },
      {
        onSuccess: (outcome) => setPhase({ kind: 'done', created, outcome }),
        onError: (failure) => setError(messageOf(failure)),
      },
    );
  };

  const pending = create.isPending || resolve.isPending;

  if (phase.kind === 'done') {
    const { created, outcome } = phase;
    return (
      <Modal
        open={open}
        onClose={close}
        title="Time off blocked"
        description={`${formatDate(created.block.startsAt)} ${formatTime(created.block.startsAt)} – ${formatDate(created.block.endsAt)} ${formatTime(created.block.endsAt)}`}
        size="md"
        footer={<Button onClick={close}>Done</Button>}
      >
        <Stack gap={3}>
          {created.impacted.length === 0 ? (
            <Alert variant="success" title="No appointments fall inside this time." />
          ) : outcome === null ? (
            <Alert
              variant="warning"
              title={`${String(created.impacted.length)} appointment${created.impacted.length === 1 ? '' : 's'} left as they are`}
            >
              They still need a decision — open each from the appointment book.
            </Alert>
          ) : (
            <>
              <Alert
                variant="success"
                title={`${String(outcome.resolved.length)} handled · ${String(outcome.notified)} notified`}
              />
              {outcome.skipped.length > 0 ? (
                <Alert
                  variant="warning"
                  title={`${String(outcome.skipped.length)} skipped — still need a decision`}
                >
                  <ul className="mt-1 list-disc ps-5">
                    {outcome.skipped.map((entry) => (
                      <li key={entry.id}>
                        <span className="font-mono">{entry.id}</span> — {entry.reason}
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
            </>
          )}
        </Stack>
      </Modal>
    );
  }

  if (phase.kind === 'impact') {
    const { created } = phase;
    const count = created.impacted.length;
    return (
      <Modal
        open={open}
        onClose={close}
        dismissible={!pending}
        title={`${String(count)} ${count === 1 ? 'appointment falls' : 'appointments fall'} inside this time`}
        description="Nothing has been sent yet. Choose what happens to them."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={pending}>
              Close
            </Button>
            <Button loading={pending} onClick={() => submitImpact(created)}>
              {choice === 'leave'
                ? 'Leave them for now'
                : `Notify ${String(count)} patient${count === 1 ? '' : 's'}`}
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <ul className="flex flex-col divide-y divide-border rounded-surface border border-border">
            {created.impacted.map((appointment) => (
              <li
                key={appointment.id}
                className="flex items-center justify-between gap-3 px-3 py-2 text-body-sm"
              >
                <span className="text-text-primary">
                  {names.get(appointment.patientId) ?? appointment.patientId}
                </span>
                <span className="tabular-nums text-text-secondary">
                  {formatDate(appointment.scheduledAt)} {formatTime(appointment.scheduledAt)} ·{' '}
                  {appointment.status}
                </span>
              </li>
            ))}
          </ul>
          <RadioGroup
            label="What should happen to them?"
            name="time-off-resolution"
            value={choice}
            onChange={(value) => setChoice(value as Choice)}
          >
            {(Object.keys(RESOLUTION_LABELS) as ResolutionAction[]).map((action) => (
              <Radio
                key={action}
                value={action}
                label={RESOLUTION_LABELS[action].label}
                description={RESOLUTION_LABELS[action].description}
              />
            ))}
            <Radio
              value="leave"
              label="Leave them for now"
              description="The time stays blocked for new bookings; these appointments are unchanged."
            />
          </RadioGroup>
          {choice === 'leave' ? null : (
            <Textarea
              label="Message to patients"
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. The doctor is unavailable due to an emergency."
            />
          )}
          {error === null ? null : <Alert variant="error" title={error} />}
        </Stack>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      dismissible={!pending}
      title="Block time off"
      description="New bookings are refused inside this window. You will see any appointments it affects before anything is sent."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submitWindow} loading={pending} disabled={!windowValid}>
            Block time
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Select
          label="Kind"
          value={kind}
          onChange={(value) => setKind(value as TimeOffKind)}
          options={KIND_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            type="datetime-local"
            label="From"
            required
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <Input
            type="datetime-local"
            label="To"
            required
            value={to}
            error={
              from !== '' && to !== '' && !windowValid
                ? 'The end must be after the start'
                : undefined
            }
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
        {error === null ? null : <Alert variant="error" title={error} />}
      </Stack>
    </Modal>
  );
}
