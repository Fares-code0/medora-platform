import { apiClient } from '@/api/client';
import {
  asRecord,
  malformedResponse,
  readArray,
  readBoolean,
  readData,
  readEnum,
  readNumber,
  readOptionalString,
  readString,
} from '@/api/http';

import {
  WEEKDAYS,
  type AvailabilityDay,
  type AvailabilityService,
  type ReportedStrandedAppointment,
  type TimeRange,
  type WeeklyAvailability,
} from '../model/availability';

/**
 * The weekly grid over HTTP (DEC-005): `GET` and `PUT /me/availability`
 * (API §3.8, the doctors module). The `PUT` replaces all seven days; a
 * week the server finds inconsistent is a 422 whose `fieldErrors` name the
 * day (`week[2].breaks[0]`), which the editor maps back onto that row.
 *
 * An account with no practitioner record gets 404 — the grid does not exist
 * for it, which is why the section is offered to doctors only.
 *
 * BR-DEC-005: both answers carry `clinicTimezone`, and the `PUT` adds
 * `stranded[]` — the live appointments the saved week leaves uncovered. A
 * server from before it sends neither; that reads as `null` (unknown), never
 * as UTC or as "nothing stranded".
 */

function toRange(value: unknown, what: string): TimeRange {
  const dto = asRecord(value, what);
  return { start: readString(dto, 'start', what), end: readString(dto, 'end', what) };
}

function toDay(value: unknown): AvailabilityDay {
  const what = 'availability.week[]';
  const dto = asRecord(value, what);
  return {
    weekday: readEnum(dto, 'weekday', WEEKDAYS, what),
    open: readBoolean(dto, 'open', what),
    windows: readArray(dto, 'windows', what).map((range) => toRange(range, `${what}.windows`)),
    breaks: readArray(dto, 'breaks', what).map((range) => toRange(range, `${what}.breaks`)),
  };
}

export function toAvailability(value: unknown): WeeklyAvailability {
  const what = 'availability';
  const dto = asRecord(value, what);
  const week = readArray(dto, 'week', what).map(toDay);
  // Monday first, every day once — the editor renders rows by position.
  if (
    week.length !== WEEKDAYS.length ||
    week.some((day, index) => day.weekday !== WEEKDAYS[index])
  ) {
    throw malformedResponse(`${what}.week`);
  }
  return {
    week,
    defaultDurationMin: readNumber(dto, 'defaultDurationMin', what),
    bufferMin: readNumber(dto, 'bufferMin', what),
    clinicTimezone: readOptionalString(dto, 'clinicTimezone', what),
  };
}

function toReported(value: unknown): ReportedStrandedAppointment {
  const what = 'availability.stranded[]';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    dateTime: readString(dto, 'scheduledAt', what),
    durationMin: readNumber(dto, 'durationMin', what),
    status: readString(dto, 'status', what),
    patientId: readString(dto, 'patientId', what),
  };
}

/** The `PUT` body. A closed day is sent with no ranges, as the server requires. */
function toBody(next: WeeklyAvailability) {
  return {
    week: next.week.map((day) => ({
      weekday: day.weekday,
      open: day.open,
      windows: day.open ? day.windows.map(({ start, end }) => ({ start, end })) : [],
      breaks: day.open ? day.breaks.map(({ start, end }) => ({ start, end })) : [],
    })),
    defaultDurationMin: next.defaultDurationMin,
    bufferMin: next.bufferMin,
  };
}

export const httpAvailabilityService: AvailabilityService = {
  async get() {
    return toAvailability(readData(await apiClient.get('/me/availability'), 'availability'));
  },

  async replace(next) {
    const data = readData(await apiClient.put('/me/availability', toBody(next)), 'availability');
    const stranded = asRecord(data, 'availability').stranded;
    return {
      saved: toAvailability(data),
      stranded:
        stranded === undefined || stranded === null
          ? null
          : readArray(asRecord(data, 'availability'), 'stranded', 'availability').map(toReported),
    };
  },
};
