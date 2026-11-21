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

/**
 * Time off over HTTP (FE-10.4): `POST /me/time-off` (API §3.9, the doctors
 * module) and `POST /me/time-off/{id}/resolve` (API §5.9, the appointments
 * module), plus `GET /me/time-off` and `DELETE /me/time-off/{id}` for the
 * upcoming list. All act on the caller's own blocks only; another doctor's
 * block answers 404.
 */

const KINDS: readonly TimeOffKind[] = ['vacation', 'emergency-block'];

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

  async removeBlock(blockId) {
    await apiClient.delete(`/me/time-off/${encodeURIComponent(blockId)}`);
  },
};
