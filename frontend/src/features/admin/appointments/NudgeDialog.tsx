import { BellRing } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Button, Modal } from '@/components/ui';

import { nudgeMessage } from './oversight';
import type { OversightAppointment } from './oversight.types';

/**
 * Nudge a doctor sitting on a Pending request (ADM-05 · UX §3.5).
 *
 * The message is templated and shown in full before sending, not composed:
 * a reminder that reads the same whoever sends it is process, and process is
 * what makes chasing a colleague unremarkable. It also carries no patient
 * identifier — the reference is enough for a doctor to find the request.
 *
 * This is the one action §3.5 allows in bulk, because the worst outcome of a
 * mistaken batch is a redundant reminder.
 */
export function NudgeDialog({
  open,
  appointments,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  appointments: readonly OversightAppointment[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (message: string) => void;
}) {
  const now = Date.now();
  const single = appointments.length === 1 ? appointments[0] : undefined;
  const message =
    single === undefined
      ? 'You have appointment requests awaiting a response. Please confirm, propose another time, ' +
        'or decline so the patients can be rebooked.'
      : nudgeMessage(single, now);

  const title =
    single === undefined
      ? `Send ${String(appointments.length)} reminders?`
      : `Nudge ${single.doctorName}?`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description="The reminder is sent from the clinic, recorded on the appointment history, and attributed to you."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            leadingIcon={BellRing}
            loading={submitting}
            onClick={() => onConfirm(message)}
            disabled={appointments.length === 0}
          >
            {single === undefined ? 'Send reminders' : 'Send reminder'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error ? (
          <Alert variant="error" title="Nothing was sent">
            {error}
          </Alert>
        ) : null}

        <div className="rounded-surface border border-border bg-surface-sunken p-4">
          <p className="text-body-sm text-text-secondary">{message}</p>
        </div>

        {single === undefined ? (
          <div>
            <p className="mb-2 text-caption font-semibold text-text-secondary">
              Going to {String(new Set(appointments.map((a) => a.doctorId)).size)} doctors
            </p>
            <ul className="flex flex-col gap-1">
              {appointments.map((appointment) => (
                <li
                  key={appointment.id}
                  className="flex items-center justify-between text-caption text-text-tertiary"
                >
                  <span className="font-medium text-text-secondary">{appointment.reference}</span>
                  <span>{appointment.doctorName}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
