import { useState } from 'react';

import { useToast } from '@/app/providers';
import { Alert } from '@/components/feedback';
import { ConfirmationDialog, Textarea } from '@/components/ui';
import { formatDate } from '@/utils/dates';

import {
  useRemoveEmergencyContactMutation,
  useRemoveHistoryEventMutation,
  useResolveAlertMutation,
} from '../../api/usePatientProfileQuery';
import { RETRACTION_REASON_MAX } from '../../model/profile-service';
import {
  HISTORY_KIND_META,
  type ClinicalAlert,
  type EmergencyContact,
  type MedicalHistoryEvent,
} from '../../model/profile-types';

/**
 * Taking something back off the chart (DEC-003). All three are confirmed and
 * pessimistic — the item leaves the chart only after the server answers and
 * the chart has refetched — and each says exactly what the server keeps.
 *
 * **Reasons (BR-DEC-003).** The server now persists a reason on each of these
 * rows, so each dialog asks for one:
 *
 * - removing a **history event** — mandatory (DEC-003), and the server
 *   refuses the removal without one;
 * - removing a **contact** — required here: DEC-003 asks for a reason "if the
 *   backend can record it", and it now can. The server accepts its absence
 *   only so older clients keep working;
 * - resolving an **alert** — optional: DEC-003 asks for a confirmation, not a
 *   reason, and the server accepts either.
 *
 * Nothing claims more than the server does: the reason is stored with the
 * row, but no read returns removed history or contacts yet (BR-DEC-003
 * point 4), so the chart cannot show them as removed — the dialogs say the
 * entry leaves the chart, not that it is marked. Correcting a history event
 * has no route (point 1) and is not offered.
 */

function failureOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const { detail } = error as { readonly detail?: unknown };
    if (typeof detail === 'string' && detail !== '') return detail;
  }
  return 'Nothing was changed. Please try again.';
}

/**
 * The reason field and its rule. `required` refuses an empty reason before
 * anything is sent; the length is the server's ceiling either way.
 */
function useReason(required: boolean) {
  const [reason, setReason] = useState('');
  const [showIssue, setShowIssue] = useState(false);
  const trimmed = reason.trim();
  const issue =
    required && trimmed === ''
      ? 'Give a reason'
      : trimmed.length > RETRACTION_REASON_MAX
        ? `Keep it to ${String(RETRACTION_REASON_MAX)} characters`
        : undefined;
  return {
    reason: trimmed,
    /** True when the reason may be sent; otherwise the field shows why not. */
    check: () => {
      setShowIssue(true);
      return issue === undefined;
    },
    reset: () => {
      setReason('');
      setShowIssue(false);
    },
    field: {
      value: reason,
      onChange: (event: { target: { value: string } }) => setReason(event.target.value),
      error: showIssue ? issue : undefined,
      maxLength: RETRACTION_REASON_MAX,
      helperText: `${String(trimmed.length)} / ${String(RETRACTION_REASON_MAX)}`,
      rows: 2,
    },
  };
}

export function ResolveAlertDialog({
  patientId,
  alert,
  onClose,
}: {
  patientId: string;
  /** The alert being resolved; `null` keeps the dialog closed. */
  alert: ClinicalAlert | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const resolve = useResolveAlertMutation(patientId);
  const why = useReason(false);

  const close = () => {
    resolve.reset();
    why.reset();
    onClose();
  };

  return (
    <ConfirmationDialog
      open={alert !== null}
      onClose={close}
      tone="primary"
      title="Resolve this alert?"
      description={alert?.message}
      confirmLabel="Resolve alert"
      loading={resolve.isPending}
      onConfirm={() => {
        if (alert === null || !why.check()) return;
        resolve.mutate(
          { id: alert.id, reason: why.reason },
          {
            onSuccess: () => {
              close();
              toast({
                variant: 'success',
                title: 'Alert resolved',
                description:
                  why.reason === ''
                    ? 'It no longer shows on the chart. Its record is kept.'
                    : 'It no longer shows on the chart. Its record is kept, with your reason.',
              });
            },
          },
        );
      }}
    >
      <div className="flex flex-col gap-3 text-body-sm text-text-secondary">
        <p>
          Resolving removes the alert from the banners every clinician sees on this chart. It does
          not delete it: the alert stays in the patient&rsquo;s record, with who resolved it and
          when.
        </p>
        <Textarea
          label="Reason (optional)"
          placeholder="e.g. Anticoagulation stopped by cardiology."
          disabled={resolve.isPending}
          {...why.field}
        />
        {resolve.isError ? (
          <Alert variant="error" title="The alert was not resolved">
            {failureOf(resolve.error)}
          </Alert>
        ) : null}
      </div>
    </ConfirmationDialog>
  );
}

export function RemoveContactDialog({
  patientId,
  contact,
  remainingCount,
  onClose,
}: {
  patientId: string;
  /** The contact being removed; `null` keeps the dialog closed. */
  contact: EmergencyContact | null;
  /** How many contacts stay on file after this one goes. */
  remainingCount: number;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const remove = useRemoveEmergencyContactMutation(patientId);
  const why = useReason(true);

  const close = () => {
    remove.reset();
    why.reset();
    onClose();
  };

  return (
    <ConfirmationDialog
      open={contact !== null}
      onClose={close}
      title={`Remove ${contact?.name ?? 'this contact'}?`}
      description={contact === null ? undefined : `${contact.relationship} · ${contact.phone}`}
      confirmLabel="Remove contact"
      loading={remove.isPending}
      onConfirm={() => {
        if (contact === null || !why.check()) return;
        remove.mutate(
          { id: contact.id, reason: why.reason },
          {
            onSuccess: () => {
              close();
              toast({
                variant: 'success',
                title: `${contact.name} removed`,
                description: 'No longer listed as an emergency contact. Your reason is kept.',
              });
            },
          },
        );
      }}
    >
      <div className="flex flex-col gap-3 text-body-sm text-text-secondary">
        <p>
          The contact is taken off this chart. The record of who removed it, when, and why is kept.
        </p>
        {contact?.isPrimary === true ? (
          <Alert variant="warning" title="This is the primary contact">
            {remainingCount > 0
              ? 'No other contact becomes primary automatically. Mark one as primary afterwards.'
              : 'It is the only contact on file. The chart will have no emergency contact.'}
          </Alert>
        ) : null}
        <Textarea
          label="Reason"
          required
          placeholder="e.g. The patient asked for this contact to be removed."
          disabled={remove.isPending}
          {...why.field}
        />
        {remove.isError ? (
          <Alert variant="error" title="The contact was not removed">
            {failureOf(remove.error)}
          </Alert>
        ) : null}
      </div>
    </ConfirmationDialog>
  );
}

export function RemoveHistoryEventDialog({
  patientId,
  event,
  onClose,
}: {
  patientId: string;
  /** The event being removed; `null` keeps the dialog closed. */
  event: MedicalHistoryEvent | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const remove = useRemoveHistoryEventMutation(patientId);
  const why = useReason(true);

  const close = () => {
    remove.reset();
    why.reset();
    onClose();
  };

  return (
    <ConfirmationDialog
      open={event !== null}
      onClose={close}
      title="Remove this history event?"
      description={
        event === null
          ? undefined
          : `${event.title} · ${HISTORY_KIND_META[event.kind].label} · ${formatDate(event.date)}`
      }
      confirmLabel="Remove event"
      loading={remove.isPending}
      onConfirm={() => {
        if (event === null || !why.check()) return;
        remove.mutate(
          { id: event.id, reason: why.reason },
          {
            onSuccess: () => {
              close();
              toast({
                variant: 'success',
                title: 'History event removed',
                description: `“${event.title}” is off the timeline. The entry and your reason are kept.`,
              });
            },
          },
        );
      }}
    >
      <div className="flex flex-col gap-3 text-body-sm text-text-secondary">
        <p>
          Remove an event only if it was added in error. It leaves this timeline for every
          clinician. It is not erased: the entry, who removed it, when, and your reason are kept.
        </p>
        <p>
          Removed events cannot be shown on the chart yet, and correcting an inaccurate event is not
          available yet.
        </p>
        <Textarea
          label="Reason"
          required
          placeholder="e.g. Entered on the wrong patient's chart."
          disabled={remove.isPending}
          {...why.field}
        />
        {remove.isError ? (
          <Alert variant="error" title="The event was not removed">
            {failureOf(remove.error)}
          </Alert>
        ) : null}
      </div>
    </ConfirmationDialog>
  );
}
