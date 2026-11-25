import { apiClient } from '@/api/client';
import {
  asRecord,
  malformedResponse,
  readArray,
  readData,
  readEnum,
  readNumber,
  readString,
} from '@/api/http';

import type {
  ImpactedAppointment,
  TimeOffBlock,
  TimeOffKind,
  TimeOffService,
} from '../model/time-off-service';
import type { AppointmentStatus } from '../model/types';

import { httpAppointmentService } from './http-appointment-service';

/**
 * Time off over HTTP (FE-10.4): `POST /me/time-off` (API §3.9, the doctors
 * module) and `POST /me/time-off/{id}/resolve` (API §5.9, the appointments
 * module), plus `GET /me/time-off` and `DELETE /me/time-off/{id}` for the
 * upcoming list. All act on the caller's own blocks only; another doctor's
 * block answers 404.
 */

const KINDS: readonly TimeOffKind[] = ['vacation', 'emergency-block'];

/** The backend's `LIVE_STATUSES` (appointment.repository.ts), in this client's spelling. */
const LIVE_STATUSES: ReadonlySet<AppointmentStatus> = new Set<AppointmentStatus>([
  'scheduled',
  'confirmed',
  'pending',
  'rescheduled',
  'awaiting-patient',
]);

function toImpacted(value: unknown): ImpactedAppointment {
  const what = 'impacted';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    scheduledAt: readString(dto, 'scheduledAt', what),
    durationMin: readNumber(dto, 'durationMin', what),
    status: readString(dto, 'status', what),
    patientId: readString(dto, 'patientId', what),
  };
}

export function toBlock(value: unknown): TimeOffBlock {
  const what = 'timeOff';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    startsAt: readString(dto, 'startsAt', what),
    endsAt: readString(dto, 'endsAt', what),
    kind: readEnum(dto, 'kind', KINDS, what),
  };
}

export const httpTimeOffService: TimeOffService = {
  async createBlock({ from, to, kind }) {
    const data = asRecord(
      readData(
        await apiClient.post('/me/time-off', {
          from,
          to,
          kind,
          // The resolution screen's pre-selection only; the server moves
          // nothing on this request whichever is sent (RA-005.2).
          mode: kind === 'emergency-block' ? 'reschedule-existing' : 'block-new',
        }),
        'time off',
      ),
      'time off',
    );
    return {
      block: toBlock(data.timeOff),
      impacted: readArray(data, 'impacted', 'time off').map(toImpacted),
    };
  },

  async resolve(blockId, { action, confirmedCount, reason }) {
    const trimmed = reason?.trim() ?? '';
    const data = asRecord(
      readData(
        await apiClient.post(`/me/time-off/${encodeURIComponent(blockId)}/resolve`, {
          action,
          confirmedCount,
          ...(trimmed === '' ? {} : { reason: trimmed }),
        }),
        'time-off resolution',
      ),
      'resolution',
    );
    return {
      resolved: readArray(data, 'resolved', 'resolution').map((id) => {
        if (typeof id !== 'string') throw malformedResponse('resolution.resolved');
        return id;
      }),
      skipped: readArray(data, 'skipped', 'resolution').map((value) => {
        const entry = asRecord(value, 'resolution.skipped');
        return {
          id: readString(entry, 'id', 'resolution.skipped'),
          reason: readString(entry, 'reason', 'resolution.skipped'),
        };
      }),
      notified: readNumber(data, 'notified', 'resolution'),
    };
  },

  async listBlocks() {
    const items = readData(await apiClient.get('/me/time-off'), 'time off');
    if (!Array.isArray(items)) throw malformedResponse('time off');
    return items.map(toBlock);
  },

  /*
   * The API has no impact read for an existing block: `POST /me/time-off`
   * returns it once, and `resolve` recomputes it server-side. So this reads
   * the doctor's book (`GET /appointments`, the same collection the
   * appointment list uses) and applies the server's own rule —
   * `impactedByTimeOff`: a live status (scheduled, confirmed, pending,
   * rescheduled, awaiting-patient) and a start inside [startsAt, endsAt).
   * Should the two ever disagree, `resolve`'s count check refuses with
   * `blast_radius_changed` and nothing is sent.
   */
  async previewImpact(block) {
    const from = new Date(block.startsAt).getTime();
    const to = new Date(block.endsAt).getTime();
    const book = await httpAppointmentService.listAppointments();
    return book
      .filter((appointment) => {
        const start = new Date(appointment.dateTime).getTime();
        return LIVE_STATUSES.has(appointment.status) && start >= from && start < to;
      })
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
      .map((appointment) => ({
        id: appointment.id,
        scheduledAt: appointment.dateTime,
        durationMin: appointment.durationMin,
        status: appointment.status,
        patientId: appointment.patient.id,
      }));
  },

  async removeBlock(blockId) {
    await apiClient.delete(`/me/time-off/${encodeURIComponent(blockId)}`);
  },
};
