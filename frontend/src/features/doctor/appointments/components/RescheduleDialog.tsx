import { useMemo, useState } from 'react';

import { Alert } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { Button, ConfirmationDialog, Modal, Textarea } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import {
  addDays,
  groupByDate,
  parseDateKey,
  slotAvailabilityFor,
  todayKey,
} from '../model/calendar';
import type { Appointment } from '../model/types';

import { SlotPicker } from './SlotPicker';

/**
 * Reschedule flow (UX 2.4) — date picker → availability grid → reason →
 * explicit confirmation. Slots already holding an active appointment that
 * day are blocked and announced. In the mock a pseudo-busy pattern stands
 * in for availability rules; against the API (`simulateBusy` off) the
 * server checks working hours and refuses a slot outside them, which the
 * page reports. The API requires a reason, which the patient is sent
 * (API §5.6). The commit is always owned by a ConfirmationDialog (drag
 * alternatives rule).
 */
export interface RescheduleDialogProps {
  open: boolean;
  appointment: Appointment | null;
  /** Full dataset — used for same-day conflict detection. */
  allAppointments: readonly Appointment[];
  loading: boolean;
  /** Mock-only seeded busy slots — see `slotAvailabilityFor`. */
  simulateBusy: boolean;
  onConfirm: (appointment: Appointment, newDateTimeIso: string, reason: string) => void;
  onClose: () => void;
}

export function RescheduleDialog({
  open,
  appointment,
  allAppointments,
  loading,
  simulateBusy,
  onConfirm,
  onClose,
}: RescheduleDialogProps) {
  const [date, setDate] = useState(() => addDays(todayKey(), 1));
  const [slot, setSlot] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  const byDate = useMemo(() => groupByDate(allAppointments), [allAppointments]);
  const slots = useMemo(
    () => slotAvailabilityFor(date, byDate.get(date) ?? [], simulateBusy),
    [date, byDate, simulateBusy],
  );
  if (!appointment) return null;

  const close = () => {
    setSlot(null);
    setConfirming(false);
    setReason('');
    onClose();
  };

  const selectedIso = (() => {
    if (slot === null) return null;
    const [hour = 9, minute = 0] = slot.split(':').map(Number);
    const target = parseDateKey(date);
    target.setHours(hour, minute, 0, 0);
    return target.toISOString();
  })();

  return (
    <>
      <Modal
        open={open && !confirming}
        onClose={close}
        size="md"
        title={`Reschedule ${appointment.id}`}
        description={`Currently ${formatDate(appointment.dateTime)} at ${formatTime(
          appointment.dateTime,
        )} with ${appointment.patient.name}.`}
        dismissible={!loading}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={loading}>
              Cancel
            </Button>
            <Button
              disabled={slot === null || reason.trim() === ''}
              onClick={() => setConfirming(true)}
            >
              Review new time
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <SlotPicker
            dateLabel="New date"
            date={date}
            onDateChange={(next) => {
              setDate(next);
              setSlot(null);
            }}
            slots={slots}
            isSelected={(time) => slot === time}
            onToggle={(time) => setSlot((current) => (current === time ? null : time))}
            simulateBusy={simulateBusy}
          />

          {slot !== null && selectedIso !== null ? (
            <Alert variant="info" title={`New time: ${formatDate(selectedIso)} at ${slot}`} />
          ) : null}

          <Textarea
            label="Reason"
            required
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Sent to the patient with the new time."
          />
        </Stack>
      </Modal>

      <ConfirmationDialog
        open={confirming && selectedIso !== null}
        title="Confirm reschedule"
        description={
          selectedIso !== null
            ? `Move ${appointment.patient.name}'s appointment to ${formatDate(selectedIso)} at ${formatTime(
                selectedIso,
              )}? The patient will be asked to re-confirm.`
            : ''
        }
        confirmLabel="Reschedule appointment"
        tone="primary"
        loading={loading}
        onConfirm={() => {
          if (selectedIso !== null) onConfirm(appointment, selectedIso, reason.trim());
        }}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
