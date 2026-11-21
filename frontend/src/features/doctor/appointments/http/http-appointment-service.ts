import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  readArray,
  readBoolean,
  readData,
  readEnum,
  readNumber,
  readOptionalString,
  readString,
} from '@/api/http';
import type { Gender } from '@/features/shared-domain/patient-identity';

import type { AppointmentCommand, AppointmentService } from '../model/appointment-service';
import type {
  Appointment,
  AppointmentAction,
  AppointmentPriority,
  AppointmentStatus,
} from '../model/types';

/**
 * The appointment book over HTTP (FE-10.3) — `backend/src/modules/appointments`.
 *
 * `GET /appointments` (the doctor's own book; the server scopes it), `POST
 * /appointments`, and one `POST /appointments/{id}/<action>` per
 * transition. The server owns the status machine: each answer carries
 * `availableActions`, which becomes `allowedActions` so the row menus
 * offer exactly what the server will accept, and a transition it refuses
 * comes back as an error the page reports — never as a local status
 * change.
 *
 * ## `AppointmentView` → `Appointment`
 *
 * Field-for-field, with two readings:
 *
 * - `department` may be null (the API makes it optional on create); it is
 *   shown as "—" rather than guessed from the doctor's specialty.
 * - `availableActions` is filtered to the actions this client has a flow
 *   for; an unknown one is dropped rather than offered as a dead button.
 */

const STATUSES: readonly AppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'pending',
  'completed',
  'cancelled',
  'rescheduled',
  'no-show',
  'awaiting-patient',
];
const PRIORITIES: readonly AppointmentPriority[] = ['low', 'normal', 'high', 'urgent'];
const GENDERS: readonly Gender[] = ['female', 'male'];
const ACTIONS: ReadonlySet<string> = new Set<AppointmentAction>([
  'approve',
  'reject',
  'propose-slots',
  'cancel',
  'reschedule',
  'complete',
  'no-show',
]);

/** Shown where the API holds no department for an appointment. */
const NO_DEPARTMENT = '—';

export function toAppointment(value: unknown): Appointment {
  const what = 'appointment';
  const dto = asRecord(value, what);
  const patient = asRecord(dto.patient, `${what}.patient`);
  const allowedActions = readArray(dto, 'availableActions', what).filter(
    (action): action is AppointmentAction => typeof action === 'string' && ACTIONS.has(action),
  );
  return {
    id: readString(dto, 'id', what),
    patient: {
      id: readString(patient, 'id', `${what}.patient`),
      name: readString(patient, 'name', `${what}.patient`),
      mrn: readString(patient, 'mrn', `${what}.patient`),
      phone: readString(patient, 'phone', `${what}.patient`),
      age: readNumber(patient, 'age', `${what}.patient`),
      gender: readEnum(patient, 'gender', GENDERS, `${what}.patient`),
    },
    dateTime: readString(dto, 'dateTime', what),
    durationMin: readNumber(dto, 'durationMin', what),
    visitType: readString(dto, 'visitType', what),
    department: readOptionalString(dto, 'department', what) ?? NO_DEPARTMENT,
    doctor: readString(dto, 'doctor', what),
    status: readEnum(dto, 'status', STATUSES, what),
    priority: readEnum(dto, 'priority', PRIORITIES, what),
    isNewPatient: readBoolean(dto, 'isNewPatient', what),
    isFollowUp: readBoolean(dto, 'isFollowUp', what),
    reason: readString(dto, 'reason', what),
    notes: readOptionalString(dto, 'notes', what),
    allowedActions,
  };
}

/** The request each command is, against API §5.3–5.8. */
function request(id: string, command: AppointmentCommand): { path: string; body?: unknown } {
  const base = `/appointments/${encodeURIComponent(id)}`;
  switch (command.kind) {
    case 'approve':
      return { path: `${base}/approve` };
    case 'reject': {
      const detail = command.detail.trim();
      return {
        path: `${base}/reject`,
        body: { reasonCategory: command.category, ...(detail === '' ? {} : { reason: detail }) },
      };
    }
    case 'cancel':
      return { path: `${base}/cancel`, body: { reason: command.reason } };
    case 'reschedule':
      return {
        path: `${base}/reschedule`,
        body: { dateTime: command.dateTime, reason: command.reason },
      };
    case 'propose-slots': {
      const reason = command.reason.trim();
      return {
        path: `${base}/propose-slots`,
        body: { slots: command.slots, ...(reason === '' ? {} : { reason }) },
      };
    }
    case 'complete':
      return { path: `${base}/complete` };
    case 'no-show':
      return { path: `${base}/no-show` };
  }
}

export const httpAppointmentService: AppointmentService = {
  capabilities: { simulatedBusySlots: false },

  async listAppointments() {
    const items = await fetchAllPages(
      (page, pageSize) => apiClient.get('/appointments', { page, pageSize, sort: 'startsAt:asc' }),
      'appointments',
    );
    return items.map(toAppointment);
  },

  async createAppointment(input) {
    const body = await apiClient.post(
      '/appointments',
      {
        patientId: input.patient.id,
        dateTime: input.dateTime,
        durationMin: input.durationMin,
        visitType: input.visitType,
        department: input.department,
        priority: input.priority,
        reason: input.reason,
        isFollowUp: input.visitType === 'Follow-up',
      },
      input.idempotencyKey === undefined ? undefined : { idempotencyKey: input.idempotencyKey },
    );
    return toAppointment(readData(body, 'appointment'));
  },

  async runAction(id, command) {
    const { path, body } = request(id, command);
    return toAppointment(readData(await apiClient.post(path, body), 'appointment'));
  },
};
