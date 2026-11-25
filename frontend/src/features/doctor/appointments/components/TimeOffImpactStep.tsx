import { useMemo, useRef, useState } from 'react';

import type { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, Card, Radio, RadioGroup, Textarea } from '@/components/ui';
import { usePatientDirectoryQuery } from '@/features/shared-domain/patient-identity';
import { formatDate, formatTime, useT, type MessageKey, type TranslateFn } from '@/i18n';
import { isApiError } from '@/types/api';

import { useResolveTimeOffMutation } from '../api/useAppointmentsQuery';
import { timeOffErrorMessage, timeOffSpan } from '../model/time-off-copy';
import type {
  ImpactedAppointment,
  ResolutionAction,
  ResolutionOutcome,
  TimeOffBlock,
} from '../model/time-off-service';

/**
 * The second half of Block Time Off (UX §2.4, API §5.9): the appointments a
 * booked block disturbs, what to do about them, and the outcome. Shared by
 * the Block Time Off page (straight after the create) and Upcoming Time Off
 * (when that follow-up was interrupted and is picked up again).
 *
 * The count the doctor was shown travels with the request; if the
 * appointments in the window have changed since, the server refuses and
 * nothing is sent (`blast_radius_changed`). The refusal is shown in the
 * server's words, with a way to read the list again.
 */

/** What `useToast().toast` takes — the provider does not export the type. */
export type ToastOptions = Parameters<ReturnType<typeof useToast>['toast']>[0];

type Choice = ResolutionAction | 'leave';

const RESOLUTION_ORDER: readonly ResolutionAction[] = [
  'reschedule-proposal',
  'handover',
  'cancel-apology',
];

const RESOLUTION_KEYS: Readonly<
  Record<ResolutionAction, { readonly label: MessageKey; readonly description: MessageKey }>
> = {
  'reschedule-proposal': {
    label: 'timeOff.resolution.reschedule',
    description: 'timeOff.resolution.reschedule.description',
  },
  handover: {
    label: 'timeOff.resolution.handover',
    description: 'timeOff.resolution.handover.description',
  },
  'cancel-apology': {
    label: 'timeOff.resolution.cancel',
    description: 'timeOff.resolution.cancel.description',
  },
};

const STATUS_KEYS: Readonly<Record<string, MessageKey>> = {
  scheduled: 'timeOff.status.scheduled',
  confirmed: 'timeOff.status.confirmed',
  pending: 'timeOff.status.pending',
  rescheduled: 'timeOff.status.rescheduled',
  'awaiting-patient': 'timeOff.status.awaitingPatient',
};

/** The server spells statuses `AWAITING_PATIENT`; the client `awaiting-patient`. */
function statusLabel(t: TranslateFn, status: string): string {
  const key = STATUS_KEYS[status.toLowerCase().replace(/_/g, '-')];
  return key === undefined ? status : t(key);
}

const isStaleCount = (error: unknown) =>
  isApiError(error) && error.kind === 'conflict' && error.code === 'blast_radius_changed';

export interface TimeOffImpactStepProps {
  readonly block: TimeOffBlock;
  readonly impacted: readonly ImpactedAppointment[];
  /** True while the caller is reading the list again. */
  readonly reloading?: boolean;
  /** Read the impact again — offered when the server says the list changed. */
  readonly onReload?: () => void;
  /** Leave the step without deciding; the follow-up stays outstanding. */
  readonly onClose: () => void;
  /**
   * The doctor decided (acted, or chose to leave the appointments) and the
   * server confirmed it. `toast` is what to announce, or `null` when the
   * outcome is already on screen.
   */
  readonly onDone: (toast: ToastOptions | null) => void;
  /** Called the moment a decision is confirmed, before any navigation. */
  readonly onDecided: () => void;
  /** Reports whether a resolve request is in flight. */
  readonly onPendingChange?: (pending: boolean) => void;
}

export function TimeOffImpactStep({
  block,
  impacted,
  reloading = false,
  onReload,
  onClose,
  onDone,
  onDecided,
  onPendingChange,
}: TimeOffImpactStepProps) {
  const t = useT();
  const [choice, setChoice] = useState<Choice>(
    block.kind === 'emergency-block' ? 'reschedule-proposal' : 'leave',
  );
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<ResolutionOutcome | null>(null);
  // `isPending` lands a render late; a second click inside that render must
  // not send the resolution twice.
  const inFlight = useRef(false);

  const resolve = useResolveTimeOffMutation();
  const directory = usePatientDirectoryQuery();
  const names = useMemo(
    () => new Map((directory.data ?? []).map((patient) => [patient.id, patient.name])),
    [directory.data],
  );

  const count = impacted.length;
  const pending = resolve.isPending;
  const span = timeOffSpan(t, block);

  const submit = () => {
    setError(null);
    if (choice === 'leave') {
      onDecided();
      onDone({
        variant: 'warning',
        title: t('timeOff.toast.blocked'),
        description: t('timeOff.toast.leftAsIs', { count }),
      });
      return;
    }
    if (inFlight.current) return;
    inFlight.current = true;
    onPendingChange?.(true);
    resolve.mutate(
      {
        blockId: block.id,
        action: choice,
        confirmedCount: count,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      },
      {
        onSuccess: (result) => {
          onDecided();
          if (result.skipped.length > 0) {
            setOutcome(result);
            return;
          }
          onDone({
            variant: 'success',
            title: t('timeOff.toast.blocked'),
            description: t('timeOff.outcome.summary', {
              resolved: result.resolved.length,
              notified: result.notified,
            }),
          });
        },
        onError: (failure) => setError(failure),
        onSettled: () => {
          inFlight.current = false;
          onPendingChange?.(false);
        },
      },
    );
  };

  if (outcome !== null) {
    return (
      <Card
        title={t('timeOff.toast.blocked')}
        subtitle={span}
        footer={
          <div className="flex justify-end">
            <Button onClick={() => onDone(null)}>{t('timeOff.outcome.view')}</Button>
          </div>
        }
      >
        <Stack gap={3}>
          <Alert
            variant="success"
            title={t('timeOff.outcome.summary', {
              resolved: outcome.resolved.length,
              notified: outcome.notified,
            })}
          />
          <Alert
            variant="warning"
            title={t('timeOff.outcome.skipped', { count: outcome.skipped.length })}
          >
            <ul className="mt-1 list-disc ps-5">
              {outcome.skipped.map((entry) => (
                <li key={entry.id}>
                  <span className="font-mono">{entry.id}</span> — {entry.reason}
                </li>
              ))}
            </ul>
          </Alert>
        </Stack>
      </Card>
    );
  }

  return (
    <Card
      title={t('timeOff.impact.title', { count })}
      subtitle={t('timeOff.impact.subtitle', { span })}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t('timeOff.impact.close')}
          </Button>
          <Button loading={pending} disabled={pending || reloading} onClick={submit}>
            {choice === 'leave' ? t('timeOff.impact.leave') : t('timeOff.impact.notify', { count })}
          </Button>
        </div>
      }
    >
      <Stack gap={4}>
        <ul
          aria-label={t('timeOff.impact.list')}
          className="flex flex-col divide-y divide-border rounded-surface border border-border"
        >
          {impacted.map((appointment) => (
            <li
              key={appointment.id}
              className="flex flex-col gap-1 px-3 py-2 text-body-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
            >
              <span className="text-text-primary">
                {names.get(appointment.patientId) ?? appointment.patientId}
              </span>
              <span className="tabular-nums text-text-secondary">
                {t('timeOff.impact.when', {
                  date: formatDate(appointment.scheduledAt),
                  time: formatTime(appointment.scheduledAt),
                  status: statusLabel(t, appointment.status),
                })}
              </span>
            </li>
          ))}
        </ul>
        <RadioGroup
          label={t('timeOff.impact.question')}
          name="time-off-resolution"
          value={choice}
          onChange={(value) => setChoice(value as Choice)}
        >
          {RESOLUTION_ORDER.map((action) => (
            <Radio
              key={action}
              value={action}
              label={t(RESOLUTION_KEYS[action].label)}
              description={t(RESOLUTION_KEYS[action].description)}
            />
          ))}
          <Radio
            value="leave"
            label={t('timeOff.impact.leave')}
            description={t('timeOff.impact.leaveHint')}
          />
        </RadioGroup>
        {choice === 'leave' ? null : (
          <Textarea
            label={t('timeOff.impact.message')}
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t('timeOff.impact.messagePlaceholder')}
          />
        )}
        {error === null ? null : (
          <Alert variant="error" title={timeOffErrorMessage(t, error)}>
            {isStaleCount(error) && onReload !== undefined ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                loading={reloading}
                onClick={() => {
                  setError(null);
                  onReload();
                }}
              >
                {t('timeOff.impact.reload')}
              </Button>
            ) : null}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
