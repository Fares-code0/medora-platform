import { useMemo, useState } from 'react';

import { Stack } from '@/components/layout';
import { Button, Chip, ConfirmationDialog, Modal, Textarea } from '@/components/ui';
import { formatDate, formatTime } from '@/utils/dates';

import { MAX_PROPOSED_SLOTS } from '../model/appointment-service';
import {
  addDays,
  groupByDate,
  parseDateKey,
  slotAvailabilityFor,
  todayKey,
  type DateKey,
} from '../model/calendar';
import type { Appointment } from '../model/types';

import { SlotPicker } from './SlotPicker';

/**
 * Propose other times (API §5.8) — the answer to a request the doctor cannot
 * take at the asked time, short of declining it. Up to three alternatives,
 * picked across any days, then an explicit confirmation; the request then
 * waits on the patient to choose one.
 *
 * The request's own slot is left out of the conflict check, as the server
 * leaves it out (`excludeAppointmentId`): it is the time being replaced, not
 * a booking the alternatives collide with. Every alternative is checked
 * against working hours by the server before any is offered, and a refusal
 * comes back as an error the page reports.
 */
export interface ProposeSlotsDialogProps {
  open: boolean;
  appointment: Appointment | null;
  /** Full dataset — used for same-day conflict detection. */
  allAppointments: readonly Appointment[];
  loading: boolean;
  /** Mock-only seeded busy slots — see `slotAvailabilityFor`. */
  simulateBusy: boolean;
  onConfirm: (appointment: Appointment, slotsIso: readonly string[], reason: string) => void;
  onClose: () => void;
}

/** A chosen alternative: the day it is on and its `HH:MM` slot. */
interface ProposedSlot {
  readonly date: DateKey;
  readonly time: string;
}

const keyOf = (slot: ProposedSlot) => `${slot.date}T${slot.time}`;

function toIso(slot: ProposedSlot): string {
  const [hour = 9, minute = 0] = slot.time.split(':').map(Number);
  const target = parseDateKey(slot.date);
  target.setHours(hour, minute, 0, 0);
  return target.toISOString();
}

export function ProposeSlotsDialog({
  open,
  appointment,
  allAppointments,
  loading,
  simulateBusy,
  onConfirm,
  onClose,
}: ProposeSlotsDialogProps) {
  const [date, setDate] = useState(() => addDays(todayKey(), 1));
  const [chosen, setChosen] = useState<readonly ProposedSlot[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  const appointmentId = appointment?.id ?? null;
  const byDate = useMemo(
    () => groupByDate(allAppointments.filter((row) => row.id !== appointmentId)),
    [allAppointments, appointmentId],
  );
  const slots = useMemo(
    () => slotAvailabilityFor(date, byDate.get(date) ?? [], simulateBusy),
    [date, byDate, simulateBusy],
  );

  if (!appointment) return null;

  const close = () => {
    setChosen([]);
    setConfirming(false);
    setReason('');
    onClose();
  };

  const isChosen = (time: string) =>
    chosen.some((slot) => slot.date === date && slot.time === time);
  const toggle = (time: string) =>
    setChosen((current) =>
      isChosen(time)
        ? current.filter((slot) => !(slot.date === date && slot.time === time))
        : current.length < MAX_PROPOSED_SLOTS
          ? [...current, { date, time }].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
          : current,
    );

  const full = chosen.length >= MAX_PROPOSED_SLOTS;
  const label = (slot: ProposedSlot) => `${formatDate(toIso(slot))} at ${slot.time}`;

  return (
    <>
      <Modal
        open={open && !confirming}
        onClose={close}
        size="md"
        title={`Propose other times for ${appointment.id}`}
        description={`${appointment.patient.name} asked for ${formatDate(appointment.dateTime)} at ${formatTime(
          appointment.dateTime,
        )}. Offer up to ${String(MAX_PROPOSED_SLOTS)} alternatives; the patient picks one.`}
        dismissible={!loading}
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={loading}>
              Cancel
            </Button>
            <Button disabled={chosen.length === 0} onClick={() => setConfirming(true)}>
              Review proposal
            </Button>
          </>
        }
      >
        <Stack gap={4}>
          <SlotPicker
            dateLabel="Date"
            date={date}
            onDateChange={setDate}
            slots={slots}
            isSelected={isChosen}
            onToggle={toggle}
            simulateBusy={simulateBusy}
            full={full}
          />

          <section aria-labelledby="proposed-times-heading">
            <h3 id="proposed-times-heading" className="text-body-sm font-medium text-text-primary">
              Proposed times ({chosen.length} of {MAX_PROPOSED_SLOTS})
            </h3>
            {chosen.length === 0 ? (
              <p className="mt-0.5 text-caption text-text-secondary">
                Pick a slot above. You can choose times on different days.
              </p>
            ) : (
              <ul className="mt-2 flex flex-wrap gap-2" aria-live="polite">
                {chosen.map((slot) => (
                  <li key={keyOf(slot)}>
                    <Chip
                      label={label(slot)}
                      onRemove={() =>
                        setChosen((current) => current.filter((s) => keyOf(s) !== keyOf(slot)))
                      }
                      removeLabel={`Remove ${label(slot)}`}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Textarea
            label="Note to the patient (optional)"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Sent to the patient with the proposed times."
          />
        </Stack>
      </Modal>

      <ConfirmationDialog
        open={confirming}
        title="Send proposal"
        description={`Offer ${appointment.patient.name} ${
          chosen.length === 1 ? 'this time' : `these ${String(chosen.length)} times`
        } instead of the requested one: ${chosen.map(label).join('; ')}? The request waits for the patient to choose.`}
        confirmLabel="Send proposal"
        tone="primary"
        loading={loading}
        onConfirm={() => onConfirm(appointment, chosen.map(toIso), reason.trim())}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
