import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  readData,
  readEnum,
  readNumber,
  readOptionalString,
  readString,
} from '@/api/http';

import { adminRefusal } from '../../refusal';
import type { OversightService } from '../api/oversight-service';
import type {
  OversightAppointment,
  OversightStatus,
  OversightSummary,
  PlatformDoctor,
} from '../oversight.types';

/**
 * Appointment oversight over HTTP (FE-10.10) — API §5.10–5.11,
 * `backend/src/modules/appointments/controllers/admin-appointment.controller.ts`.
 *
 * | Port method              | Endpoint                                                |
 * | ------------------------ | ------------------------------------------------------- |
 * | `list` (appointments)    | `GET /admin/appointments` (every page)                  |
 * | `list` (roster)          | `GET /doctors` (every page) — the reassign picker       |
 * | `summary`                | `GET /admin/appointments/summary`                       |
 * | `nudge`                  | `POST /admin/appointments/{id}/nudge`, once per row     |
 * | `reassign`               | `POST /admin/appointments/{id}/reassign`                |
 * | `cancelAdministratively` | `POST /admin/appointments/{id}/cancel-administratively` |
 *
 * ## What a live row does not carry, on purpose or otherwise
 *
 * - **The patient's name and MRN.** The server sends the patient's handle
 *   only (API §0.4 masks admin projections at the source), so both are
 *   `null` and the table says "Withheld" — there is nothing to reveal.
 * - **History and delivery receipts.** Not on the row; `capabilities`
 *   says so and the drawer explains the gap.
 * - **Complaints.** The server's `complaint` flag has no source of truth
 *   yet and never fires, so `complaint` is `null`. Stuck-pending and
 *   repeated-reschedules are recomputed on the client with the same
 *   thresholds the server uses (24 h, 3), from the same fields.
 * - **Reassignment capacity.** The roster carries practice status but not
 *   today's free slots; capacity is `null` and the server checks it when
 *   the move is submitted, refusing with its reason if the doctor is busy.
 *
 * The book is read whole, as the screen filters on the client — bounded by
 * `fetchAllPages`' ceiling, past which the section shows its error state
 * rather than a silently truncated table.
 */

const STATUSES: readonly OversightStatus[] = [
  'pending',
  'scheduled',
  'confirmed',
  'rescheduled',
  'completed',
  'cancelled',
  'no-show',
  'awaiting-patient',
];

/** Shown where the API holds no department for an appointment. */
const NO_DEPARTMENT = '—';

export function toOversightAppointment(value: unknown): OversightAppointment {
  const what = 'oversight appointment';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    reference: readString(dto, 'reference', what),
    startsAt: readString(dto, 'startsAt', what),
    durationMin: readNumber(dto, 'durationMin', what),
    visitType: readString(dto, 'visitType', what),
    department: readOptionalString(dto, 'department', what) ?? NO_DEPARTMENT,
    specialty: readString(dto, 'specialty', what),
    doctorId: readString(dto, 'doctorId', what),
    doctorName: readString(dto, 'doctorName', what),
    patientId: readString(dto, 'patientId', what),
    patientName: null,
    patientMrn: null,
    status: readEnum(dto, 'status', STATUSES, what),
    stateSince: readString(dto, 'stateSince', what),
    rescheduleCount: readNumber(dto, 'rescheduleCount', what),
    complaint: null,
    lastNudgedAt: readOptionalString(dto, 'lastNudgedAt', what),
    events: [],
    notifications: [],
  };
}

/** A roster row as the reassign picker reads it — with capacity unknown. */
export function toPlatformDoctor(value: unknown): PlatformDoctor {
  const what = 'doctor';
  const dto = asRecord(value, what);
  const practice = readString(dto, 'practiceStatus', what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'fullName', what),
    specialty: readString(dto, 'specialty', what),
    department: readOptionalString(dto, 'departmentName', what) ?? NO_DEPARTMENT,
    // A suspended doctor or one on vacation is plainly not taking the case;
    // anyone else may be, and the server decides on submit.
    availability: practice === 'active' ? 'unknown' : 'unavailable',
    openSlotsToday: null,
    loadPercent: null,
    note: practice === 'vacation' ? 'On vacation' : practice === 'suspended' ? 'Suspended' : null,
  };
}

/** The server's rates are fractions; the strip renders one-decimal percents. */
function percent(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

export function toOversightSummary(value: unknown): OversightSummary {
  const what = 'oversight summary';
  const dto = asRecord(value, what);
  return {
    todayTotal: readNumber(dto, 'today', what),
    pendingOverThreshold: readNumber(dto, 'pendingOverDay', what),
    cancellationRate7d: percent(readNumber(dto, 'cancellationRate7d', what)),
    noShowRate7d: percent(readNumber(dto, 'noShowRate7d', what)),
    window7dTotal: readNumber(dto, 'window7dTotal', what),
  };
}

function appointmentPath(id: string, action: string): string {
  return `/admin/appointments/${encodeURIComponent(id)}/${action}`;
}

export const httpOversightService: OversightService = {
  capabilities: { history: false },

  async list() {
    const [appointments, doctors] = await Promise.all([
      fetchAllPages(
        (page, pageSize) =>
          apiClient.get('/admin/appointments', { page, pageSize, sort: 'startsAt:asc' }),
        'oversight appointments',
      ),
      fetchAllPages((page, pageSize) => apiClient.get('/doctors', { page, pageSize }), 'doctors'),
    ]);
    return {
      appointments: appointments.map(toOversightAppointment),
      doctors: doctors.map(toPlatformDoctor),
    };
  },

  async summary() {
    return toOversightSummary(
      readData(await apiClient.get('/admin/appointments/summary'), 'oversight summary'),
    );
  },

  /**
   * One request per appointment — the API nudges one row at a time. The
   * server's own template is used: it owns the wording the doctor receives.
   *
   * A partial batch is reported as one: reminders already sent cannot be
   * unsent, so the error says how many went out before naming the refusal,
   * and the query layer re-reads the book either way.
   */
  async nudge({ ids }) {
    const results = await Promise.allSettled(
      ids.map((id) =>
        apiClient.post(appointmentPath(id, 'nudge'), { template: 'awaiting-confirmation' }),
      ),
    );
    const refused = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    const first = refused[0];
    if (first === undefined) return null;
    if (refused.length === results.length) throw first.reason;
    const sent = results.length - refused.length;
    throw new Error(
      `${String(sent)} of ${String(results.length)} reminders were sent. The rest were refused: ${adminRefusal(first.reason)}`,
    );
  },

  async reassign({ id, toDoctorId, reason }) {
    await apiClient.post(appointmentPath(id, 'reassign'), {
      doctorId: toDoctorId,
      reason: reason.trim(),
    });
    return null;
  },

  async cancelAdministratively({ id, category, reason }) {
    await apiClient.post(appointmentPath(id, 'cancel-administratively'), {
      category,
      reason: reason.trim(),
    });
    return null;
  },
};
