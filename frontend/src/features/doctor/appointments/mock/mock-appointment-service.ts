import { formatDateTime } from '@/i18n';

import type { AppointmentService } from '../model/appointment-service';
import { REJECT_CATEGORY_LABELS } from '../model/appointment-service';
import { MOCK_APPOINTMENTS } from '../model/mock-data';
import type { Appointment, AppointmentStatus } from '../model/types';

/**
 * The appointment book over a session-lifetime in-memory store — the mock
 * adapter. Actions genuinely mutate state for the session and every
 * consumer refreshes through invalidation. Each command produces the
 * status change the old patch-based store produced, with the reason
 * recorded in `notes` as before.
 */

const MOCK_LATENCY_MS = 400;

const delay = () => new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

/** Session-lifetime store seeded from the deterministic dataset. */
const store = new Map<string, Appointment>(
  MOCK_APPOINTMENTS.map((appointment) => [appointment.id, appointment]),
);

function update(id: string, patch: Partial<Appointment>): Appointment {
  const current = store.get(id);
  if (!current) throw new Error(`Unknown appointment: ${id}`);
  const next: Appointment = { ...current, ...patch };
  store.set(id, next);
  return next;
}

/** Statuses of an appointment that is still going to happen. */
const LIVE: ReadonlySet<AppointmentStatus> = new Set([
  'scheduled',
  'confirmed',
  'pending',
  'rescheduled',
  'awaiting-patient',
]);

/**
 * The live appointments overlapping a window — for the mock time-off
 * adapter, which acts on this same book (as the server's time off acts on
 * its appointment book).
 */
export function mockAppointmentsOverlapping(from: Date, to: Date): readonly Appointment[] {
  return Array.from(store.values()).filter((appointment) => {
    const start = new Date(appointment.dateTime).getTime();
    const end = start + appointment.durationMin * 60_000;
    return LIVE.has(appointment.status) && start < to.getTime() && end > from.getTime();
  });
}

/** Writes one appointment in the mock book — see `mockAppointmentsOverlapping`. */
export function mockUpdateAppointment(id: string, patch: Partial<Appointment>): Appointment {
  return update(id, patch);
}

function withStatus(status: AppointmentStatus, notes?: string): Partial<Appointment> {
  return notes === undefined ? { status } : { status, notes };
}

export const mockAppointmentService: AppointmentService = {
  capabilities: { simulatedBusySlots: true },

  async listAppointments() {
    await delay();
    return Array.from(store.values());
  },

  async createAppointment(input) {
    await delay();
    const id = `apt-${Date.now().toString(36)}`;
    const appointment: Appointment = {
      id,
      patient: input.patient,
      dateTime: input.dateTime,
      durationMin: input.durationMin,
      visitType: input.visitType,
      department: input.department,
      doctor: input.doctor,
      status: 'scheduled',
      priority: input.priority,
      isNewPatient: false,
      isFollowUp: input.visitType === 'Follow-up',
      reason: input.reason,
      notes: null,
    };
    store.set(id, appointment);
    return appointment;
  },

  async runAction(id, command) {
    await delay();
    switch (command.kind) {
      case 'approve':
        return update(id, withStatus('confirmed'));
      case 'reject': {
        const label = REJECT_CATEGORY_LABELS[command.category];
        const detail = command.detail.trim();
        return update(
          id,
          withStatus('cancelled', `Rejected: ${detail === '' ? label : `${label} — ${detail}`}`),
        );
      }
      case 'cancel':
        return update(id, withStatus('cancelled', `Cancelled: ${command.reason}`));
      case 'reschedule':
        return update(id, { status: 'rescheduled', dateTime: command.dateTime });
      case 'propose-slots': {
        // The server accepts a proposal only on a pending request; so does
        // the mock, so the demo cannot show a transition the API refuses.
        if (store.get(id)?.status !== 'pending') {
          throw new Error('Only a pending request can be answered with other times.');
        }
        const reason = command.reason.trim();
        const times = command.slots.map((slot) => formatDateTime(slot)).join('; ');
        return update(
          id,
          withStatus(
            'awaiting-patient',
            `Proposed: ${times}${reason === '' ? '' : ` — ${reason}`}`,
          ),
        );
      }
      case 'complete':
        return update(id, withStatus('completed'));
      case 'no-show':
        return update(id, withStatus('no-show'));
    }
  },
};
