import { useEffect, useState } from 'react';

import { ArrowRightLeft } from 'lucide-react';

import { Alert } from '@/components/feedback';
import { Badge, Button, Modal, Radio, RadioGroup, Textarea } from '@/components/ui';

import { eligibleReassignTargets, formatSlot, validateReason } from './oversight';
import type { OversightAppointment, PlatformDoctor } from './oversight.types';

/**
 * Move an appointment to another doctor (ADM-05 · UX §3.5).
 *
 * The picker shows live availability rather than a flat list of names,
 * because the decision an administrator is actually making is "who has room
 * for this today", and it is filtered to the same specialty — a cardiology
 * follow-up handed to an endocrinologist is not a reassignment, it is a new
 * clinical problem.
 *
 * A reason is mandatory. Both parties are notified, and only after the
 * service confirms the move: the dialog reports failure here and sends
 * nothing.
 */
export function ReassignDialog({
  open,
  appointment,
  doctors,
  submitting,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  appointment: OversightAppointment | null;
  doctors: readonly PlatformDoctor[];
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (doctorId: string, reason: string) => void;
}) {
  const [doctorId, setDoctorId] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);

  // A fresh form per appointment: a target and a reason chosen for one case
  // must never carry into the next.
  useEffect(() => {
    if (open) {
      setDoctorId('');
      setReason('');
      setReasonError(undefined);
    }
  }, [open, appointment?.id]);

  if (appointment === null) return null;

  const targets = eligibleReassignTargets(doctors, appointment);

  const submit = () => {
    if (doctorId === '') {
      setReasonError(undefined);
      return;
    }
    const check = validateReason(reason);
    if (!check.ok) {
      setReasonError(check.message);
      return;
    }
    setReasonError(undefined);
    onConfirm(doctorId, reason);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reassign ${appointment.reference}`}
      description={`${appointment.visitType} · ${formatSlot(appointment.startsAt)} · currently with ${appointment.doctorName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            leadingIcon={ArrowRightLeft}
            loading={submitting}
            onClick={submit}
            disabled={targets.length === 0 || doctorId === ''}
          >
            Reassign and notify
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
          <Alert variant="error" title="Nothing was changed">
            {error}
          </Alert>
        ) : null}

        {targets.length === 0 ? (
          <Alert variant="info" title="No one available to take this">
            No other {appointment.specialty} doctor is available. Try again once the roster changes,
            or cancel administratively and rebook the patient.
          </Alert>
        ) : (
          <RadioGroup
            name="reassign-target"
            label="Move to"
            value={doctorId}
            onChange={setDoctorId}
          >
            {targets.map((doctor) => (
              <Radio
                key={doctor.id}
                value={doctor.id}
                label={doctor.name}
                description={capacityLine(doctor)}
              />
            ))}
          </RadioGroup>
        )}

        {targets.length > 0 ? (
          <>
            <Textarea
              label="Why is this being moved?"
              placeholder="e.g. Dr. Khalil is on emergency cover until Thursday and cannot keep this slot."
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              error={reasonError}
            />
            <div className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
              <Badge variant="info">Patient notified</Badge>
              <Badge variant="info">Both doctors notified</Badge>
              <span>Sent only once the change is confirmed.</span>
            </div>
          </>
        ) : null}
      </form>
    </Modal>
  );
}

/**
 * "Cardiology · 3 open slots today · 60% loaded". Capacity is left out where
 * the roster does not carry it — the live API checks it on submit instead,
 * and says so if the doctor is full (FE-10.10).
 */
function capacityLine(doctor: PlatformDoctor): string {
  const parts = [doctor.specialty];
  if (doctor.openSlotsToday !== null) {
    parts.push(
      `${String(doctor.openSlotsToday)} open ${doctor.openSlotsToday === 1 ? 'slot' : 'slots'} today`,
    );
  } else {
    parts.push('capacity checked when you confirm');
  }
  if (doctor.loadPercent !== null) parts.push(`${String(doctor.loadPercent)}% loaded`);
  if (doctor.note !== null) parts.push(doctor.note);
  return parts.join(' · ');
}
